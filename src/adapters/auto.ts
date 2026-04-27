/**
 * snapfeed — Environment-variable Auto Adapter
 *
 * Reads `process.env` and returns an array of adapters based on which
 * `SNAPFEED_*` variables are set. Lets users wire up integrations without
 * touching code: install snapfeed, set an env var, restart.
 *
 * @example
 * import { autoAdapters } from 'snapfeed/adapters'
 *
 * createFeedbackHandler({
 *   adapters: autoAdapters(),
 * })
 *
 * // Then, in `.env`:
 * //   SNAPFEED_SLACK_WEBHOOK=https://hooks.slack.com/services/...
 * //   SNAPFEED_GITHUB_TOKEN=ghp_...
 * //   SNAPFEED_GITHUB_REPO=my-org/my-app
 */

import type { FeedbackAdapter } from './types'
import { slackAdapter } from './slack'
import { discordAdapter } from './discord'
import { githubAdapter } from './github'
import { telegramAdapter } from './telegram'
import { webhookAdapter } from './webhook'
import { fileAdapter } from './file'
import { consoleAdapter } from './console'

/**
 * Environment variable keys consulted by `autoAdapters()`.
 * Exported so README / docs can reference the canonical list.
 */
export const AutoEnvKeys = {
  SLACK_WEBHOOK: 'SNAPFEED_SLACK_WEBHOOK',
  SLACK_USERNAME: 'SNAPFEED_SLACK_USERNAME',
  SLACK_CHANNEL: 'SNAPFEED_SLACK_CHANNEL',
  DISCORD_WEBHOOK: 'SNAPFEED_DISCORD_WEBHOOK',
  DISCORD_MENTION_ROLE: 'SNAPFEED_DISCORD_MENTION_ROLE',
  GITHUB_TOKEN: 'SNAPFEED_GITHUB_TOKEN',
  GITHUB_REPO: 'SNAPFEED_GITHUB_REPO',
  TELEGRAM_BOT_TOKEN: 'SNAPFEED_TELEGRAM_BOT_TOKEN',
  TELEGRAM_CHAT_ID: 'SNAPFEED_TELEGRAM_CHAT_ID',
  WEBHOOK_URL: 'SNAPFEED_WEBHOOK_URL',
  FILE_PATH: 'SNAPFEED_FILE_PATH',
} as const

export type AutoEnvKey = (typeof AutoEnvKeys)[keyof typeof AutoEnvKeys]

function readEnv(key: string): string | undefined {
  if (typeof process === 'undefined' || !process.env) return undefined
  const v = process.env[key]
  return v && v.length > 0 ? v : undefined
}

/**
 * Common unprefixed env vars users sometimes set when they forget the
 * SNAPFEED_ prefix. We warn (once per call) when one of these is set but
 * its SNAPFEED_-prefixed sibling is not — that's nearly always a typo
 * and silently falling back to the dev defaults is confusing.
 */
const COMMON_TYPO_KEYS = [
  'SLACK_WEBHOOK',
  'DISCORD_WEBHOOK',
  'GITHUB_TOKEN',
  'WEBHOOK_URL',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
] as const

function warnOnUnprefixedTypos(): void {
  if (typeof process === 'undefined' || !process.env) return
  for (const name of COMMON_TYPO_KEYS) {
    const unprefixed = process.env[name]
    const prefixed = process.env[`SNAPFEED_${name}`]
    if (unprefixed && unprefixed.length > 0 && (!prefixed || prefixed.length === 0)) {
      console.warn(
        `[snapfeed] Did you mean SNAPFEED_${name}? Found ${name} but snapfeed only reads SNAPFEED_-prefixed env vars.`
      )
    }
  }
}

/**
 * The full set of `SNAPFEED_*` env vars `autoAdapters()` knows about — the
 * canonical list from `AutoEnvKeys`. Used by the near-miss typo detector
 * below to suggest the closest known name.
 */
const KNOWN_SNAPFEED_KEYS = Object.values(AutoEnvKeys) as string[]
const KNOWN_SNAPFEED_KEYS_SET = new Set(KNOWN_SNAPFEED_KEYS)

/** Iterative Levenshtein. ~150 ops per pair — cheap at our env-var counts. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  // Single row, in-place — O(min(a, b)) memory.
  const m = a.length
  const n = b.length
  let prev = new Array<number>(n + 1)
  let curr = new Array<number>(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      curr[j] = Math.min(
        curr[j - 1]! + 1,        // insertion
        prev[j]! + 1,            // deletion
        prev[j - 1]! + cost      // substitution
      )
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[n]!
}

/**
 * For every `SNAPFEED_*` env var the user set that does NOT match a known
 * key, find the closest known key (Levenshtein distance ≤ 3 — covers
 * common single-char typos like missing letter, transposition, or a
 * one-letter substitution while staying away from coincidental matches).
 *
 * Skips values that are themselves valid `SNAPFEED_*` keys (so legitimate
 * `SNAPFEED_SLACK_USERNAME` doesn't get flagged as a typo of
 * `SNAPFEED_SLACK_WEBHOOK`).
 */
function warnOnNearMissTypos(): void {
  if (typeof process === 'undefined' || !process.env) return
  const userKeys = Object.keys(process.env).filter(
    (k) => k.startsWith('SNAPFEED_') && !KNOWN_SNAPFEED_KEYS_SET.has(k)
  )
  for (const k of userKeys) {
    let bestKey: string | undefined
    let bestDistance = Infinity
    for (const known of KNOWN_SNAPFEED_KEYS) {
      const d = levenshtein(k, known)
      if (d < bestDistance) {
        bestDistance = d
        bestKey = known
      }
    }
    // Distance ≤ 3 = plausible typo. Beyond that we'd hallucinate matches
    // for unrelated names like `SNAPFEED_TOTALLY_UNRELATED_THING`.
    if (bestKey && bestDistance > 0 && bestDistance <= 3) {
      console.warn(
        `[snapfeed] Did you mean ${bestKey}? Found ${k} but snapfeed does not read that variable.`
      )
    }
  }
}

/**
 * Inspect `process.env` and return the configured adapters.
 *
 * Detection order (all matching adapters are returned):
 *   1. `SNAPFEED_SLACK_WEBHOOK`     → slackAdapter
 *   2. `SNAPFEED_DISCORD_WEBHOOK`   → discordAdapter
 *   3. `SNAPFEED_GITHUB_TOKEN` + `SNAPFEED_GITHUB_REPO` → githubAdapter
 *   4. `SNAPFEED_TELEGRAM_BOT_TOKEN` + `SNAPFEED_TELEGRAM_CHAT_ID` → telegramAdapter
 *   5. `SNAPFEED_WEBHOOK_URL`       → webhookAdapter
 *   6. `SNAPFEED_FILE_PATH`         → fileAdapter
 *
 * If none match and `NODE_ENV !== 'production'`, falls back to
 * `[fileAdapter({ path: 'feedback.jsonl' }), consoleAdapter()]` so dev still
 * sees output. In production with no matches, returns `[]` and logs a single
 * warning via `console.warn`.
 */
export function autoAdapters(): FeedbackAdapter[] {
  // Surface common prefix-typos and near-miss typos before doing anything
  // else, so the warnings show up alongside whatever decision the rest of
  // the function makes.
  warnOnUnprefixedTypos()
  warnOnNearMissTypos()

  const adapters: FeedbackAdapter[] = []

  const slackWebhook = readEnv(AutoEnvKeys.SLACK_WEBHOOK)
  if (slackWebhook) {
    const username = readEnv(AutoEnvKeys.SLACK_USERNAME)
    const channel = readEnv(AutoEnvKeys.SLACK_CHANNEL)
    adapters.push(
      slackAdapter({
        webhookUrl: slackWebhook,
        ...(username ? { username } : {}),
        ...(channel ? { channel } : {}),
      })
    )
  }

  const discordWebhook = readEnv(AutoEnvKeys.DISCORD_WEBHOOK)
  if (discordWebhook) {
    const mentionRoleId = readEnv(AutoEnvKeys.DISCORD_MENTION_ROLE)
    adapters.push(
      discordAdapter({
        webhookUrl: discordWebhook,
        ...(mentionRoleId ? { mentionRoleId } : {}),
      })
    )
  }

  const githubToken = readEnv(AutoEnvKeys.GITHUB_TOKEN)
  const githubRepo = readEnv(AutoEnvKeys.GITHUB_REPO)
  if (githubToken && githubRepo) {
    // Strict validation: must be exactly "owner/repo". Silently dropping extra
    // segments (e.g. `owner/repo/extra`) hides the misconfiguration from the
    // user and risks creating issues against the wrong repo.
    const parts = githubRepo.split('/')
    const [owner, repo] = parts
    if (parts.length === 2 && owner && repo) {
      adapters.push(
        githubAdapter({
          token: githubToken,
          owner,
          repo,
          labels: ['snapfeed'],
        })
      )
    } else {
      console.warn(
        `[snapfeed] ${AutoEnvKeys.GITHUB_REPO} must be in "owner/repo" format; got "${githubRepo}". Skipping GitHub adapter.`
      )
    }
  }

  const telegramToken = readEnv(AutoEnvKeys.TELEGRAM_BOT_TOKEN)
  const telegramChat = readEnv(AutoEnvKeys.TELEGRAM_CHAT_ID)
  if (telegramToken && telegramChat) {
    adapters.push(
      telegramAdapter({ botToken: telegramToken, chatId: telegramChat })
    )
  }

  const webhookUrl = readEnv(AutoEnvKeys.WEBHOOK_URL)
  if (webhookUrl) {
    adapters.push(webhookAdapter({ url: webhookUrl }))
  }

  const filePath = readEnv(AutoEnvKeys.FILE_PATH)
  if (filePath) {
    adapters.push(fileAdapter({ path: filePath }))
  }

  if (adapters.length === 0) {
    const isProd =
      typeof process !== 'undefined' && process.env?.NODE_ENV === 'production'

    if (!isProd) {
      // Dev fallback. Surface a warning so first-time integrators don't
      // think the widget is broken when feedback only shows up in
      // ./feedback.jsonl + the console — both pre-v0.7 silent fallbacks
      // burned hours of confusion. Skipped if a near-miss typo warning
      // already fired (it explains the root cause better).
      const someTypoSuggested =
        typeof process !== 'undefined' &&
        process.env &&
        Object.keys(process.env).some(
          (k) =>
            k.startsWith('SNAPFEED_') && !KNOWN_SNAPFEED_KEYS_SET.has(k)
        )
      if (!someTypoSuggested) {
        console.warn(
          '[snapfeed] No SNAPFEED_* env vars detected — falling back to file + console adapters (writes to ./feedback.jsonl). ' +
            `Set one of ${KNOWN_SNAPFEED_KEYS.join(', ')} to wire a real destination.`
        )
      }
      return [fileAdapter({ path: 'feedback.jsonl' }), consoleAdapter()]
    }

    console.warn(
      '[snapfeed] No adapters configured. Set SNAPFEED_* env vars or pass adapters explicitly.'
    )
    return []
  }

  return adapters
}
