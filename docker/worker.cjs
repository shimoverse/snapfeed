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
 *   ALLOWED_ORIGINS              CSV list; if empty + NODE_ENV !== production, allows *
 *   SNAPFEED_AUDIT_LOG_PATH      (default /data/audit/snapfeed.jsonl)
 *   SNAPFEED_UPLOAD_DIR          (default /data/uploads)
 *   SNAPFEED_RATE_LIMIT_MAX      (default 60)
 *   SNAPFEED_RATE_LIMIT_WINDOW_MS (default 60000)
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

const PORT = Number(process.env.WORKER_PORT || 8787)
const AUDIT_PATH = process.env.SNAPFEED_AUDIT_LOG_PATH || '/data/audit/snapfeed.jsonl'
const UPLOAD_DIR = process.env.SNAPFEED_UPLOAD_DIR || '/data/uploads'
const RATE_LIMIT_MAX = Number(process.env.SNAPFEED_RATE_LIMIT_MAX || 60)
const RATE_LIMIT_WINDOW_MS = Number(process.env.SNAPFEED_RATE_LIMIT_WINDOW_MS || 60_000)
const HASH_REPORTER =
  process.env.SNAPFEED_HASH_REPORTER === '1' ||
  process.env.SNAPFEED_HASH_REPORTER === 'true'

const ALLOWED_ORIGINS_RAW = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

const isProd = process.env.NODE_ENV === 'production'

// JSON body cap. Default is 11 MB so the 5 MB screenshot (base64 ≈ 4/3) fits.
const MAX_BODY_BYTES = Number(process.env.SNAPFEED_MAX_BODY_BYTES || 11 * 1024 * 1024)

// ── Wired components ─────────────────────────────────────────────────────────

const adapters = autoAdapters()
const auditLog = fileAuditLog({ path: AUDIT_PATH, hashReporter: HASH_REPORTER })

// Storage adapter is wired now so the consumer sees it boots cleanly. The
// server middleware does not yet route media through it (that ships in v0.6
// when uploads move out of the JSON body); for now, instantiate + log.
const storage = fileStorage({ dir: UPLOAD_DIR })

const handlerConfig = {
  adapters,
  rateLimit: { max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS },
  // Origin allowlist: only enforce when the operator configured one.
  // Empty list + non-prod = allow all (dev-mode convenience).
  allowedOrigins: ALLOWED_ORIGINS_RAW.length > 0 ? ALLOWED_ORIGINS_RAW : undefined,
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
  async onComplete(payload, results) {
    const ts = new Date().toISOString()
    await Promise.all(
      results.map((r, i) =>
        auditLog
          .record({
            type: 'adapter.dispatched',
            ts,
            adapter: adapters[i]?.name || `adapter[${i}]`,
            ok: !!r.ok,
            durationMs: 0,
            ...(r.deliveryId ? { deliveryId: r.deliveryId } : {}),
            ...(r.error ? { error: r.error } : {}),
            ...(r.warnings ? { warningsCount: r.warnings.length } : {}),
          })
          .catch(err => console.error('[snapfeed] audit log failed:', err))
      )
    )
  },
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

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0
    const chunks = []
    req.on('data', chunk => {
      total += chunk.length
      if (total > MAX_BODY_BYTES) {
        reject(new Error('payload too large'))
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
        reject(new Error('invalid JSON'))
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
      const msg = err && err.message === 'payload too large'
        ? 'Payload too large'
        : 'Invalid JSON body'
      const status = msg === 'Payload too large' ? 413 : 400
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: msg }))
      return
    }

    // Determine client IP (respect X-Forwarded-For from a trusted proxy).
    const xff = req.headers['x-forwarded-for']
    const ip =
      (typeof xff === 'string' ? xff.split(',')[0].trim() : Array.isArray(xff) ? xff[0] : '') ||
      req.socket.remoteAddress ||
      'unknown'

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
  return new Promise(resolve => {
    server.listen(port, () => {
      const actual = server.address()?.port ?? port
      console.log(
        `[snapfeed] worker v${pkg.version} listening on :${actual}\n` +
          `  adapters: ${adapters.length === 0 ? '(none)' : adapters.map(a => a.name).join(', ')}\n` +
          `  audit log: ${path.resolve(AUDIT_PATH)}\n` +
          `  uploads:   ${path.resolve(UPLOAD_DIR)} (storage adapter: ${storage.name})\n` +
          `  rate limit: ${RATE_LIMIT_MAX} req / ${RATE_LIMIT_WINDOW_MS}ms\n` +
          `  origins:   ${ALLOWED_ORIGINS_RAW.length === 0 ? (isProd ? '(none — requests rejected)' : '* (dev mode)') : ALLOWED_ORIGINS_RAW.join(', ')}`
      )
      resolve(server)
    })
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
  start()
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}
