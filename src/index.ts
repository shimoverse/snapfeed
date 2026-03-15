// ─── React Components ─────────────────────────────────────────────────────────
export { FeedbackProvider } from './FeedbackProvider'
export { FeedbackWidget } from './FeedbackWidget'
export { FeedbackButton } from './FeedbackButton'
export type { FeedbackButtonProps } from './FeedbackButton'

// ─── Hooks ────────────────────────────────────────────────────────────────────
export { useDevFeedback } from './useDevFeedback'

// ─── Adapters (also available from snapfeed/adapters) ───────────────
export { consoleAdapter } from './adapters/console'
export { webhookAdapter } from './adapters/webhook'
export { telegramAdapter } from './adapters/telegram'
export { slackAdapter } from './adapters/slack'
export { supabaseAdapter } from './adapters/supabase'

// ─── Screenshot utilities ─────────────────────────────────────────────────────
export { captureScreenshot, fileToScreenshot, extractImageFromClipboard } from './screenshot'

// ─── Types ────────────────────────────────────────────────────────────────────
export type {
  FeedbackPayload,
  FeedbackUser,
  FeedbackMetadata,
  FeedbackScreenshot,
  FeedbackAdapter,
  FeedbackAdapterResult,
  FeedbackProviderConfig,
  FeedbackContextValue,
  FeedbackHandlerConfig,
  FeedbackPosition,
  FeedbackTheme,
} from './types'
