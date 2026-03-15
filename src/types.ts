/**
 * snapfeed — Core Type Definitions
 */

// ─── Payload ──────────────────────────────────────────────────────────────────

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
  /** Attached screenshot */
  screenshot?: FeedbackScreenshot
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
}

export interface FeedbackScreenshot {
  /** Raw base64 without data URI prefix */
  base64: string
  /** e.g. "image/png", "image/jpeg" */
  mimeType: string
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
   * @default "#D4714B"
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

export interface FeedbackContextValue {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
  submit: (payload: Omit<FeedbackPayload, 'timestamp' | 'appName'>) => Promise<void>
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
}
