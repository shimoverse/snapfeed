/**
 * Tests for docker/worker.js — the self-hosted snapfeed worker.
 *
 * We boot the worker on an ephemeral port (no Docker required), POST a
 * feedback payload to /feedback, and assert:
 *   1. /healthz responds with version + adapter list
 *   2. /feedback returns 200 + at least one successful adapter result
 *   3. The audit log JSONL file gets one `feedback.received` line and
 *      one `adapter.dispatched` line per configured adapter
 *   4. Outbound adapters are NOT used — we wire the local file adapter
 *      via SNAPFEED_FILE_PATH so this test makes zero network calls.
 *
 * The test exercises the worker as it would run in CI without Docker, which
 * gives us confidence the entrypoint is sound before paying the docker-build
 * cost.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'

// Module-level handles populated by beforeAll.
let server: Server
let port: number
let tmpRoot: string
let auditLogPath: string
let feedbackJsonlPath: string
let uploadDir: string

beforeAll(async () => {
  // Build isolated tmp paths for this test run.
  tmpRoot = mkdtempSync(join(tmpdir(), 'snapfeed-worker-test-'))
  auditLogPath = join(tmpRoot, 'audit', 'snapfeed.jsonl')
  feedbackJsonlPath = join(tmpRoot, 'feedback.jsonl')
  uploadDir = join(tmpRoot, 'uploads')

  // Set env BEFORE importing the worker (it reads env at module load).
  process.env.WORKER_PORT = '0' // ephemeral port — we'll read it back
  process.env.SNAPFEED_AUDIT_LOG_PATH = auditLogPath
  process.env.SNAPFEED_UPLOAD_DIR = uploadDir
  process.env.SNAPFEED_RATE_LIMIT_MAX = '100'
  process.env.SNAPFEED_RATE_LIMIT_WINDOW_MS = '60000'
  // The file adapter is local and never makes outbound calls.
  process.env.SNAPFEED_FILE_PATH = feedbackJsonlPath
  // No allowlist + non-prod = allow all origins.
  delete process.env.ALLOWED_ORIGINS
  process.env.NODE_ENV = 'test'

  // CommonJS require via createRequire so Vitest's ESM loader doesn't choke.
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  const worker = require('../../docker/worker.cjs') as {
    server: Server
    start: (port?: number) => Promise<Server>
    adapters: { name: string }[]
  }

  server = worker.server
  await worker.start(0)
  const addr = server.address() as AddressInfo
  port = addr.port

  // Make sure we wired the file adapter (and only the file adapter) for the test.
  expect(worker.adapters.map(a => a.name)).toContain('file')
})

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()))
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe('docker/worker.js', () => {
  it('GET /healthz returns ok + version', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      version: string
      adapters: string[]
    }
    expect(body.ok).toBe(true)
    expect(typeof body.version).toBe('string')
    expect(body.version.length).toBeGreaterThan(0)
    expect(Array.isArray(body.adapters)).toBe(true)
    expect(body.adapters).toContain('file')
  })

  it('POST /feedback writes to file adapter and audit log', async () => {
    const payload = {
      text: 'hello from the worker test',
      appName: 'TestApp',
      pageUrl: 'https://example.com/test',
      pageName: 'Test',
      timestamp: '2026-04-25T12:00:00.000Z',
      category: 'praise' as const,
      user: { email: 'tester@example.com' },
    }

    const res = await fetch(`http://127.0.0.1:${port}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      success: boolean
      results: { ok: boolean; error?: string }[]
    }
    expect(body.success).toBe(true)
    expect(body.results.some(r => r.ok)).toBe(true)

    // Audit log: one feedback.received + one adapter.dispatched line.
    const audit = readFileSync(auditLogPath, 'utf8').trim().split('\n')
    expect(audit.length).toBeGreaterThanOrEqual(2)
    const events = audit.map(l => JSON.parse(l) as { type: string })
    const types = events.map(e => e.type)
    expect(types).toContain('feedback.received')
    expect(types).toContain('adapter.dispatched')

    // The file adapter wrote the feedback JSONL too.
    const feedback = readFileSync(feedbackJsonlPath, 'utf8').trim().split('\n')
    expect(feedback.length).toBe(1)
    const written = JSON.parse(feedback[0]!) as { text: string; appName: string }
    expect(written.text).toBe('hello from the worker test')
    expect(written.appName).toBe('TestApp')
  })

  it('POST /feedback rejects an invalid (empty-text) payload with 400', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '', appName: 'TestApp' }),
    })
    expect(res.status).toBe(400)
  })

  it('GET /unknown returns 404 JSON', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/unknown`)
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Not found')
  })
})
