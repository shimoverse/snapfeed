/**
 * snapfeed — pre-LLM redaction
 *
 * Applied to `payload.text` and console errors BEFORE any prompt leaves the
 * server. Catches the same patterns as `server/security.ts` plus emails,
 * credit-card-shaped digit groups, and high-entropy strings (likely tokens).
 *
 * We deliberately re-implement the SECRET_PATTERNS list here instead of
 * importing it from `server/security.ts`. The `llm/` module must remain
 * self-contained so it can be bundled / audited / air-gapped independently
 * of the server handler.
 *
 * This is a best-effort sweep, not a guarantee. Consumers who need stronger
 * guarantees should also enable the `features.redact` LLM pass downstream.
 */

const SECRET_PATTERNS: RegExp[] = [
  /token[=:\s]+\S+/gi,
  /key[=:\s]+\S+/gi,
  /secret[=:\s]+\S+/gi,
  /password[=:\s]+\S+/gi,
  /bearer\s+\S+/gi,
  /authorization[=:\s]+\S+/gi,
  // JWT pattern
  /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
]

// RFC-ish email pattern. Conservative — won't catch obscure quoted locals,
// but covers ~all real-world cases that show up in feedback text.
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g

// Credit-card-shaped: 13–19 digits, optionally separated by spaces or dashes
// in groups of 4. Lookarounds prevent matching mid-number.
const CC_PATTERN = /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g

/**
 * Detects high-entropy substrings that look like API tokens or random IDs.
 * Heuristic:
 *   - >= 40 chars
 *   - mixed case
 *   - contains digits
 *   - allowed set: alphanumerics, `_`, `-`, `.`, `+`, `/`, `=`
 *
 * This will redact long base64 / hex / JWT-ish blobs. False positives on
 * very long natural-language strings are unlikely because natural language
 * rarely has both upper+lower+digit density across 40 chars without spaces.
 */
const HIGH_ENTROPY_PATTERN = /[A-Za-z0-9_\-./+=]{40,}/g

function looksHighEntropy(s: string): boolean {
  let hasUpper = false
  let hasLower = false
  let hasDigit = false
  for (const c of s) {
    if (c >= 'A' && c <= 'Z') hasUpper = true
    else if (c >= 'a' && c <= 'z') hasLower = true
    else if (c >= '0' && c <= '9') hasDigit = true
    if (hasUpper && hasLower && hasDigit) return true
  }
  return false
}

export function redactForLLM(text: string): string {
  if (!text) return text

  let out = text

  // Order matters: redact known secret shapes first (before high-entropy
  // catch-all swallows them under a generic [HIGH_ENTROPY] tag — we want
  // [REDACTED] for the named patterns when possible).
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, '[REDACTED]')
  }

  out = out.replace(EMAIL_PATTERN, '[EMAIL]')
  out = out.replace(CC_PATTERN, '[CC]')

  out = out.replace(HIGH_ENTROPY_PATTERN, match => {
    return looksHighEntropy(match) ? '[HIGH_ENTROPY]' : match
  })

  return out
}
