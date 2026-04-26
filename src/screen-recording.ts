/**
 * snapfeed — Screen recording capture (browser-only).
 *
 * Wraps `getDisplayMedia` + `MediaRecorder` to capture short screen recordings
 * for inclusion in feedback payloads. Mirrors the shape of `voice.ts`.
 *
 * Usage:
 * ```ts
 * if (isScreenRecordingSupported()) {
 *   const recorder = createScreenRecorder({ maxDurationMs: 15_000 })
 *   await recorder.start()
 *   // … user demonstrates the bug …
 *   const clip = await recorder.stop()
 *   // clip.base64, clip.mimeType, clip.durationMs
 * }
 * ```
 *
 * Default `maxDurationMs` is 30s — short enough to keep payloads small while
 * letting a tester demonstrate a non-trivial bug. Consumers needing longer
 * captures should pass an explicit value.
 */

const DEFAULT_MIME_PREFERENCES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
] as const

const DEFAULT_MAX_DURATION_MS = 30_000

export interface ScreenRecording {
  /** Raw video bytes, base64 encoded (no `data:...;base64,` prefix). */
  base64: string
  /** MIME type the browser actually used. */
  mimeType: string
  /** Total recording duration in ms. */
  durationMs: number
}

export interface ScreenRecorderOptions {
  /** Auto-stop after this many ms. @default 30000 */
  maxDurationMs?: number
  /** Preferred MIME types in priority order. First supported is used. */
  preferredMimeTypes?: string[]
  /** MediaTrackConstraints forwarded to getDisplayMedia. */
  videoConstraints?: MediaTrackConstraints
  /** Capture system or tab audio. @default false */
  audio?: boolean
}

export interface ScreenRecorder {
  readonly isRecording: boolean
  start(): Promise<void>
  stop(): Promise<ScreenRecording>
  cancel(): void
  onTick?: (elapsedMs: number) => void
}

// ─── Capability detection ────────────────────────────────────────────────────

export function isScreenRecordingSupported(): boolean {
  if (typeof window === 'undefined') return false
  if (typeof (window as unknown as { MediaRecorder?: unknown }).MediaRecorder === 'undefined')
    return false
  if (typeof navigator === 'undefined') return false
  const md = (navigator as { mediaDevices?: { getDisplayMedia?: unknown } }).mediaDevices
  if (!md || typeof md.getDisplayMedia !== 'function') return false
  return true
}

export function pickSupportedMimeType(preferred: string[]): string | null {
  if (typeof window === 'undefined') return null
  const MR = (window as unknown as {
    MediaRecorder?: { isTypeSupported?: (m: string) => boolean }
  }).MediaRecorder
  if (!MR || typeof MR.isTypeSupported !== 'function') return null
  for (const m of preferred) {
    if (MR.isTypeSupported(m)) return m
  }
  return null
}

// ─── Recorder ────────────────────────────────────────────────────────────────

interface RawBlobLike {
  size: number
  type?: string
}

interface RawMediaRecorder {
  state: 'inactive' | 'recording' | 'paused'
  ondataavailable: ((e: { data: RawBlobLike }) => void) | null
  onstop: (() => void) | null
  onerror: ((e: unknown) => void) | null
  start(timeslice?: number): void
  stop(): void
}

interface RawMediaStream {
  getTracks(): { stop(): void }[]
}

export function createScreenRecorder(options: ScreenRecorderOptions = {}): ScreenRecorder {
  const maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS
  const preferred = options.preferredMimeTypes ?? [...DEFAULT_MIME_PREFERENCES]

  let isRecording = false
  let stream: RawMediaStream | null = null
  let recorder: RawMediaRecorder | null = null
  // Store the actual Blob objects from each `dataavailable` event. Earlier
  // versions stored only `{ size, type }` metadata, which caused the final
  // Blob constructor to serialize them as `"[object Object]"` and produce
  // a meaningless recording. The Blob constructor accepts BlobPart[] which
  // includes Blob, ArrayBuffer, and string — we keep `RawBlobLike` here
  // because the DOM lib type isn't always in scope.
  let chunks: RawBlobLike[] = []
  let mimeType = 'video/webm'
  let startedAt = 0
  let autoStopTimer: ReturnType<typeof setTimeout> | null = null
  let resolveStop: ((clip: ScreenRecording) => void) | null = null
  let rejectStop: ((err: unknown) => void) | null = null

  const recorderApi: ScreenRecorder = {
    get isRecording() {
      return isRecording
    },

    async start() {
      if (!isScreenRecordingSupported()) {
        throw new Error(
          'Screen recording requires a browser with getDisplayMedia + MediaRecorder'
        )
      }
      if (isRecording) {
        throw new Error('Screen recorder is already recording')
      }

      const chosen = pickSupportedMimeType(preferred) ?? preferred[0] ?? 'video/webm'
      mimeType = chosen

      const md = (navigator as unknown as {
        mediaDevices: {
          getDisplayMedia: (c: { video: MediaTrackConstraints | true; audio: boolean }) => Promise<RawMediaStream>
        }
      }).mediaDevices

      try {
        stream = await md.getDisplayMedia({
          video: options.videoConstraints ?? true,
          audio: options.audio === true,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(`Screen capture permission denied or unavailable: ${msg}`)
      }

      const MR = (window as unknown as {
        MediaRecorder: new (s: RawMediaStream, opts?: { mimeType?: string }) => RawMediaRecorder
      }).MediaRecorder

      recorder = new MR(stream, { mimeType: chosen })
      chunks = []

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          // Store the actual Blob (or BlobLike on test fakes) so the final
          // Blob constructor can read its bytes. Storing metadata here used
          // to discard the data entirely.
          chunks.push(e.data)
        }
      }

      recorder.onstop = () => {
        const clip: ScreenRecording = {
          base64: '',
          mimeType,
          durationMs: Date.now() - startedAt,
        }

        const totalSize = chunks.reduce((acc, c) => acc + c.size, 0)
        const BlobCtor = (globalThis as unknown as { Blob?: new (parts: unknown[], opts?: { type?: string }) => { size: number; type: string } }).Blob

        if (!BlobCtor || totalSize === 0) {
          finalize(clip)
          return
        }

        const blob = new BlobCtor(chunks, { type: chosen })
        const FRCtor = (globalThis as unknown as {
          FileReader?: new () => {
            result: string | null
            onloadend: (() => void) | null
            onerror: (() => void) | null
            readAsDataURL(b: { size: number; type: string }): void
          }
        }).FileReader

        if (!FRCtor) {
          finalize(clip)
          return
        }

        const reader = new FRCtor()
        reader.onloadend = () => {
          const result = reader.result ?? ''
          // MIME types like 'video/webm;codecs=vp9,opus' contain commas inside
          // their parameter list, so we can't naively split on the first ','.
          // The data URL format is `data:[<mediatype>][;base64],<data>` — find
          // the ';base64,' marker explicitly.
          const marker = ';base64,'
          const markerIdx = result.indexOf(marker)
          if (markerIdx >= 0) {
            clip.base64 = result.slice(markerIdx + marker.length)
          } else {
            // Fallback: split at the LAST comma (data is at the end)
            const lastComma = result.lastIndexOf(',')
            clip.base64 = lastComma >= 0 ? result.slice(lastComma + 1) : ''
          }
          finalize(clip)
        }
        reader.onerror = () => finalize(clip)
        reader.readAsDataURL(blob)
      }

      startedAt = Date.now()
      isRecording = true
      recorder.start()

      if (maxDurationMs > 0) {
        autoStopTimer = setTimeout(() => {
          if (isRecording && recorder) {
            try {
              recorder.stop()
            } catch {
              // ignore
            }
          }
        }, maxDurationMs)
      }
    },

    stop() {
      return new Promise<ScreenRecording>((resolve, reject) => {
        if (!isRecording || !recorder) {
          reject(new Error('Screen recorder is not running'))
          return
        }
        resolveStop = resolve
        rejectStop = reject
        try {
          recorder.stop()
        } catch (err) {
          rejectStop?.(err)
          cleanup()
        }
      })
    },

    cancel() {
      if (autoStopTimer) {
        clearTimeout(autoStopTimer)
        autoStopTimer = null
      }
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop()
        } catch {
          // ignore
        }
      }
      releaseStream()
      isRecording = false
      resolveStop = null
      rejectStop = null
      chunks = []
    },

    onTick: undefined,
  }

  function finalize(clip: ScreenRecording) {
    releaseStream()
    isRecording = false
    if (autoStopTimer) {
      clearTimeout(autoStopTimer)
      autoStopTimer = null
    }
    if (resolveStop) {
      resolveStop(clip)
      resolveStop = null
      rejectStop = null
    }
  }

  function releaseStream() {
    if (stream) {
      for (const t of stream.getTracks()) {
        try {
          t.stop()
        } catch {
          // ignore
        }
      }
      stream = null
    }
  }

  function cleanup() {
    releaseStream()
    isRecording = false
    if (autoStopTimer) {
      clearTimeout(autoStopTimer)
      autoStopTimer = null
    }
  }

  return recorderApi
}
