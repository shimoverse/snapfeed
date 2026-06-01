/**
 * Tests for src/cli-doctor.ts — `npx snapfeed doctor`.
 *
 * The orchestrator (runDoctor) does I/O, so we test the pure helpers
 * directly: env-file parsing, framework detection, env-var classification,
 * and report formatting. Manual smoke-test against examples/* covers
 * the wired path.
 */

import { describe, it, expect } from 'vitest'
import {
  parseEnvFile,
  detectFramework,
  classifyEnvVars,
  formatReport,
  scanHandlerSourceForProductionGuards,
  type DoctorReport,
  type CheckResult,
} from '../src/cli-doctor'

describe('parseEnvFile', () => {
  it('parses simple KEY=value pairs', () => {
    const out = parseEnvFile('FOO=bar\nBAZ=qux\n')
    expect(out).toEqual({ FOO: 'bar', BAZ: 'qux' })
  })

  it('strips surrounding double-quotes from values', () => {
    const out = parseEnvFile('FOO="bar with spaces"\n')
    expect(out).toEqual({ FOO: 'bar with spaces' })
  })

  it('strips surrounding single-quotes from values', () => {
    const out = parseEnvFile("FOO='bar'\n")
    expect(out).toEqual({ FOO: 'bar' })
  })

  it('skips blank lines and # comments', () => {
    const text = `
# this is a comment
FOO=bar

# another comment
BAZ=qux
`
    expect(parseEnvFile(text)).toEqual({ FOO: 'bar', BAZ: 'qux' })
  })

  it('preserves = in values (URL with query string)', () => {
    const out = parseEnvFile('URL=https://example.com/?a=1&b=2\n')
    expect(out).toEqual({ URL: 'https://example.com/?a=1&b=2' })
  })

  it('returns {} for empty input', () => {
    expect(parseEnvFile('')).toEqual({})
  })

  it('ignores malformed lines (no equals sign)', () => {
    expect(parseEnvFile('GARBAGE\nFOO=bar\n')).toEqual({ FOO: 'bar' })
  })
})

describe('detectFramework', () => {
  it('returns "nextjs" when next is in dependencies', () => {
    expect(
      detectFramework({
        dependencies: { next: '^14.0.0', react: '^18.0.0' },
      })
    ).toBe('nextjs')
  })

  it('returns "remix" when @remix-run/react is in dependencies', () => {
    expect(
      detectFramework({
        dependencies: { '@remix-run/react': '^2.0.0', react: '^18.0.0' },
      })
    ).toBe('remix')
  })

  it('returns "vite" when vite is in devDependencies + react in deps', () => {
    expect(
      detectFramework({
        dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' },
        devDependencies: { vite: '^5.0.0', '@vitejs/plugin-react': '^4.0.0' },
      })
    ).toBe('vite')
  })

  it('returns "unknown" for a package.json with no recognized framework', () => {
    expect(detectFramework({ dependencies: { express: '^4.0.0' } })).toBe('unknown')
  })

  it('prefers nextjs over remix when both are present (overlap edge case)', () => {
    // Some monorepo roots list both; pick the more specific Next.js path.
    expect(
      detectFramework({
        dependencies: { next: '^14.0.0', '@remix-run/react': '^2.0.0' },
      })
    ).toBe('nextjs')
  })
})

describe('classifyEnvVars', () => {
  it('reports a healthy SNAPFEED_SLACK_WEBHOOK as wired', () => {
    const result = classifyEnvVars({
      SNAPFEED_SLACK_WEBHOOK: 'https://hooks.slack.com/services/T/B/abc',
    })
    expect(result.detected).toContain('slack')
    expect(result.typos).toEqual([])
    expect(result.unprefixed).toEqual([])
  })

  it('flags an unprefixed SLACK_WEBHOOK as a typo suggestion', () => {
    const result = classifyEnvVars({ SLACK_WEBHOOK: 'https://...' })
    expect(result.detected).toEqual([])
    expect(result.unprefixed).toContainEqual({
      found: 'SLACK_WEBHOOK',
      suggested: 'SNAPFEED_SLACK_WEBHOOK',
    })
  })

  it('flags a near-miss SNAPFEED_SLACK_WEBHOK as a typo suggestion', () => {
    const result = classifyEnvVars({ SNAPFEED_SLACK_WEBHOK: 'https://...' })
    expect(result.detected).toEqual([])
    expect(result.typos).toContainEqual({
      found: 'SNAPFEED_SLACK_WEBHOK',
      suggested: 'SNAPFEED_SLACK_WEBHOOK',
    })
  })

  it('does NOT flag a SNAPFEED_* env var that is itself a known key', () => {
    const result = classifyEnvVars({
      SNAPFEED_SLACK_USERNAME: 'feedback-bot',
    })
    expect(result.typos).toEqual([])
  })

  it('detects multiple destinations at once', () => {
    const result = classifyEnvVars({
      SNAPFEED_SLACK_WEBHOOK: 'https://hooks.slack.com/services/T/B/abc',
      SNAPFEED_GITHUB_TOKEN: 'ghp_test',
      SNAPFEED_GITHUB_REPO: 'owner/repo',
    })
    expect(result.detected.sort()).toEqual(['github', 'slack'])
  })

  it('reports github as not-fully-wired when only token (no repo) is set', () => {
    const result = classifyEnvVars({
      SNAPFEED_GITHUB_TOKEN: 'ghp_test',
    })
    expect(result.detected).not.toContain('github')
    expect(result.partial).toContain('github')
  })
})

describe('scanHandlerSourceForProductionGuards', () => {
  it('detects active allowedOrigins and rateLimit guards', () => {
    const result = scanHandlerSourceForProductionGuards(`
      export const POST = createFeedbackHandler({
        adapters: autoAdapters(),
        rateLimit: { max: 10, windowMs: 60_000 },
        allowedOrigins: ['https://staging.example.com'],
      })
    `)

    expect(result).toEqual({ hasAllowedOrigins: true, hasRateLimit: true })
  })

  it('detects shorthand guard properties from the init scaffold', () => {
    const result = scanHandlerSourceForProductionGuards(`
      const allowedOrigins = (process.env.SNAPFEED_ALLOWED_ORIGINS ?? '')
        .split(',')
        .filter(Boolean)
      const rateLimit = { max: 10, windowMs: 60_000 }

      export const POST = createFeedbackHandler({
        adapters: autoAdapters(),
        allowedOrigins,
        rateLimit,
      })
    `)

    expect(result).toEqual({ hasAllowedOrigins: true, hasRateLimit: true })
  })

  it('ignores guards that are only commented examples', () => {
    const result = scanHandlerSourceForProductionGuards(`
      export const POST = createFeedbackHandler({
        adapters: autoAdapters(),
        // rateLimit: { max: 10, windowMs: 60_000 },
        // allowedOrigins: ['https://your-app.com'],
      })
    `)

    expect(result).toEqual({ hasAllowedOrigins: false, hasRateLimit: false })
  })
})

describe('formatReport', () => {
  function makeReport(checks: CheckResult[]): DoctorReport {
    return { snapfeedVersion: '0.7.0', cwd: '/test', checks }
  }

  it('includes ✓ markers for OK checks', () => {
    const out = formatReport(
      makeReport([
        { name: 'install', status: 'ok', message: 'snapfeed v0.7.0 installed' },
      ])
    )
    expect(out).toContain('✓')
    expect(out).toContain('snapfeed v0.7.0 installed')
  })

  it('includes ✗ markers for failed checks', () => {
    const out = formatReport(
      makeReport([
        { name: 'destinations', status: 'fail', message: 'No destinations wired', hint: 'Set SNAPFEED_SLACK_WEBHOOK' },
      ])
    )
    expect(out).toContain('✗')
    expect(out).toContain('No destinations wired')
    expect(out).toContain('SNAPFEED_SLACK_WEBHOOK')
  })

  it('includes ⚠ markers for warning checks', () => {
    const out = formatReport(
      makeReport([
        { name: 'enableInProduction', status: 'warn', message: 'Widget hidden in production' },
      ])
    )
    expect(out).toContain('⚠')
    expect(out).toContain('Widget hidden in production')
  })

  it('includes the snapfeed version and cwd in the header', () => {
    const out = formatReport(makeReport([]))
    expect(out).toContain('snapfeed v0.7.0')
    expect(out).toContain('/test')
  })
})
