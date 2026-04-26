/**
 * snapfeed — Voice Recording Helpers (browser only)
 *
 * Pure helpers around `MediaRecorder` + `getUserMedia`. No React, no DOM
 * mounting. The widget UI (planned for v0.5) wires `createVoiceRecorder()`
 * into a record button and renders its `onTick` for a progress meter.
 *
 * Resulting clips are returned as base64 + MIME type, parallel to
 * {@link FeedbackScreenshot}, so they slot directly into a future
 * `payload.voice` field.
 */

export interface VoiceClip {
  /** Raw audio bytes, base64-encoded (no `data:...;base64,` prefix). */
  base64: string
  /** e.g. `'audio/webm;codecs=opus'` or `'audio/mp4'`. */
  mimeType: string
  /** Wall-clock duration between `start()` and `stop()` in milliseconds. */
  durationMs: number
}

export interface VoiceRecorder {
  /** True after `start()` has resolved and before `stop()`/`cancel()`. */
  readonly isRecording: boolean
  /** Begin capture. Throws if already recording or mic permission denied. */
  start(): Promise<void>
  /** Stop and return the encoded clip. */
  stop(): Promise<VoiceClip>
  /** Stop and discard. Useful when the user closes the widget mid-record. */
  cancel(): void
  /** Optional progress callback, fired ~every 250ms with elapsed ms. */
  onTick?: (elapsedMs: number) => void
}

export interface VoiceRecorderOptions {
  /**
   * Maximum recording duration before `stop()` is invoked automatically.
   * @default 60000 (60s)
   */
  maxDurationMs?: number
  /**
   * Preferred MIME types in priority order. The first one that
   * `MediaRecorder.isTypeSupported()` accepts is used.
   * @default ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
   */
  preferredMimeTypes?: string[]
  /**
   * Forwarded to `getUserMedia({ audio: ... })`. When omitted, `audio: true`
   * is used (browser-default constraints).
   */
  audioConstraints?: MediaTrackConstraints
}

const DEFAULT_PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
]

const TICK_INTERVAL_MS = 250

/**
 * True iff we're in a browser-like environment that exposes both
 * `window.MediaRecorder` and `navigator.mediaDevices.getUserMedia`.
 */
export function isVoiceSupported(): boolean {
  if (typeof window === 'undefined') return false
  if (typeof (window as unknown as { MediaRecorder?: unknown }).MediaRecorder === 'undefined') {
    return false
  }
  if (typeof navigator === 'undefined') return false
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    return false
  }
  return true
}

/**
 * Returns the first MIME type from `preferred` that
 * `MediaRecorder.isTypeSupported()` accepts. Returns `null` if none of them
 * are supported, or if `MediaRecorder` is unavailable in this environment.
 */
export function pickSupportedMimeType(preferred: string[]): string | null {
  if (typeof window === 'undefined') return null
  const Recorder = (window as unknown as {
    MediaRecorder?: { isTypeSupported?: (mime: string) => boolean }
  }).MediaRecorder
  if (!Recorder || typeof Recorder.isTypeSupported !== 'function') {
    return null
  }
  for (const mime of preferred) {
    try {
      if (Recorder.isTypeSupported(mime)) return mime
    } catch {
      // Some browsers throw on unknown MIME — ignore and continue.
    }
  }
  return null
}

/**
 * Convert a Blob to base64 (without the `data:...;base64,` prefix) using
 * `FileReader.readAsDataURL`. Implemented this way rather than via
 * `Blob.arrayBuffer()` + manual encoding so we get the browser's own
 * native base64 path.
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result
      if (typeof dataUrl !== 'string') {
        reject(new Error('FileReader returned non-string result'))
        return
      }
      const commaIdx = dataUrl.indexOf(',')
      if (commaIdx === -1) {
        reject(new Error('FileReader result missing base64 comma separator'))
        return
      }
      resolve(dataUrl.slice(commaIdx + 1))
    }
    reader.onerror = () => {
      reject(reader.error ?? new Error('FileReader failed'))
    }
    reader.readAsDataURL(blob)
  })
}

/**
 * Create a one-shot voice recorder. Each instance is single-use in the sense
 * that `start()` then `stop()`/`cancel()` is the expected lifecycle, but the
 * returned object can be reused across multiple recordings if you call
 * `start()` again after `stop()` resolves.
 *
 * @example
 * const rec = createVoiceRecorder({ maxDurationMs: 30_000 })
 * rec.onTick = (ms) => updateProgress(ms / 30_000)
 * await rec.start()
 * // ...later, when user releases the record button:
 * const clip = await rec.stop()
 * payload.voice = clip
 */
export function createVoiceRecorder(options: VoiceRecorderOptions = {}): VoiceRecorder {
  const {
    maxDurationMs = 60_000,
    preferredMimeTypes = DEFAULT_PREFERRED_MIME_TYPES,
    audioConstraints,
  } = options

  let mediaStream: MediaStream | null = null
  let recorder: MediaRecorder | null = null
  let chunks: Blob[] = []
  let chosenMimeType = ''
  let startedAt = 0
  let stoppedAt = 0
  let recording = false
  let tickHandle: ReturnType<typeof setInterval> | null = null
  let autoStopHandle: ReturnType<typeof setTimeout> | null = null
  let stopResolve: ((clip: VoiceClip) => void) | null = null
  let stopReject: ((err: Error) => void) | null = null
  let cancelled = false

  const recorderObj: VoiceRecorder = {
    get isRecording() {
      return recording
    },

    async start() {
      if (recording) {
        throw new Error('Voice recorder already recording')
      }
      if (!isVoiceSupported()) {
        throw new Error(
          'Voice recording requires a browser with MediaRecorder + getUserMedia'
        )
      }

      const mime = pickSupportedMimeType(preferredMimeTypes)
      if (!mime) {
        throw new Error(
          `No supported MIME type found among: ${preferredMimeTypes.join(', ')}`
        )
      }
      chosenMimeType = mime

      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints ?? true,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        throw new Error(`getUserMedia failed: ${message}`)
      }

      chunks = []
      cancelled = false
      const RecorderCtor = (window as unknown as {
        MediaRecorder: new (stream: MediaStream, opts?: { mimeType?: string }) => MediaRecorder
      }).MediaRecorder
      recorder = new RecorderCtor(mediaStream, { mimeType: chosenMimeType })

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data)
        }
      }

      recorder.onstop = () => {
        stoppedAt = Date.now()
        clearTimers()
        releaseStream()

        if (cancelled) {
          recording = false
          return
        }

        const resolve = stopResolve
        const reject = stopReject
        stopResolve = null
        stopReject = null

        const blob = new Blob(chunks, { type: chosenMimeType })
        blobToBase64(blob).then(
          (base64) => {
            recording = false
            resolve?.({
              base64,
              mimeType: chosenMimeType,
              durationMs: Math.max(0, stoppedAt - startedAt),
            })
          },
          (err: unknown) => {
            recording = false
            const message = err instanceof Error ? err.message : String(err)
            reject?.(new Error(`Failed to encode voice clip: ${message}`))
          }
        )
      }

      recorder.onerror = (event: Event) => {
        const err = (event as unknown as { error?: Error }).error
        clearTimers()
        releaseStream()
        recording = false
        const reject = stopReject
        stopReject = null
        stopResolve = null
        reject?.(err ?? new Error('MediaRecorder error'))
      }

      startedAt = Date.now()
      recording = true
      recorder.start()

      tickHandle = setInterval(() => {
        if (recorderObj.onTick) {
          try {
            recorderObj.onTick(Date.now() - startedAt)
          } catch {
            // Don't let a buggy callback abort the recording.
          }
        }
      }, TICK_INTERVAL_MS)

      autoStopHandle = setTimeout(() => {
        if (recording) {
          // Fire and forget — the pending stop() promise (if any) will resolve.
          void recorderObj.stop().catch(() => {
            /* swallowed; stop()'s rejection path already notified its caller */
          })
        }
      }, maxDurationMs)
    },

    stop(): Promise<VoiceClip> {
      return new Promise((resolve, reject) => {
        if (!recording || !recorder) {
          reject(new Error('Voice recorder not currently recording'))
          return
        }
        // If a previous stop() is somehow already pending, supersede it.
        stopResolve = resolve
        stopReject = reject
        cancelled = false
        try {
          recorder.stop()
        } catch (err) {
          stopResolve = null
          stopReject = null
          const message = err instanceof Error ? err.message : String(err)
          reject(new Error(`MediaRecorder.stop failed: ${message}`))
        }
      })
    },

    cancel() {
      if (!recording) {
        // Even if not recording, make sure any leftover stream is released.
        releaseStream()
        clearTimers()
        return
      }
      cancelled = true
      // Reject any in-flight stop() — caller asked us to discard.
      const reject = stopReject
      stopResolve = null
      stopReject = null
      try {
        recorder?.stop()
      } catch {
        // Force teardown below regardless.
      }
      clearTimers()
      releaseStream()
      recording = false
      reject?.(new Error('Voice recording cancelled'))
    },
  }

  function clearTimers() {
    if (tickHandle !== null) {
      clearInterval(tickHandle)
      tickHandle = null
    }
    if (autoStopHandle !== null) {
      clearTimeout(autoStopHandle)
      autoStopHandle = null
    }
  }

  function releaseStream() {
    if (mediaStream) {
      try {
        mediaStream.getTracks().forEach((t) => t.stop())
      } catch {
        // Ignore — best-effort.
      }
      mediaStream = null
    }
    recorder = null
  }

  return recorderObj
}
