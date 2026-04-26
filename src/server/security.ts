/**
 * snapfeed — Server-side security utilities
 *
 * Rate limiting, payload validation, origin checking.
 * Used internally by both the Next.js and Express handlers.
 */

import type { FeedbackHandlerConfig, FeedbackPayload, RateLimitStore } from '../types'

// ─── Cross-runtime UTF-8 byte length ─────────────────────────────────────────
// Vercel Edge, Cloudflare Workers, Deno, and browsers do not expose `Buffer`
// as a global. Prefer `TextEncoder` (a Web Platform standard available
// everywhere modern), and fall back to `Buffer` only when it exists (Node).
function utf8ByteLength(input: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(input).length
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.byteLength(input, 'utf8')
  }
  // Last-resort approximation: 1 byte per char. Only reached on truly exotic
  // runtimes; we'd rather under-validate than throw.
  return input.length
}

// ─── In-memory rate limit store (single instance) ────────────────────────────

interface MemoryEntry {
  count: number
  resetAt: number
}

const memoryStore = new Map<string, MemoryEntry>()

// Cap the in-memory rate-limit store so a high-cardinality IP flood (or a
// `x-forwarded-for` spoofing run) can't grow the map to GBs before the next
// sweep. When at the cap we evict the oldest 10% of entries by resetAt.
const RATE_LIMIT_MAX_KEYS = 10_000

function evictIfFull() {
  if (memoryStore.size < RATE_LIMIT_MAX_KEYS) return
  const entries = Array.from(memoryStore.entries())
  entries.sort((a, b) => a[1].resetAt - b[1].resetAt)
  const evictCount = Math.ceil(entries.length / 10)
  for (let i = 0; i < evictCount; i++) {
    const entry = entries[i]
    if (entry) memoryStore.delete(entry[0])
  }
}

// Clean up expired entries every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of memoryStore.entries()) {
      if (entry.resetAt < now) memoryStore.delete(key)
    }
  }, 5 * 60 * 1000)
}

export const defaultRateLimitStore: RateLimitStore = {
  async increment(key: string, windowMs: number) {
    const now = Date.now()
    const existing = memoryStore.get(key)

    if (!existing || existing.resetAt < now) {
      evictIfFull()
      const entry: MemoryEntry = { count: 1, resetAt: now + windowMs }
      memoryStore.set(key, entry)
      return { count: 1, resetAt: entry.resetAt }
    }

    existing.count++
    return { count: existing.count, resetAt: existing.resetAt }
  },
}

// ─── Rate limiter ─────────────────────────────────────────────────────────────

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
}

export async function checkRateLimit(
  ip: string,
  config: FeedbackHandlerConfig
): Promise<RateLimitResult> {
  const { rateLimit } = config
  if (!rateLimit) return { allowed: true, remaining: Infinity, resetAt: 0 }

  const max = rateLimit.max ?? 10
  const windowMs = rateLimit.windowMs ?? 60_000
  const store = rateLimit.store ?? defaultRateLimitStore

  const { count, resetAt } = await store.increment(ip, windowMs)
  const remaining = Math.max(0, max - count)
  const allowed = count <= max

  return { allowed, remaining, resetAt }
}

// ─── Payload validation ───────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean
  error?: string
}

export function validatePayload(
  body: unknown,
  config: FeedbackHandlerConfig
): ValidationResult {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Invalid request body' }
  }

  const payload = body as Record<string, unknown>

  // Required field
  if (!payload.text || typeof payload.text !== 'string' || !payload.text.trim()) {
    return { valid: false, error: 'Feedback text is required' }
  }

  // Text length hard cap (64KB absolute max, configurable soft cap)
  if (payload.text.length > 64_000) {
    return { valid: false, error: 'Feedback text is too long (max 64,000 characters)' }
  }

  // Payload size check (text + metadata, not screenshot)
  const maxPayload = config.maxPayloadBytes ?? 10_000
  const textSize = utf8ByteLength(payload.text as string)
  const metaSize = payload.metadata ? utf8ByteLength(JSON.stringify(payload.metadata)) : 0

  if (textSize + metaSize > maxPayload) {
    return {
      valid: false,
      error: `Payload too large (max ${Math.round(maxPayload / 1000)}KB)`,
    }
  }

  // Screenshot size check
  if (payload.screenshot) {
    const screenshot = payload.screenshot as Record<string, unknown>
    if (screenshot.base64 && typeof screenshot.base64 === 'string') {
      const maxScreenshot = config.maxScreenshotBytes ?? 5 * 1024 * 1024 // 5MB
      // base64 is ~4/3 the size of raw bytes
      const estimatedBytes = Math.ceil((screenshot.base64.length * 3) / 4)
      if (estimatedBytes > maxScreenshot) {
        return {
          valid: false,
          error: `Screenshot too large (max ${Math.round(maxScreenshot / 1024 / 1024)}MB)`,
        }
      }
    }
  }

  // Sanitize metadata console errors — strip anything that looks like a secret
  // (basic heuristic: lines containing "token", "key", "secret", "password", "bearer").
  // We mutate in place into a NEW array so the caller's original payload
  // object — which they may still hold references to — is not silently
  // rewritten. Earlier code reassigned `meta.consoleErrors` to a mapped copy,
  // which mutated the caller's metadata object too.
  if (payload.metadata && typeof payload.metadata === 'object') {
    const meta = payload.metadata as Record<string, unknown>
    if (Array.isArray(meta.consoleErrors)) {
      meta.consoleErrors = (meta.consoleErrors as string[]).map(err =>
        sanitizeConsoleError(String(err))
      )
    }
  }

  return { valid: true }
}

// ─── Origin checking ──────────────────────────────────────────────────────────

export function checkOrigin(
  origin: string | null | undefined,
  allowedOrigins: (string | RegExp)[] | undefined
): boolean {
  if (!allowedOrigins || allowedOrigins.length === 0) return true
  if (!origin) return false

  return allowedOrigins.some(allowed => {
    if (typeof allowed === 'string') return allowed === origin
    return allowed.test(origin)
  })
}

// ─── Normalize payload ────────────────────────────────────────────────────────

export function normalizePayload(body: unknown): FeedbackPayload {
  const raw = body as Partial<FeedbackPayload>
  return {
    text: (raw.text ?? '').trim(),
    appName: raw.appName ?? 'App',
    pageUrl: raw.pageUrl ?? '',
    pageName: raw.pageName ?? '',
    timestamp: raw.timestamp ?? new Date().toISOString(),
    category: raw.category,
    user: raw.user,
    metadata: raw.metadata,
    screenshot: raw.screenshot,
  }
}

// ─── Secret sanitizer ─────────────────────────────────────────────────────────

const SECRET_PATTERNS = [
  /token[=:\s]+\S+/gi,
  /key[=:\s]+\S+/gi,
  /secret[=:\s]+\S+/gi,
  /password[=:\s]+\S+/gi,
  /bearer\s+\S+/gi,
  /authorization[=:\s]+\S+/gi,
  // JWT pattern
  /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
]

function sanitizeConsoleError(error: string): string {
  let sanitized = error
  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]')
  }
  return sanitized
}
