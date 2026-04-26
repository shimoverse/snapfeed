/**
 * Tests for src/adapters/file.ts — fileAdapter (JSONL)
 *
 * Each test uses a unique temp path to avoid bleeding state. Files are cleaned
 * up in afterAll.
 */

import { describe, it, expect, afterAll } from 'vitest'
import { fileAdapter } from '../../src/adapters/file'
import { readFile, unlink } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { FeedbackPayload } from '../../src/types'

const createdPaths: string[] = []
function tmpPath(label = 'snapfeed') {
  const p = path.join(
    os.tmpdir(),
    `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`
  )
  createdPaths.push(p)
  return p
}

const basePayload: FeedbackPayload = {
  text: 'hello',
  appName: 'TestApp',
  pageUrl: 'https://example.com/page',
  pageName: 'Page',
  timestamp: '2026-01-01T00:00:00.000Z',
}

afterAll(async () => {
  for (const p of createdPaths) {
    try {
      await unlink(p)
    } catch {
      // best-effort cleanup
    }
  }
})

describe('fileAdapter', () => {
  it('appends one JSONL line per send and is parseable JSON', async () => {
    const file = tmpPath()
    const adapter = fileAdapter({ path: file })

    expect(adapter.name).toBe('file')

    const r1 = await adapter.send(basePayload)
    const r2 = await adapter.send({ ...basePayload, text: 'second' })

    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)

    const contents = await readFile(file, 'utf8')
    const lines = contents.trim().split('\n')
    expect(lines).toHaveLength(2)

    const parsed1 = JSON.parse(lines[0]!)
    const parsed2 = JSON.parse(lines[1]!)
    expect(parsed1.text).toBe('hello')
    expect(parsed2.text).toBe('second')
  })

  it('returns { ok: true, deliveryId: <absolute path> }', async () => {
    const file = tmpPath()
    const adapter = fileAdapter({ path: file })
    const result = await adapter.send(basePayload)

    expect(result.ok).toBe(true)
    expect(result.deliveryId).toBe(file)
    expect(path.isAbsolute(result.deliveryId!)).toBe(true)
  })

  it('redacts screenshot.base64 by default', async () => {
    const file = tmpPath()
    const adapter = fileAdapter({ path: file })

    await adapter.send({
      ...basePayload,
      screenshot: { base64: 'AAAABBBBCCCCDDDD', mimeType: 'image/png' },
    })

    const parsed = JSON.parse((await readFile(file, 'utf8')).trim())
    expect(parsed.screenshot.base64).toBe('[base64 omitted]')
    expect(parsed.screenshot.mimeType).toBe('image/png')
  })

  it('preserves screenshot.base64 when redactScreenshot: false', async () => {
    const file = tmpPath()
    const adapter = fileAdapter({ path: file, redactScreenshot: false })

    await adapter.send({
      ...basePayload,
      screenshot: { base64: 'AAAABBBBCCCCDDDD', mimeType: 'image/png' },
    })

    const parsed = JSON.parse((await readFile(file, 'utf8')).trim())
    expect(parsed.screenshot.base64).toBe('AAAABBBBCCCCDDDD')
  })

  it('separates entries with \\n---\\n when pretty: true', async () => {
    const file = tmpPath()
    const adapter = fileAdapter({ path: file, pretty: true })

    await adapter.send(basePayload)
    await adapter.send({ ...basePayload, text: 'second' })

    const contents = await readFile(file, 'utf8')
    expect(contents).toContain('\n---\n')
    // Pretty JSON has indentation
    expect(contents).toMatch(/^\{\n {2}"text":/)

    const chunks = contents.split('\n---\n').filter((c) => c.trim())
    expect(chunks).toHaveLength(2)
    expect(JSON.parse(chunks[0]!).text).toBe('hello')
    expect(JSON.parse(chunks[1]!).text).toBe('second')
  })

  it('auto-creates parent directories if missing', async () => {
    const subdir = path.join(
      os.tmpdir(),
      `snapfeed-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      'nested',
      'feedback.jsonl'
    )
    createdPaths.push(subdir)

    const adapter = fileAdapter({ path: subdir })
    const result = await adapter.send(basePayload)

    expect(result.ok).toBe(true)
    const contents = await readFile(subdir, 'utf8')
    expect(JSON.parse(contents.trim()).text).toBe('hello')
  })
})
