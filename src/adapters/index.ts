export { consoleAdapter } from './console'
export type { ConsoleAdapterOptions } from './console'

export { webhookAdapter } from './webhook'
export type { WebhookAdapterOptions } from './webhook'

export { telegramAdapter } from './telegram'
export type { TelegramAdapterOptions } from './telegram'

export { slackAdapter } from './slack'
export type { SlackAdapterOptions } from './slack'

export { supabaseAdapter } from './supabase'
export type { SupabaseAdapterOptions } from './supabase'

export type {
  FeedbackAdapter,
  FeedbackAdapterResult,
  FeedbackPayload,
  FeedbackUser,
  FeedbackMetadata,
  FeedbackScreenshot,
} from './types'
