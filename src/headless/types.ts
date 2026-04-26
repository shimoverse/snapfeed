/**
 * snapfeed/headless — type definitions for the headless API.
 *
 * The headless surface lets consumers reuse snapfeed's submission +
 * form-state machinery while bringing their own UI. Types live in this
 * file so that hooks and components can share them without circular
 * imports.
 */

import type {
  FeedbackPayload,
  FeedbackCategory,
  FeedbackScreenshot,
} from '../types'
import type { SnapfeedTheme } from '../theme'

/**
 * The lifecycle of a feedback widget instance.
 *  - `idle`        — closed, no user interaction
 *  - `open`        — modal visible, user composing
 *  - `submitting`  — submit() in flight
 *  - `success`     — submit() resolved; auto-resets to `idle` after a moment
 *  - `error`       — submit() rejected; `error` is populated
 */
export type WidgetState = 'idle' | 'open' | 'submitting' | 'success' | 'error'

/**
 * Mutable form fields. Voice clip is optional and is only present when the
 * consumer wires up the voice capture flow (see `snapfeed/voice`).
 */
export interface FeedbackFormState {
  text: string
  category: FeedbackCategory | null
  screenshot: FeedbackScreenshot | null
  voiceClip?: { base64: string; mimeType: string; durationMs: number }
}

/** Imperative form helpers exposed by `useFeedbackWidget`. */
export interface FeedbackFormApi {
  text: string
  setText: (s: string) => void
  category: FeedbackCategory | null
  setCategory: (c: FeedbackCategory | null) => void
  screenshot: FeedbackScreenshot | null
  setScreenshot: (s: FeedbackScreenshot | null) => void
  /**
   * Capture a screenshot of the current page using `html2canvas` (optional
   * peer dep). On success, sets `screenshot`; on failure, leaves it untouched.
   */
  captureScreenshot: () => Promise<void>
  /** Clear all form fields. Does not change widget `state`. */
  reset: () => void
}

export interface UseFeedbackResult {
  state: WidgetState
  open: () => void
  close: () => void
  toggle: () => void
  /**
   * Submit the current form. `payload` is merged on top of the form state,
   * so callers can override or extend any field (e.g. add `metadata`).
   */
  submit: (payload?: Partial<FeedbackPayload>) => Promise<void>
  /** Imperative form helpers — use these to build your own form. */
  form: FeedbackFormApi
  /** Last submission error, if any. Cleared by the next `submit()` call. */
  error: Error | null
  /** Resolved theme tokens (reads from `FeedbackProvider`'s config). */
  theme: SnapfeedTheme
}
