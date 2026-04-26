// ─── React Components ─────────────────────────────────────────────────────────
export { FeedbackProvider } from './FeedbackProvider'
export { FeedbackWidget } from './FeedbackWidget'
export { FeedbackButton } from './FeedbackButton'
export type { FeedbackButtonProps } from './FeedbackButton'
export { FeedbackInbox } from './FeedbackInbox'
export type { FeedbackInboxProps } from './FeedbackInbox'
export { AnnotationCanvas } from './AnnotationCanvas'
export type { AnnotationCanvasProps } from './AnnotationCanvas'

// ─── Hooks ────────────────────────────────────────────────────────────────────
export { useDevFeedback } from './useDevFeedback'

// ─── Adapters (also available from snapfeed/adapters) ───────────────
export { consoleAdapter } from './adapters/console'
export { webhookAdapter } from './adapters/webhook'
export { telegramAdapter } from './adapters/telegram'
export { slackAdapter } from './adapters/slack'
export { supabaseAdapter } from './adapters/supabase'
export { githubAdapter } from './adapters/github'
export { fileAdapter } from './adapters/file'
export { discordAdapter } from './adapters/discord'
export { jiraAdapter } from './adapters/jira'
export { linearAdapter } from './adapters/linear'
export { googleSheetsAdapter } from './adapters/googleSheets'
export { autoAdapters, AutoEnvKeys } from './adapters/auto'
export type { AutoEnvKey } from './adapters/auto'

// ─── Routing ──────────────────────────────────────────────────────────────────
export { defineRouting, matchUrl, resolveRoute, mergeDestinations } from './routing'
export type { RoutingConfig, RoutingRule, RoutingDestination } from './routing'

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
  FeedbackCategory,
  RateLimitStore,
} from './types'

// ─── Server security utilities (for custom store implementations) ─────────────
export { defaultRateLimitStore } from './server/security'
