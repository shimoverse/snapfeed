/**
 * snapfeed — provider endpoint validation
 *
 * Custom endpoints (Azure OpenAI deployment URLs, in-tenant Anthropic
 * proxies, remote Ollama) are consumer-trusted: snapfeed validates the
 * scheme but NOT the host. The consumer is responsible for ensuring the
 * URL points at a service they trust with payload contents and API keys.
 *
 * What we DO check:
 *   1. The string parses via `new URL()`.
 *   2. The protocol is `http:` or `https:` (no `file:`, `data:`, `javascript:`).
 *   3. If `http:` AND not localhost, emit a one-time `console.warn` because
 *      the API key would be sent over the wire in plaintext.
 *
 * What we do NOT check:
 *   - DNS resolution / reachability
 *   - SSRF protection (private IP ranges, link-local addresses)
 *   - Certificate pinning
 *
 * Consumers worried about SSRF should run snapfeed inside an egress-
 * filtered network (a common pattern for production deployments).
 */

const httpEndpointWarned = new Set<string>()

export function validateEndpoint(endpoint: string, providerName: string): void {
  let parsed: URL
  try {
    parsed = new URL(endpoint)
  } catch {
    throw new Error(
      `${providerName} provider: endpoint "${endpoint}" is not a valid URL`
    )
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `${providerName} provider: endpoint protocol "${parsed.protocol}" is not allowed (must be http: or https:)`
    )
  }

  if (parsed.protocol === 'http:') {
    const host = parsed.hostname
    const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1'
    if (!isLoopback && !httpEndpointWarned.has(endpoint)) {
      httpEndpointWarned.add(endpoint)
      // eslint-disable-next-line no-console
      console.warn(
        `[snapfeed] LLM endpoint is http://; the API key will be sent in plaintext. Use https:// in production.`
      )
    }
  }
}

/**
 * Test-only: clear the one-time-warning cache so each test run can observe
 * the warning fresh. Not exported from the package barrel.
 */
export function _resetHttpEndpointWarnedForTests(): void {
  httpEndpointWarned.clear()
}
