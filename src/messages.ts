/**
 * snapfeed — UI message defaults + i18n merging.
 *
 * Every user-facing string in the default widget UI lives here. Override any
 * subset via `FeedbackProviderConfig.messages` to translate to another
 * language, rebrand button labels ("Send" → "Ship it"), or tweak voice.
 *
 * Token substitution: a few keys contain `{appName}`, `{who}`, `{okCount}`,
 * or `{failedCount}` placeholders. The widget swaps them at render time via
 * a tiny `format()` helper — no template engine, no dependencies.
 */

import type { FeedbackMessages } from './types'

/**
 * English defaults for every widget string. Stable across patch versions:
 * keys may be ADDED in minor releases (with sensible fallbacks via
 * `mergeMessages`), but never removed without a major version bump.
 */
export const defaultMessages: FeedbackMessages = {
  title: 'Share Feedback',
  subtitle: '',
  textareaPlaceholder:
    'What do you want to change or improve? (Ctrl+Enter to submit)',
  textareaLabel: 'Feedback',
  sendButton: 'Send Feedback',
  sendingButton: 'Sending…',
  cancelButton: 'Cancel',
  hint: 'Press Esc to dismiss · ⌃↵ to send',
  successTitle: 'Feedback sent!',
  successBody: 'Thanks for helping improve {appName}.',
  sendAnother: 'Send another',
  triggerLabel: 'Feedback',
  triggerTooltip: 'Send feedback',
  sendingAs: 'Sending as {who}',
  setName: 'set name',
  identityPromptTitle: 'Who should we attribute this to?',
  identityPromptBody:
    'Add your name or email so we know who reported this. Stored locally.',
  categoryBug: 'Bug',
  categoryIdea: 'Idea',
  categoryQuestion: 'Question',
  categoryPraise: 'Praise',
  categoryOther: 'Other',
  capturingScreenshot: 'Capturing screenshot…',
  annotateButton: '✏️ Annotate',
  replaceScreenshot: 'Replace',
  removeScreenshot: 'Remove screenshot',
  attachScreenshot: 'Attach or paste screenshot (⌘V)',
  dropZoneHint: 'Drop image to attach',
  voiceRecord: '🎙 Record voice',
  voiceRecording: 'Recording…',
  voiceStop: 'Stop',
  screenRecord: '⏺ Record screen',
  screenRecording: 'Recording screen…',
  errorTitle: 'Something went wrong',
  partialSuccessTitle: 'Partially sent',
  partialSuccessBody:
    'Delivered to {okCount} destination(s); {failedCount} failed.',
}

/**
 * Merge a caller-supplied partial overrides map on top of the English
 * defaults. Any missing key is filled in from `defaultMessages`, so
 * consumers can override one or two strings without re-stating the rest.
 *
 * Returns a fresh object — never mutates the input.
 */
export function mergeMessages(
  custom?: Partial<FeedbackMessages>
): FeedbackMessages {
  if (!custom) return { ...defaultMessages }
  return { ...defaultMessages, ...custom }
}

/**
 * Replace `{token}` placeholders in a message string. Unknown tokens are
 * left as-is so missing data is visible in QA rather than silently empty.
 *
 * @example format('Hi {who}', { who: 'Ananya' }) // "Hi Ananya"
 */
export function formatMessage(
  template: string,
  vars: Record<string, string | number | undefined>
): string {
  return template.replace(/\{(\w+)\}/g, (full, key: string) => {
    const v = vars[key]
    return v === undefined ? full : String(v)
  })
}
