/**
 * snapfeed — Server-side security utilities
 *
 * Rate limiting, payload validation, origin checking.
 * Used internally by both the Next.js and Express handlers.
 */

import type { FeedbackHandlerConfig, FeedbackPayload, RateLimitStore } from '../types'

// ─── In-memory rate limit store (single instance) ────────────────────────────

interface MemoryEntry {
  count: number
  resetAt: number
}

const memoryStore = new Map<string, MemoryEntry>()

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
  const textSize = Buffer.byteLength(payload.text as string, 'utf8')
  const metaSize = payload.metadata
    ? Buffer.byteLength(JSON.stringify(payload.metadata), 'utf8')
    : 0

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
  // (basic heuristic: lines containing "token", "key", "secret", "password", "bearer")
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
