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
export { msTeamsAdapter } from './adapters/msTeams'
export { asanaAdapter } from './adapters/asana'
export { clickUpAdapter } from './adapters/clickUp'
export { notionAdapter } from './adapters/notion'
export { autoAdapters, AutoEnvKeys } from './adapters/auto'
export type { AutoEnvKey } from './adapters/auto'

// ─── Release Campaigns (isomorphic) ──────────────────────────────────────────
export {
  defineCampaign,
  isCampaignActive,
  getCampaignTags,
  getCampaignRouting,
  campaignShareUrl,
} from './campaigns'
export type { ReleaseCampaign } from './campaigns'

// ─── Routing ──────────────────────────────────────────────────────────────────
export { defineRouting, matchUrl, resolveRoute, mergeDestinations } from './routing'
export type { RoutingConfig, RoutingRule, RoutingDestination } from './routing'

// ─── Screenshot utilities ─────────────────────────────────────────────────────
export { captureScreenshot, fileToScreenshot, extractImageFromClipboard } from './screenshot'

// ─── Theme tokens ─────────────────────────────────────────────────────────────
// Pure data; safe to import in any environment. Power-users who want only
// the theme can also import from `snapfeed/theme`.
export { lightTheme, darkTheme, themeToCss, extendTheme } from './theme'
export type { SnapfeedTheme, DeepPartial } from './theme'

// Headless API — see `snapfeed/headless` for the customization surface
// (compound components, render-prop, slot-swap provider).

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
