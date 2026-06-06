/**
 * snapfeed — Core Type Definitions
 */

// ─── Payload ──────────────────────────────────────────────────────────────────

export type FeedbackCategory = 'bug' | 'idea' | 'question' | 'praise' | 'other'

export interface FeedbackPayload {
  /** The feedback text written by the user */
  text: string
  /** The application name (e.g. "MyApp", "Dashboard") */
  appName: string
  /** Full URL of the current page */
  pageUrl: string
  /** Human-readable name of the current page/section */
  pageName: string
  /** ISO 8601 timestamp of when feedback was submitted */
  timestamp: string
  /** Optional user context */
  user?: FeedbackUser
  /** Auto-collected browser metadata */
  metadata?: FeedbackMetadata
  /**
   * Agent-ready context for the host-page element the reviewer most recently
   * interacted with before opening/submitting snapfeed. Useful for coding
   * agents that need a selector, DOM path, component hint, or style snapshot.
   */
  target?: FeedbackTargetContext
  /** Attached screenshot */
  screenshot?: FeedbackScreenshot
  /** Feedback category tag */
  category?: FeedbackCategory
}

export interface FeedbackTargetContext {
  /** Lowercase tag name, e.g. "button" */
  tagName: string
  id?: string
  classes?: string[]
  /** Explicit ARIA role or a small inferred implicit role */
  role?: string
  ariaLabel?: string
  /** Normalized, bounded visible text from the element */
  text?: string
  /** Best-effort CSS selector for locating the element */
  selector: string
  /** Human-readable path from body to the element */
  domPath: string
  /** Optional component hint from data-component or data-snapfeed-component */
  componentName?: string
  /** Agent-useful attributes such as data-testid, name, type, href, title */
  attributes?: Record<string, string>
  /** Viewport-relative element bounds at capture time */
  boundingRect?: {
    x: number
    y: number
    width: number
    height: number
  }
  /** Bounded style snapshot for visual/UI agents */
  computedStyles?: Record<string, string>
}

export interface FeedbackUser {
  name?: string
  email?: string
}

export interface FeedbackMetadata {
  /** e.g. "1440x900" */
  viewport: string
  userAgent: string
  /** Last N console errors captured since page load */
  consoleErrors: string[]
  /**
   * Sanctioned extension seam for arbitrary string-valued context
   * (build SHA, git branch, environment, feature flags, release channel).
   *
   * This is the canonical way to attach build / release / flag context to a
   * payload until first-class top-level provider props (`buildId`, `gitSha`,
   * `env`) ship in v0.6. Keys/values are forwarded as-is to every adapter
   * destination and to the audit log.
   *
   * Set via the provider's `metadata` prop or in the server handler's
   * `onReceive` hook.
   *
   * @example { gitSha: 'abc123', env: 'staging', buildId: '4521' }
   */
  custom?: Record<string, string>
}

export interface FeedbackScreenshot {
  /** Raw base64 without data URI prefix */
  base64: string
  /** e.g. "image/png", "image/jpeg" */
  mimeType: string
}

// ─── i18n messages ───────────────────────────────────────────────────────────

/**
 * Every user-facing string in the default widget UI. Override any subset via
 * `FeedbackProviderConfig.messages` to translate or rebrand.
 *
 * Keys are stable across patch versions; new keys may be added in minor
 * versions but never removed without a major bump.
 */
export interface FeedbackMessages {
  /** Modal heading */
  title: string
  /** Sub-heading line under the title */
  subtitle: string
  /** Textarea placeholder */
  textareaPlaceholder: string
  /** Visually-hidden textarea label */
  textareaLabel: string
  /** Send button text */
  sendButton: string
  /** Send button while submitting */
  sendingButton: string
  /** Cancel / close button */
  cancelButton: string
  /** Bottom-of-modal hint, e.g. "Esc to dismiss · Ctrl+Enter to send" */
  hint: string
  /** Success heading after submit */
  successTitle: string
  /** Success body, supports {appName} placeholder */
  successBody: string
  /** "Send another" CTA in success state */
  sendAnother: string
  /** Floating trigger button text */
  triggerLabel: string
  /** Tooltip on the floating trigger */
  triggerTooltip: string
  /** "Sending as Ananya · change" identity readout (supports {who} placeholder) */
  sendingAs: string
  /** "(set name)" link when no identity */
  setName: string
  /** Identity prompt heading */
  identityPromptTitle: string
  /** Identity prompt body */
  identityPromptBody: string
  /** Category labels */
  categoryBug: string
  categoryIdea: string
  categoryQuestion: string
  categoryPraise: string
  categoryOther: string
  /** Capturing screenshot status */
  capturingScreenshot: string
  /** Annotate screenshot button */
  annotateButton: string
  /** Replace screenshot button */
  replaceScreenshot: string
  /** Remove screenshot button */
  removeScreenshot: string
  /** "Attach or paste screenshot (⌘V)" CTA when no image is attached */
  attachScreenshot: string
  /** Drop zone hint when dragging a file over */
  dropZoneHint: string
  /** Voice record button label */
  voiceRecord: string
  /** Voice recording in progress */
  voiceRecording: string
  /** Voice stop button */
  voiceStop: string
  /** Screen record button label */
  screenRecord: string
  /** Screen recording in progress */
  screenRecording: string
  /** Generic error fallback */
  errorTitle: string
  /** Partial-success heading */
  partialSuccessTitle: string
  /** Partial-success body, supports {okCount} {failedCount} placeholders */
  partialSuccessBody: string
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export interface FeedbackAdapter {
  name: string
  send(payload: FeedbackPayload): Promise<FeedbackAdapterResult>
}

export interface FeedbackAdapterResult {
  ok: boolean
  error?: string
  /** Adapter-specific delivery ID (e.g. Telegram message_id, Supabase row id) */
  deliveryId?: string
  /**
   * Non-fatal issues encountered while delivering. Adapter still counts as
   * `ok: true` (the primary message went through), but the caller can surface
   * these to the user — for example "delivered, screenshot upload failed".
   */
  warnings?: string[]
}

// ─── Provider Config ──────────────────────────────────────────────────────────

export type FeedbackPosition =
  | 'bottom-right'
  | 'bottom-left'
  | 'top-right'
  | 'top-left'

export type FeedbackTheme = 'auto' | 'light' | 'dark'

export interface FeedbackProviderConfig {
  /**
   * App name shown in UI and in adapter notifications.
   * @default "App"
   */
  appName?: string
  /**
   * Keyboard shortcut to toggle the widget.
   * Format: "ctrl+shift+f" or "meta+shift+f"
   * @default "ctrl+shift+f"
   */
  hotkey?: string
  /**
   * Position of the floating trigger button.
   * @default "bottom-right"
   */
  position?: FeedbackPosition
  /**
   * Color theme.
   * @default "auto"
   */
  theme?: FeedbackTheme
  /**
   * Accent/brand color for buttons and focus rings.
   * @default "#B85A36"
   */
  accentColor?: string
  /**
   * One or more adapters to send feedback through.
   * Multiple adapters all receive the same payload.
   */
  adapters?: FeedbackAdapter[]
  /**
   * Automatically collect browser metadata (URL, viewport, UA, console errors).
   * @default true
   */
  collectMetadata?: boolean
  /**
   * Automatically attach a bounded element snapshot for the last host-app
   * element the reviewer clicked/focused before opening snapfeed.
   *
   * Captures selector, DOM path, text, ARIA label, component hints, bounds,
   * and a small computed-style subset. snapfeed-owned UI is ignored.
   * @default true
   */
  collectElementContext?: boolean
  /**
   * Automatically capture a screenshot when the widget opens.
   * Requires html2canvas as an optional peer dependency.
   * @default false
   */
  autoScreenshot?: boolean
  /**
   * Show the widget in production environments.
   * Set to true only if you intentionally want end-users to use it.
   * @default false
   */
  enableInProduction?: boolean
  /**
   * Optional user context passed with every feedback submission.
   */
  user?: FeedbackUser
  /**
   * Mount a small floating trigger button by default (bottom-right). Lets a
   * tester who doesn't know the hotkey discover that the widget exists.
   *
   * Set to `false` to hide the trigger entirely (hotkey-only mode), or to a
   * custom CSS selector to portal the trigger into your own DOM.
   *
   * @default true
   */
  floatingButton?: boolean | string
  /**
   * Persist the in-progress draft (text + category + screenshot flag) to
   * `sessionStorage` keyed by `pageUrl`. Survives Esc / outside-click /
   * accidental hotkey-toggle. Cleared on successful submit.
   *
   * @default true
   */
  persistDraft?: boolean
  /**
   * Persist `user.name` / `user.email` in `localStorage` so a tester who
   * self-identifies once doesn't have to retype it. Merged with the
   * provider's `user` prop (provider wins).
   *
   * @default true
   */
  persistIdentity?: boolean
  /**
   * Override any user-facing string in the widget UI. Falls back to English
   * for any key not provided. Useful for i18n and brand-voice tweaks
   * ("Send" → "Ship it").
   *
   * Provide a flat string-key map. See `defaultMessages` in `src/messages.ts`
   * for the full key list (~20 keys: title, placeholder, send button,
   * categories, success/error states, etc.).
   */
  messages?: Partial<FeedbackMessages>
  /**
   * Extra metadata to attach to every payload. Merged into
   * `payload.metadata.custom` (see {@link FeedbackMetadata.custom}).
   *
   * Use for build SHA, git branch, environment, feature flags. Until
   * first-class top-level `buildId`/`gitSha`/`env` props land in v0.6, this
   * is the sanctioned way.
   *
   * @example { gitSha: process.env.NEXT_PUBLIC_GIT_SHA!, env: 'staging' }
   */
  metadata?: Record<string, string>
  /**
   * Custom API endpoint to POST feedback to.
   * When provided, the widget sends to this URL instead of calling adapters directly.
   * Use with createFeedbackHandler() on the server.
   * @default "/api/feedback"
   */
  apiUrl?: string
  /**
   * Called after feedback is successfully submitted.
   */
  onSuccess?: (payload: FeedbackPayload) => void
  /**
   * Called when feedback submission fails.
   */
  onError?: (error: Error) => void
}

// ─── Context ──────────────────────────────────────────────────────────────────

/**
 * Per-adapter delivery outcome surfaced back to the UI after a submit.
 * Mirrors the order of `config.adapters`. When the provider routes via
 * `apiUrl` instead of in-process adapters, this list is empty (the server
 * may report destinations in a future protocol revision).
 */
export interface FeedbackDeliveryRecord {
  /** Adapter name (e.g. "slack", "linear", "telegram"). */
  name: string
  /** True if the adapter accepted the payload (warnings still allowed). */
  ok: boolean
  /** Adapter-supplied delivery ID (e.g. Slack ts, Linear issue id). */
  deliveryId?: string
  /** Failure reason when `ok === false`. */
  error?: string
  /** Non-fatal issues (e.g. "screenshot upload failed but message went through"). */
  warnings?: string[]
}

export interface FeedbackContextValue {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
  submit: (payload: Omit<FeedbackPayload, 'timestamp' | 'appName'>) => Promise<void>
  /**
   * Delivery results from the most recent successful (or partially-successful)
   * `submit()`. Cleared on the next submit. Empty when routed through `apiUrl`
   * (the server doesn't currently echo back per-adapter results).
   */
  lastResults: FeedbackDeliveryRecord[]
  config: Required<
    Pick<
      FeedbackProviderConfig,
      | 'appName'
      | 'position'
      | 'theme'
      | 'accentColor'
      | 'collectMetadata'
      | 'autoScreenshot'
      | 'apiUrl'
    >
  > & FeedbackProviderConfig
}

// ─── Server Handler Config ────────────────────────────────────────────────────

export interface FeedbackHandlerConfig {
  adapters: FeedbackAdapter[]
  /**
   * Called before adapters run. Return false to reject the request.
   */
  onReceive?: (payload: FeedbackPayload) => boolean | Promise<boolean>
  /**
   * Called after all adapters complete.
   */
  onComplete?: (
    payload: FeedbackPayload,
    results: FeedbackAdapterResult[]
  ) => void | Promise<void>
  /**
   * Rate limiting configuration.
   * Uses an in-memory sliding window per IP by default.
   * For multi-instance deployments, provide a custom `rateLimitStore`.
   */
  rateLimit?: {
    /** Max requests per window. @default 10 */
    max?: number
    /** Window duration in milliseconds. @default 60000 (1 min) */
    windowMs?: number
    /** Custom store for distributed deployments (e.g. Redis/Upstash) */
    store?: RateLimitStore
  }
  /**
   * Max allowed payload size in bytes (text + metadata, not screenshot).
   * @default 10000 (10KB)
   */
  maxPayloadBytes?: number
  /**
   * Optional audit log sink. When set, the handler emits structured events
   * for `feedback.received`, `adapter.dispatched`, and `rate_limit.hit`.
   * See `snapfeed/audit-log` for `fileAuditLog`, `noopAuditLog`, `multiAuditLog`.
   *
   * `record(event)` failures are caught and logged via `console.error` —
   * audit logging never breaks the request flow.
   */
  auditLog?: {
    record(event: {
      type: string
      ts: string
      [key: string]: unknown
    }): Promise<void> | void
  }
  /**
   * Max screenshot size in bytes (base64 decoded).
   * @default 5242880 (5MB)
   */
  maxScreenshotBytes?: number
  /**
   * Allowlist of origins permitted to submit feedback.
   * If set, requests from other origins are rejected with 403.
   * Accepts exact strings or RegExp patterns.
   * @example ['https://myapp.com', /\.myapp\.com$/]
   */
  allowedOrigins?: (string | RegExp)[]
}

/**
 * Interface for a custom rate limit store (e.g. Redis, Upstash).
 * Implement this to share rate limit state across multiple server instances.
 */
export interface RateLimitStore {
  /** Increment hit count for key, return current count and reset time (ms epoch). */
  increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>
}
