/**
 * Tests for src/screen-recording.ts — browser screen recording utility.
 *
 * Mirrors the voice.test.ts pattern: stub navigator.mediaDevices.getDisplayMedia
 * and MediaRecorder + FileReader, drive the lifecycle, assert the result.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  createScreenRecorder,
  isScreenRecordingSupported,
  pickSupportedMimeType,
} from '../src/screen-recording'

// ─── Fakes ───────────────────────────────────────────────────────────────────

class FakeMediaStreamTrack {
  stopped = false
  kind: string
  constructor(kind: string) {
    this.kind = kind
  }
  stop() {
    this.stopped = true
  }
}

class FakeMediaStream {
  tracks: FakeMediaStreamTrack[]
  constructor(tracks: FakeMediaStreamTrack[] = [new FakeMediaStreamTrack('video')]) {
    this.tracks = tracks
  }
  getTracks() {
    return this.tracks
  }
}

const recorderRegistry: FakeMediaRecorder[] = []

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = []
  state: 'inactive' | 'recording' | 'paused' = 'inactive'
  ondataavailable: ((e: { data: { size: number } }) => void) | null = null
  onstop: (() => void) | null = null
  mimeType: string
  stream: FakeMediaStream
  constructor(stream: FakeMediaStream, opts: { mimeType?: string } = {}) {
    this.stream = stream
    this.mimeType = opts.mimeType ?? 'video/webm'
    recorderRegistry.push(this)
  }
  static isTypeSupported(mime: string) {
    // Pretend webm/opus + mp4 are supported; nothing else.
    return mime.startsWith('video/webm') || mime === 'video/mp4'
  }
  start() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    if (this.onstop) this.onstop()
  }
  emitChunk(size = 1024) {
    if (this.ondataavailable) this.ondataavailable({ data: { size } })
  }
}

class FakeBlob {
  size: number
  type: string
  constructor(parts: { size: number }[], opts: { type?: string } = {}) {
    this.size = parts.reduce((acc, p) => acc + (p.size ?? 0), 0)
    this.type = opts.type ?? ''
  }
}

class FakeFileReader {
  result: string | null = null
  onloadend: (() => void) | null = null
  onerror: (() => void) | null = null
  readAsDataURL(_blob: { size: number; type: string }) {
    queueMicrotask(() => {
      this.result = `data:${_blob.type};base64,VklERU8=` // 'VIDEO' base64
      if (this.onloadend) this.onloadend()
    })
  }
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

describe('isScreenRecordingSupported', () => {
  it('returns false when MediaRecorder is missing', () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: () => undefined } })
    expect(isScreenRecordingSupported()).toBe(false)
    vi.unstubAllGlobals()
  })

  it('returns false when getDisplayMedia is missing', () => {
    vi.stubGlobal('window', { MediaRecorder: FakeMediaRecorder })
    vi.stubGlobal('navigator', { mediaDevices: {} })
    expect(isScreenRecordingSupported()).toBe(false)
    vi.unstubAllGlobals()
  })

  it('returns true when both APIs present', () => {
    vi.stubGlobal('window', { MediaRecorder: FakeMediaRecorder })
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: () => undefined } })
    expect(isScreenRecordingSupported()).toBe(true)
    vi.unstubAllGlobals()
  })
})

describe('pickSupportedMimeType', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { MediaRecorder: FakeMediaRecorder })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the first supported MIME from the preference list', () => {
    expect(pickSupportedMimeType(['video/x-unsupported', 'video/webm'])).toBe('video/webm')
  })

  it('returns null when none are supported', () => {
    expect(pickSupportedMimeType(['video/x-foo', 'video/x-bar'])).toBe(null)
  })
})

describe('createScreenRecorder', () => {
  let getDisplayMediaSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    recorderRegistry.length = 0
    getDisplayMediaSpy = vi.fn(async () => new FakeMediaStream())
    vi.stubGlobal('window', { MediaRecorder: FakeMediaRecorder })
    vi.stubGlobal('navigator', {
      mediaDevices: { getDisplayMedia: getDisplayMediaSpy },
    })
    vi.stubGlobal('Blob', FakeBlob)
    vi.stubGlobal('FileReader', FakeFileReader)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('start() throws when not supported', async () => {
    vi.unstubAllGlobals()
    vi.stubGlobal('window', {})
    vi.stubGlobal('navigator', {})
    const r = createScreenRecorder()
    await expect(r.start()).rejects.toThrow(/screen recording requires/i)
  })

  it('happy path: start → emit chunks → stop returns a ScreenRecording with base64', async () => {
    const r = createScreenRecorder()
    await r.start()
    expect(r.isRecording).toBe(true)
    expect(getDisplayMediaSpy).toHaveBeenCalledOnce()

    const fakeRec = recorderRegistry[0]
    fakeRec.emitChunk(2048)
    fakeRec.emitChunk(1024)

    const stopPromise = r.stop()
    // Allow microtask + FileReader to resolve
    await Promise.resolve()
    const clip = await stopPromise

    expect(clip.base64).toBe('VklERU8=')
    expect(clip.mimeType).toMatch(/video\/webm/)
    expect(clip.durationMs).toBeGreaterThanOrEqual(0)
    expect(r.isRecording).toBe(false)
  })

  it('cancel() stops the stream and releases tracks', async () => {
    const r = createScreenRecorder()
    await r.start()
    const stream = recorderRegistry[0].stream
    r.cancel()
    expect(r.isRecording).toBe(false)
    expect(stream.getTracks()[0].stopped).toBe(true)
  })

  it('auto-stops after maxDurationMs', async () => {
    vi.useFakeTimers()
    const r = createScreenRecorder({ maxDurationMs: 5000 })
    await r.start()
    const fakeRec = recorderRegistry[0]
    fakeRec.emitChunk(1024)
    await vi.advanceTimersByTimeAsync(5100)
    // After auto-stop, recorder state is inactive
    expect(fakeRec.state).toBe('inactive')
    expect(r.isRecording).toBe(false)
  })

  it('passes audio: true to getDisplayMedia when requested', async () => {
    const r = createScreenRecorder({ audio: true })
    await r.start()
    expect(getDisplayMediaSpy).toHaveBeenCalledWith(
      expect.objectContaining({ audio: true })
    )
  })

  it('uses the preferredMimeTypes list', async () => {
    const r = createScreenRecorder({
      preferredMimeTypes: ['video/x-unsupported', 'video/webm'],
    })
    await r.start()
    expect(recorderRegistry[0].mimeType).toBe('video/webm')
  })
})
