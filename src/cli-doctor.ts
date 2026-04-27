/**
 * snapfeed CLI — `npx snapfeed doctor`
 *
 * A health-check command that prints a green/yellow/red checklist of the
 * user's snapfeed setup. Designed to be the first thing they run when
 * "is this thing working?" The goal is for one screenful of output to
 * tell them exactly what's wrong and how to fix it.
 *
 * Pure helpers (parsing, classification, formatting) live in this file
 * for unit-test coverage. The `runDoctor()` orchestrator is wired from
 * src/cli.ts and does the I/O (reads package.json, .env files, optional
 * fetch against a dev server).
 *
 * Zero runtime deps; only Node built-ins.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// ─── Types ──────────────────────────────────────────────────────────────────

export type Framework = 'nextjs' | 'remix' | 'vite' | 'unknown'

export interface CheckResult {
  /** Stable identifier for the check (e.g. `'install'`, `'destinations'`). */
  name: string
  /** Outcome — `'ok'` is green, `'warn'` yellow, `'fail'` red. */
  status: 'ok' | 'warn' | 'fail'
  /** Short human-readable description of the result. */
  message: string
  /** Optional one-line fix suggestion shown indented under the message. */
  hint?: string
}

export interface DoctorReport {
  snapfeedVersion: string
  cwd: string
  checks: CheckResult[]
}

export interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

// ─── Pure helpers (unit-testable) ───────────────────────────────────────────

/**
 * Tiny `.env` parser. Handles `KEY=value`, `KEY="value with spaces"`,
 * `KEY='value'`, blank lines, and `# comment` lines. Does not interpolate
 * `${VAR}` references — `process.env` already does that for the running
 * process, and we want to inspect what's literally written in the file.
 */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eqIdx = line.indexOf('=')
    if (eqIdx === -1) continue
    const key = line.slice(0, eqIdx).trim()
    if (!key) continue
    let value = line.slice(eqIdx + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

/**
 * Identify the host framework from a parsed `package.json`. Returns one of
 * the known Frameworks or `'unknown'`. Order matters: Next.js wins over
 * Remix when both are present (rare, but seen in monorepo roots).
 */
export function detectFramework(pkg: PackageJson): Framework {
  const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
  if (typeof all['next'] === 'string') return 'nextjs'
  if (typeof all['@remix-run/react'] === 'string') return 'remix'
  if (typeof all['vite'] === 'string') return 'vite'
  return 'unknown'
}

/** The canonical SNAPFEED_* env var keys recognized by `autoAdapters()`. */
export const KNOWN_SNAPFEED_KEYS = [
  'SNAPFEED_SLACK_WEBHOOK',
  'SNAPFEED_SLACK_USERNAME',
  'SNAPFEED_SLACK_CHANNEL',
  'SNAPFEED_DISCORD_WEBHOOK',
  'SNAPFEED_DISCORD_MENTION_ROLE',
  'SNAPFEED_GITHUB_TOKEN',
  'SNAPFEED_GITHUB_REPO',
  'SNAPFEED_TELEGRAM_BOT_TOKEN',
  'SNAPFEED_TELEGRAM_CHAT_ID',
  'SNAPFEED_WEBHOOK_URL',
  'SNAPFEED_FILE_PATH',
] as const

/** Bare names the user sometimes sets when they forget the `SNAPFEED_` prefix. */
const COMMON_UNPREFIXED = [
  'SLACK_WEBHOOK',
  'DISCORD_WEBHOOK',
  'GITHUB_TOKEN',
  'WEBHOOK_URL',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
] as const

const KNOWN_KEYS_SET = new Set<string>(KNOWN_SNAPFEED_KEYS)

/** Levenshtein distance, single-row in-place. ~150 ops at our key lengths. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  let prev = new Array<number>(b.length + 1)
  let curr = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      curr[j] = Math.min(
        curr[j - 1]! + 1,
        prev[j]! + 1,
        prev[j - 1]! + cost
      )
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[b.length]!
}

export interface EnvClassification {
  /** Adapter names that will wire up given these env vars (e.g. ['slack', 'github']). */
  detected: string[]
  /** Adapters that have SOME but not ALL required env vars (e.g. github needs token + repo). */
  partial: string[]
  /** Bare names that look like a forgotten `SNAPFEED_` prefix. */
  unprefixed: Array<{ found: string; suggested: string }>
  /** SNAPFEED_-prefixed names that don't match any known key but are close to one. */
  typos: Array<{ found: string; suggested: string }>
}

/**
 * Inspect a flat `KEY=VALUE` map (from `.env` parse OR from `process.env`)
 * and report which destinations would wire up, plus typo suggestions for
 * anything that looks off.
 */
export function classifyEnvVars(env: Record<string, string>): EnvClassification {
  const detected: string[] = []
  const partial: string[] = []
  const unprefixed: Array<{ found: string; suggested: string }> = []
  const typos: Array<{ found: string; suggested: string }> = []

  // Wired destinations.
  if (env.SNAPFEED_SLACK_WEBHOOK) detected.push('slack')
  if (env.SNAPFEED_DISCORD_WEBHOOK) detected.push('discord')
  if (env.SNAPFEED_WEBHOOK_URL) detected.push('webhook')
  if (env.SNAPFEED_FILE_PATH) detected.push('file')

  if (env.SNAPFEED_GITHUB_TOKEN && env.SNAPFEED_GITHUB_REPO) {
    detected.push('github')
  } else if (env.SNAPFEED_GITHUB_TOKEN || env.SNAPFEED_GITHUB_REPO) {
    partial.push('github')
  }
  if (env.SNAPFEED_TELEGRAM_BOT_TOKEN && env.SNAPFEED_TELEGRAM_CHAT_ID) {
    detected.push('telegram')
  } else if (env.SNAPFEED_TELEGRAM_BOT_TOKEN || env.SNAPFEED_TELEGRAM_CHAT_ID) {
    partial.push('telegram')
  }

  // Unprefixed typos: the user set `SLACK_WEBHOOK` but not the prefixed form.
  for (const bare of COMMON_UNPREFIXED) {
    const prefixed = `SNAPFEED_${bare}`
    if (env[bare] && !env[prefixed]) {
      unprefixed.push({ found: bare, suggested: prefixed })
    }
  }

  // Near-miss typos: a SNAPFEED_-prefixed key that isn't a known one but is
  // close enough to suggest a fix.
  for (const k of Object.keys(env)) {
    if (!k.startsWith('SNAPFEED_')) continue
    if (KNOWN_KEYS_SET.has(k)) continue
    let bestKey: string | undefined
    let bestDistance = Infinity
    for (const known of KNOWN_SNAPFEED_KEYS) {
      const d = levenshtein(k, known)
      if (d < bestDistance) {
        bestDistance = d
        bestKey = known
      }
    }
    if (bestKey && bestDistance > 0 && bestDistance <= 3) {
      typos.push({ found: k, suggested: bestKey })
    }
  }

  return { detected, partial, unprefixed, typos }
}

/** Render a `DoctorReport` as colored monospace text suitable for a terminal. */
export function formatReport(report: DoctorReport): string {
  const ICONS = { ok: '✓', warn: '⚠', fail: '✗' }
  const lines: string[] = []
  // Only prepend "v" when the version looks like a semver — file: / link:
  // dependency specs render literally.
  const versionLabel = /^\d/.test(report.snapfeedVersion)
    ? `v${report.snapfeedVersion}`
    : report.snapfeedVersion
  lines.push(`snapfeed ${versionLabel} doctor`)
  lines.push(`cwd: ${report.cwd}`)
  lines.push('')
  for (const c of report.checks) {
    lines.push(`${ICONS[c.status]} ${c.message}`)
    if (c.hint) lines.push(`    ${c.hint}`)
  }
  lines.push('')
  const failed = report.checks.filter((c) => c.status === 'fail').length
  const warned = report.checks.filter((c) => c.status === 'warn').length
  const okd = report.checks.filter((c) => c.status === 'ok').length
  lines.push(`Summary: ${okd} OK · ${warned} warnings · ${failed} failures`)
  return lines.join('\n')
}

// ─── Orchestrator (I/O — invoked from cli.ts) ───────────────────────────────

export interface DoctorOptions {
  cwd: string
  /**
   * Optional URL to probe with a HEAD/GET — typically a running dev server's
   * `/api/feedback` route. Skipped if undefined.
   */
  probeUrl?: string
}

/**
 * Walk the cwd, accumulate checks, return the report.
 *
 * Side-effect-free apart from filesystem reads. Caller renders via
 * `formatReport` and prints.
 */
export async function runDoctor(opts: DoctorOptions): Promise<DoctorReport> {
  const checks: CheckResult[] = []

  // 1. snapfeed installed?
  const pkgPath = join(opts.cwd, 'package.json')
  let snapfeedInstalledVersion: string | undefined
  let pkg: PackageJson = {}
  if (existsSync(pkgPath)) {
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as PackageJson
      const all = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
      }
      snapfeedInstalledVersion = all['snapfeed']
      if (snapfeedInstalledVersion) {
        checks.push({
          name: 'install',
          status: 'ok',
          message: `snapfeed installed (${snapfeedInstalledVersion})`,
        })
      } else {
        checks.push({
          name: 'install',
          status: 'fail',
          message: 'snapfeed is not in package.json dependencies',
          hint: 'Run: npm install snapfeed',
        })
      }
    } catch {
      checks.push({
        name: 'install',
        status: 'fail',
        message: 'package.json could not be parsed',
      })
    }
  } else {
    checks.push({
      name: 'install',
      status: 'fail',
      message: 'No package.json in this directory',
      hint: 'Run snapfeed doctor from your project root.',
    })
  }

  // 2. Framework detection.
  const framework = detectFramework(pkg)
  checks.push({
    name: 'framework',
    status: framework === 'unknown' ? 'warn' : 'ok',
    message:
      framework === 'unknown'
        ? 'No supported framework detected (Next.js / Remix / Vite)'
        : `Framework: ${framework}`,
    ...(framework === 'unknown'
      ? {
          hint: 'snapfeed works with any React stack, but quickstarts assume Next.js / Remix / Vite.',
        }
      : {}),
  })

  // 3. .env files: discover, parse, classify.
  const envFiles = ['.env.local', '.env.development', '.env']
    .map((f) => join(opts.cwd, f))
    .filter((p) => existsSync(p))
  const envFromFiles: Record<string, string> = {}
  for (const f of envFiles) {
    try {
      Object.assign(envFromFiles, parseEnvFile(readFileSync(f, 'utf8')))
    } catch {
      /* skip unreadable file */
    }
  }
  // process.env wins over file (matches what the dev server actually sees).
  const env: Record<string, string> = {
    ...envFromFiles,
    ...Object.fromEntries(
      Object.entries(process.env).filter(([, v]) => typeof v === 'string')
    ) as Record<string, string>,
  }
  const cls = classifyEnvVars(env)

  if (cls.detected.length > 0) {
    checks.push({
      name: 'destinations',
      status: 'ok',
      message: `Destinations wired: ${cls.detected.join(', ')}`,
    })
  } else {
    checks.push({
      name: 'destinations',
      status: 'fail',
      message: 'No destinations wired (will fall back to file + console)',
      hint: 'Set one of SNAPFEED_SLACK_WEBHOOK / SNAPFEED_DISCORD_WEBHOOK / SNAPFEED_GITHUB_TOKEN+REPO / SNAPFEED_WEBHOOK_URL / SNAPFEED_FILE_PATH',
    })
  }

  for (const u of cls.unprefixed) {
    checks.push({
      name: 'typo',
      status: 'fail',
      message: `Found ${u.found} but snapfeed only reads ${u.suggested}`,
      hint: `Rename in your .env file: ${u.found} → ${u.suggested}`,
    })
  }
  for (const t of cls.typos) {
    checks.push({
      name: 'typo',
      status: 'fail',
      message: `Found ${t.found} (not a known snapfeed env var)`,
      hint: `Did you mean ${t.suggested}?`,
    })
  }
  for (const p of cls.partial) {
    if (p === 'github') {
      checks.push({
        name: 'partial',
        status: 'warn',
        message: 'GitHub adapter only partially wired',
        hint: 'Set BOTH SNAPFEED_GITHUB_TOKEN and SNAPFEED_GITHUB_REPO (format: owner/repo)',
      })
    } else if (p === 'telegram') {
      checks.push({
        name: 'partial',
        status: 'warn',
        message: 'Telegram adapter only partially wired',
        hint: 'Set BOTH SNAPFEED_TELEGRAM_BOT_TOKEN and SNAPFEED_TELEGRAM_CHAT_ID',
      })
    }
  }

  // 4. Production-readiness: NODE_ENV check.
  if (env.NODE_ENV === 'production') {
    checks.push({
      name: 'enableInProduction',
      status: 'warn',
      message: 'NODE_ENV=production detected. Make sure <FeedbackProvider enableInProduction> is set if you want end users to see the widget.',
      hint: 'Default is false (widget hidden in production for safety).',
    })
  }

  // 5. Optional dev-server probe.
  if (opts.probeUrl) {
    const probeResult = await probeApi(opts.probeUrl).catch((err) => ({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      status: 0,
    }))
    if (probeResult.ok) {
      checks.push({
        name: 'probe',
        status: 'ok',
        message: `API endpoint reachable at ${opts.probeUrl}`,
      })
    } else {
      checks.push({
        name: 'probe',
        status: 'fail',
        message: `API endpoint unreachable at ${opts.probeUrl}`,
        hint:
          probeResult.status === 0
            ? `Is your dev server running? (${probeResult.error})`
            : `HTTP ${probeResult.status} — check your handler is mounted.`,
      })
    }
  }

  // 6. Light scan for handler presence (advisory only).
  if (framework === 'nextjs') {
    const candidates = [
      'app/api/feedback/route.ts',
      'app/api/feedback/route.tsx',
      'app/api/feedback/route.js',
      'pages/api/feedback.ts',
      'pages/api/feedback.js',
    ]
    const found = candidates.find((p) => existsSync(join(opts.cwd, p)))
    if (found) {
      checks.push({
        name: 'handler',
        status: 'ok',
        message: `Handler file present: ${found}`,
      })
    } else {
      checks.push({
        name: 'handler',
        status: 'warn',
        message: 'No /api/feedback handler file found',
        hint: 'Create app/api/feedback/route.ts using createFeedbackHandler from snapfeed/server/nextjs.',
      })
    }
  }

  // Auto-detect snapfeed-config presence (advisory).
  const cfgFile = ['snapfeed.config.ts', 'snapfeed.config.js'].find((f) =>
    existsSync(join(opts.cwd, f))
  )
  if (cfgFile) {
    checks.push({
      name: 'config',
      status: 'ok',
      message: `Config present: ${cfgFile}`,
    })
  }

  return {
    snapfeedVersion: snapfeedInstalledVersion ?? 'not installed',
    cwd: opts.cwd,
    checks,
  }
}

/**
 * Tiny HEAD probe. Uses Node 18+ global `fetch`. Resolves with status info,
 * never throws — caller decides how to render failures.
 *
 * @internal
 */
async function probeApi(url: string): Promise<{ ok: boolean; status: number; error?: string }> {
  if (typeof fetch !== 'function') {
    return { ok: false, status: 0, error: 'global fetch not available (Node < 18?)' }
  }
  try {
    // Many handlers reject GET with 405; we accept that as "reachable."
    const res = await fetch(url, { method: 'GET' })
    return { ok: res.ok || res.status === 405, status: res.status }
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) }
  }
}

// Suppress unused-import warning for Node-only readdirSync; reserved for
// a future "scan src/ for FeedbackProvider mount" check.
void readdirSync
