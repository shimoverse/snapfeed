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

// ─── Adapters (browser-safe subset) ─────────────────────────────────────────
//
// Only adapters that use pure `fetch` (no node built-ins) are re-exported
// from the main barrel. Server-only adapters that import `node:fs`,
// `node:path`, or `node:crypto` (`fileAdapter`, `googleSheetsAdapter`)
// must be imported from `snapfeed/adapters` instead — keeping them out of
// the main barrel prevents bundler warnings / failures in browser builds
// (Vite, Remix, etc.) for the common case where a consumer only wants
// the React widget.
//
// Migration from v0.5.x:
//   import { fileAdapter, googleSheetsAdapter } from 'snapfeed'
//     -> import { fileAdapter, googleSheetsAdapter } from 'snapfeed/adapters'
//
export { consoleAdapter } from './adapters/console'
export { webhookAdapter } from './adapters/webhook'
export { telegramAdapter } from './adapters/telegram'
export { slackAdapter } from './adapters/slack'
export { supabaseAdapter } from './adapters/supabase'
export { githubAdapter } from './adapters/github'
export { discordAdapter } from './adapters/discord'
export { jiraAdapter } from './adapters/jira'
export { linearAdapter } from './adapters/linear'
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

// ─── i18n / message strings ──────────────────────────────────────────────────
// Defaults + merger for every user-facing string in the widget UI. Override
// any subset via `FeedbackProviderConfig.messages` to translate or rebrand.
export { defaultMessages, mergeMessages, formatMessage } from './messages'

// Headless API — see `snapfeed/headless` for the customization surface
// (compound components, render-prop, slot-swap provider).

// ─── Types ────────────────────────────────────────────────────────────────────
export type {
  FeedbackPayload,
  FeedbackUser,
  FeedbackMetadata,
  FeedbackMessages,
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

// `defaultRateLimitStore` and the rest of the server-security helpers
// (`validatePayload`, `checkOrigin`, `checkRateLimit`, `normalizePayload`)
// have moved to the `snapfeed/server/security` subpath as of v0.6.0.
// They were removed from the main barrel because they are server-only and
// were forcing every browser bundle to walk through them.
//
// Migration from v0.5.x:
//   import { defaultRateLimitStore } from 'snapfeed'
//     -> import { defaultRateLimitStore } from 'snapfeed/server/security'
