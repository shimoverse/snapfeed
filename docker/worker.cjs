/**
 * snapfeed — self-hosted worker (v0.5)
 *
 * A minimal Node HTTP server that wires:
 *   - autoAdapters()      → adapters configured via SNAPFEED_* env vars
 *   - fileAuditLog()      → append-only JSONL audit log
 *   - fileStorage()       → on-disk media uploads
 *   - feedbackMiddleware  → the same security-hardened handler used in Express
 *
 * Routes:
 *   GET  /healthz   → { ok: true, version, adapters: [...] }
 *   POST /feedback  → runs configured adapters, returns delivery results
 *
 * Plain CommonJS, no transpilation. We deliberately use `node:http` instead
 * of Express to keep the runtime dependency surface to literally zero — the
 * widget POSTs JSON, that's it.
 *
 * ── Environment variables ──────────────────────────────────────────────────
 *   WORKER_PORT                  (default 8787)
 *   ALLOWED_ORIGINS              CSV list; empty + NODE_ENV !== production allows *,
 *                                empty + NODE_ENV === production rejects all origins
 *   SNAPFEED_TRUST_PROXY         "true"/"1" to honour X-Forwarded-For (only set when
 *                                an upstream proxy/ingress controls that header)
 *   SNAPFEED_AUDIT_LOG_PATH      (default /data/audit/snapfeed.jsonl)
 *   SNAPFEED_UPLOAD_DIR          (default /data/uploads)
 *   SNAPFEED_RATE_LIMIT_MAX      (default 60)
 *   SNAPFEED_RATE_LIMIT_WINDOW_MS (default 60000)
 *   SNAPFEED_MAX_BODY_BYTES      (default ~11 MB, sized for a 5 MB screenshot)
 *   SNAPFEED_HASH_REPORTER       set to "1"/"true" to redact reporter in audit log
 *   plus all SNAPFEED_* keys consumed by autoAdapters()
 */

'use strict'

const http = require('node:http')
const path = require('node:path')

// Imports from compiled dist — these are what `npm run build` produces.
const { feedbackMiddleware } = require('../dist/server/express.cjs')
const { autoAdapters } = require('../dist/adapters/index.cjs')
const { fileAuditLog } = require('../dist/audit-log.cjs')
const { fileStorage } = require('../dist/storage/index.cjs')
const pkg = require('../package.json')

// ── Config from env ──────────────────────────────────────────────────────────

/**
 * Parse a numeric env var with validation. Logs and exits if the value is
 * non-empty but not a valid number — silent NaN would make the worker
 * accept zero requests / let unbounded payloads through, both bad failures.
 */
function parseEnvNumber(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (Number.isNaN(n)) {
    console.error(
      `[snapfeed] FATAL: env var ${name}="${raw}" is not a valid number. ` +
        `Set a numeric value or unset it to fall back to the default (${fallback}).`
    )
    process.exit(1)
  }
  return n
}

const PORT = parseEnvNumber('WORKER_PORT', 8787)
const AUDIT_PATH = process.env.SNAPFEED_AUDIT_LOG_PATH || '/data/audit/snapfeed.jsonl'
const UPLOAD_DIR = process.env.SNAPFEED_UPLOAD_DIR || '/data/uploads'
const RATE_LIMIT_MAX = parseEnvNumber('SNAPFEED_RATE_LIMIT_MAX', 60)
const RATE_LIMIT_WINDOW_MS = parseEnvNumber('SNAPFEED_RATE_LIMIT_WINDOW_MS', 60_000)
const HASH_REPORTER =
  process.env.SNAPFEED_HASH_REPORTER === '1' ||
  process.env.SNAPFEED_HASH_REPORTER === 'true'

const ALLOWED_ORIGINS_RAW = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

const isProd = process.env.NODE_ENV === 'production'

// Only trust X-Forwarded-For when an upstream proxy/ingress is in front of
// the worker AND you trust it. Default false because rate-limiting per IP
// is trivially bypassed if attackers can spoof the header.
const TRUST_PROXY =
  process.env.SNAPFEED_TRUST_PROXY === '1' ||
  process.env.SNAPFEED_TRUST_PROXY === 'true'

// JSON body cap. Default is 11 MB so the 5 MB screenshot (base64 ≈ 4/3) fits.
const MAX_BODY_BYTES = parseEnvNumber('SNAPFEED_MAX_BODY_BYTES', 11 * 1024 * 1024)

// ── Wired components ─────────────────────────────────────────────────────────

const rawAdapters = autoAdapters()
const auditLog = fileAuditLog({ path: AUDIT_PATH, hashReporter: HASH_REPORTER })

// Wrap each adapter so we can emit a real-timing `adapter.dispatched` audit
// line directly from the wrapper. Recording inside the wrapper (rather than
// in `onComplete`) sidesteps two problems:
//   1. `onComplete` doesn't know when each adapter started, so per-call
//      durationMs would have to be 0 (the previous behaviour).
//   2. Concurrent requests would race on any shared timing map.
const adapters = rawAdapters.map((adapter) => ({
  ...adapter,
  async send(payload) {
    const startedAt = Date.now()
    let result
    let thrown
    try {
      result = await adapter.send(payload)
    } catch (err) {
      thrown = err
      result = { ok: false, error: err && err.message ? err.message : String(err) }
    }
    const durationMs = Date.now() - startedAt
    // Awaited (not fire-and-forget) so the audit line is flushed before the
    // response returns. Wrapped in try/catch so an audit-log failure can't
    // mask a successful adapter result.
    try {
      await auditLog.record({
        type: 'adapter.dispatched',
        ts: new Date().toISOString(),
        adapter: adapter.name,
        ok: !!result.ok,
        durationMs,
        ...(result.deliveryId ? { deliveryId: result.deliveryId } : {}),
        ...(result.error ? { error: result.error } : {}),
        ...(result.warnings ? { warningsCount: result.warnings.length } : {}),
      })
    } catch (auditErr) {
      console.error('[snapfeed] audit log failed:', auditErr)
    }
    if (thrown) throw thrown
    return result
  },
}))

// Storage adapter is wired now so the consumer sees it boots cleanly. The
// server middleware does not yet route media through it (that ships in v0.6
// when uploads move out of the JSON body); for now, instantiate + log.
const storage = fileStorage({ dir: UPLOAD_DIR })

// Resolve the allowlist passed to the middleware:
//   - operator set ALLOWED_ORIGINS → use it
//   - empty + non-prod → undefined (middleware allows all; dev convenience)
//   - empty + prod    → ['__never_match__'] so EVERY origin is rejected.
//     Production with no allowlist must FAIL CLOSED — silently accepting
//     `*` would defeat the purpose of CSRF/origin defenses.
const resolvedAllowedOrigins =
  ALLOWED_ORIGINS_RAW.length > 0
    ? ALLOWED_ORIGINS_RAW
    : isProd
      ? ['__never_match__']
      : undefined

const handlerConfig = {
  adapters,
  rateLimit: { max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS },
  // Origin allowlist (see resolvedAllowedOrigins above).
  allowedOrigins: resolvedAllowedOrigins,
  async onReceive(payload) {
    try {
      await auditLog.record({
        type: 'feedback.received',
        ts: new Date().toISOString(),
        payloadSize: JSON.stringify(payload).length,
        pageUrl: payload.pageUrl,
        reporter: payload.user?.email,
        category: payload.category,
      })
    } catch (err) {
      // Audit logging must never break the request flow.
      console.error('[snapfeed] audit log failed:', err)
    }
    return true
  },
  // `adapter.dispatched` is emitted from the per-adapter wrapper above
  // (with real durationMs); no onComplete needed here.
}

const middleware = feedbackMiddleware(handlerConfig)

// ── Tiny req/res adapter so the middleware can run on plain node:http ────────

function adaptResponse(res) {
  let _status = 200
  const _headers = {}
  return {
    status(code) {
      _status = code
      return this
    },
    set(name, value) {
      _headers[name] = value
      return this
    },
    json(body) {
      const buf = Buffer.from(JSON.stringify(body), 'utf8')
      res.writeHead(_status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': String(buf.length),
        ..._headers,
      })
      res.end(buf)
    },
  }
}

/**
 * Custom error so the request handler can branch on a stable `code`
 * instead of fragile message-string equality.
 */
class BodyReadError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'BodyReadError'
    this.code = code
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0
    const chunks = []
    req.on('data', chunk => {
      total += chunk.length
      if (total > MAX_BODY_BYTES) {
        reject(new BodyReadError('payload_too_large', 'Payload too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text) return resolve({})
      try {
        resolve(JSON.parse(text))
      } catch {
        reject(new BodyReadError('invalid_json', 'Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

function applyCors(req, res) {
  const origin = req.headers['origin']
  if (ALLOWED_ORIGINS_RAW.length > 0) {
    if (origin && ALLOWED_ORIGINS_RAW.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
    }
  } else if (!isProd) {
    // Dev convenience: no allowlist + non-prod → allow all.
    res.setHeader('Access-Control-Allow-Origin', '*')
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Max-Age', '600')
}

// ── Server ───────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  applyCors(req, res)

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  // ── /healthz ──────────────────────────────────────────────────────────────
  if (req.method === 'GET' && req.url && req.url.split('?')[0] === '/healthz') {
    const body = JSON.stringify({
      ok: true,
      version: pkg.version,
      adapters: adapters.map(a => a.name),
      auditLog: AUDIT_PATH,
      uploadDir: UPLOAD_DIR,
    })
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': String(Buffer.byteLength(body)),
    })
    res.end(body)
    return
  }

  // ── POST /feedback ────────────────────────────────────────────────────────
  if (req.method === 'POST' && req.url && req.url.split('?')[0] === '/feedback') {
    let body
    try {
      body = await readJsonBody(req)
    } catch (err) {
      const isTooLarge = err instanceof BodyReadError && err.code === 'payload_too_large'
      const status = isTooLarge ? 413 : 400
      const message = err instanceof BodyReadError ? err.message : 'Invalid JSON body'
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: message }))
      return
    }

    // Determine client IP. We only honour X-Forwarded-For when the operator
    // explicitly opts in via SNAPFEED_TRUST_PROXY=true — otherwise the
    // header is spoofable and rate-limit-per-IP becomes meaningless.
    let ip
    if (TRUST_PROXY) {
      const xff = req.headers['x-forwarded-for']
      ip =
        (typeof xff === 'string' ? xff.split(',')[0].trim() : Array.isArray(xff) ? xff[0] : '') ||
        req.socket.remoteAddress ||
        'unknown'
    } else {
      ip = req.socket.remoteAddress || 'unknown'
    }

    const expressReq = {
      body,
      ip,
      headers: req.headers,
    }
    const expressRes = adaptResponse(res)

    try {
      await middleware(expressReq, expressRes, err => {
        if (err) {
          console.error('[snapfeed] middleware error:', err)
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Internal error' }))
          }
        }
      })
    } catch (err) {
      console.error('[snapfeed] handler crashed:', err)
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Internal error' }))
      }
    }
    return
  }

  // ── 404 ───────────────────────────────────────────────────────────────────
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not found' }))
})

function start(port = PORT) {
  return new Promise((resolve, reject) => {
    // Surface listen errors (EADDRINUSE, EACCES, …) instead of leaving the
    // promise pending forever; the script-mode entrypoint at the bottom of
    // this file `.catch`es them and exits cleanly.
    const onError = err => {
      server.removeListener('listening', onListening)
      reject(err)
    }
    const onListening = () => {
      server.removeListener('error', onError)
      const actual = server.address()?.port ?? port
      console.log(
        `[snapfeed] worker v${pkg.version} listening on :${actual}\n` +
          `  adapters: ${adapters.length === 0 ? '(none)' : adapters.map(a => a.name).join(', ')}\n` +
          `  audit log: ${path.resolve(AUDIT_PATH)}\n` +
          `  uploads:   ${path.resolve(UPLOAD_DIR)} (storage adapter: ${storage.name})\n` +
          `  rate limit: ${RATE_LIMIT_MAX} req / ${RATE_LIMIT_WINDOW_MS}ms\n` +
          `  origins:   ${ALLOWED_ORIGINS_RAW.length === 0 ? (isProd ? '(none — requests will be rejected)' : '* (dev mode)') : ALLOWED_ORIGINS_RAW.join(', ')}\n` +
          `  trust proxy: ${TRUST_PROXY ? 'yes (X-Forwarded-For honoured)' : 'no'}`
      )
      resolve(server)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port)
  })
}

// Graceful shutdown (only when run as a script — tests manage their own server lifecycle).
function shutdown(signal) {
  console.log(`[snapfeed] received ${signal}, shutting down`)
  server.close(() => process.exit(0))
  // Hard-exit guard if close hangs.
  setTimeout(() => process.exit(1), 5_000).unref()
}

// Allow tests to import without auto-listening.
module.exports = { server, handlerConfig, adapters, auditLog, storage, start }

if (require.main === module) {
  start().catch(err => {
    console.error('[snapfeed] failed to start:', err && err.message ? err.message : err)
    process.exit(1)
  })
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}
