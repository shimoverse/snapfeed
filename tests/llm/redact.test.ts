/**
 * Tests for src/llm/redact.ts
 *
 * Covers email, secret-pattern, JWT, high-entropy, and pass-through cases.
 */

import { describe, it, expect } from 'vitest'
import { redactForLLM } from '../../src/llm/redact'

describe('redactForLLM', () => {
  it('replaces emails with [EMAIL]', () => {
    const out = redactForLLM('contact ananya@company.com about the bug')
    expect(out).toBe('contact [EMAIL] about the bug')
  })

  it('redacts an API key pattern (key=...)', () => {
    const out = redactForLLM('config has key=sk_live_abc123 in it')
    expect(out).toContain('[REDACTED]')
    expect(out).not.toContain('sk_live_abc123')
  })

  it('redacts an Authorization: Bearer header', () => {
    const out = redactForLLM('header: Authorization: Bearer abcdef.ghi')
    expect(out).toContain('[REDACTED]')
    expect(out).not.toContain('abcdef.ghi')
  })

  it('redacts a JWT-shaped token', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
    const out = redactForLLM(`token is ${jwt} please`)
    expect(out).toContain('[REDACTED]')
    expect(out).not.toContain(jwt)
  })

  it('redacts a high-entropy random string with [HIGH_ENTROPY]', () => {
    // 50 chars, mixed case + digits, no spaces — looks like a token.
    const tok = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0Uv1Wx2Yz'
    const out = redactForLLM(`my token is ${tok} thanks`)
    expect(out).toContain('[HIGH_ENTROPY]')
    expect(out).not.toContain(tok)
  })

  it('redacts a credit-card-shaped digit group with [CC]', () => {
    const out = redactForLLM('paid with 4111 1111 1111 1111 today')
    expect(out).toContain('[CC]')
    expect(out).not.toContain('4111 1111 1111 1111')
  })

  it('leaves a normal sentence unchanged', () => {
    const input = 'The checkout button is misaligned on the payment page.'
    expect(redactForLLM(input)).toBe(input)
  })

  it('handles empty input safely', () => {
    expect(redactForLLM('')).toBe('')
  })

  it('does not redact short alphanumerics that are not high-entropy', () => {
    const input = 'order id ABC123 is failing'
    expect(redactForLLM(input)).toBe(input)
  })

  it('does not redact a long lowercase-only string (insufficient entropy)', () => {
    const input = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa is fine'
    // 46 lowercase a's — passes length but lacks mixed case + digits.
    expect(redactForLLM(input)).toBe(input)
  })
})
