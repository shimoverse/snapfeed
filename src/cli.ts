#!/usr/bin/env node
/**
 * snapfeed CLI — `npx snapfeed init`
 *
 * Scaffolds a snapfeed config + .env.example (and a Next.js API route, when
 * applicable) into the current project. Zero runtime deps; only Node built-ins.
 */

import { existsSync, readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'

// ─── Version ────────────────────────────────────────────────────────────────

function readSelfVersion(): string {
  try {
    // When bundled, the CLI may run as either CJS (__dirname defined) or ESM
    // (use import.meta.url). Probe both without referencing __dirname directly
    // (that identifier is undeclared under `module: esnext`).
    const g = globalThis as unknown as { __dirname?: string }
    const here =
      typeof g.__dirname === 'string'
        ? g.__dirname
        : dirname(fileURLToPath(import.meta.url))

    // Try ../package.json first (published layout: dist/cli.js → package.json)
    const candidates = [
      resolve(here, '..', 'package.json'),
      resolve(here, '..', '..', 'package.json'),
    ]
    for (const p of candidates) {
      if (existsSync(p)) {
        const pkg = JSON.parse(readFileSync(p, 'utf8')) as { name?: string; version?: string }
        if (pkg.name === 'snapfeed' && pkg.version) return pkg.version
      }
    }
  } catch {
    // fall through
  }
  return '0.0.0'
}

const VERSION = readSelfVersion()

// ─── Types ──────────────────────────────────────────────────────────────────

type Mode = 'cloud' | 'self-hosted' | 'air-gapped'

type Destination =
  | 'file'
  | 'console'
  | 'slack'
  | 'github'
  | 'jira'
  | 'linear'
  | 'sheets'
  | 'discord'
  | 'telegram'
  | 'webhook'

const ALL_DESTINATIONS: Destination[] = [
  'file',
  'console',
  'slack',
  'github',
  'jira',
  'linear',
  'sheets',
  'discord',
  'telegram',
  'webhook',
]

interface InitChoices {
  mode: Mode
  destinations: Destination[]
  hotkey: string
  isNextjs: boolean
  cwd: string
}

// ─── Arg parsing ────────────────────────────────────────────────────────────

interface ParsedArgs {
  command: string | undefined
  yes: boolean
  mode?: Mode
  destinations?: Destination[]
  hotkey?: string
  help: boolean
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { command: undefined, yes: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a) continue
    if (!a.startsWith('-') && !out.command) {
      out.command = a
      continue
    }
    if (a === '--yes' || a === '-y') {
      out.yes = true
    } else if (a === '--help' || a === '-h') {
      out.help = true
    } else if (a.startsWith('--mode=')) {
      const v = a.slice('--mode='.length)
      out.mode = parseModeFlag(v)
    } else if (a === '--mode') {
      const v = argv[++i] ?? ''
      out.mode = parseModeFlag(v)
    } else if (a.startsWith('--destinations=')) {
      out.destinations = parseDestinationsFlag(a.slice('--destinations='.length))
    } else if (a === '--destinations') {
      out.destinations = parseDestinationsFlag(argv[++i] ?? '')
    } else if (a.startsWith('--hotkey=')) {
      out.hotkey = a.slice('--hotkey='.length)
    } else if (a === '--hotkey') {
      out.hotkey = argv[++i] ?? ''
    }
  }
  return out
}

function parseModeFlag(v: string): Mode | undefined {
  const s = v.trim().toLowerCase()
  if (s === '1' || s === 'cloud' || s === 'cloud-relayed') return 'cloud'
  if (s === '2' || s === 'self-hosted' || s === 'selfhosted') return 'self-hosted'
  if (s === '3' || s === 'air-gapped' || s === 'airgapped') return 'air-gapped'
  return undefined
}

function parseDestinationsFlag(v: string): Destination[] {
  const items = v
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
  const valid: Destination[] = []
  for (const it of items) {
    if ((ALL_DESTINATIONS as string[]).includes(it)) {
      valid.push(it as Destination)
    } else {
      warn(`Unknown destination "${it}" — skipping.`)
    }
  }
  return valid
}

// ─── stdio helpers ──────────────────────────────────────────────────────────

const rl = () =>
  createInterface({ input: process.stdin, output: process.stdout })

function ask(question: string): Promise<string> {
  return new Promise(resolveQ => {
    const i = rl()
    i.question(question, ans => {
      i.close()
      resolveQ(ans)
    })
  })
}

async function confirm(question: string, defaultNo = true): Promise<boolean> {
  const suffix = defaultNo ? ' [y/N] ' : ' [Y/n] '
  const ans = (await ask(question + suffix)).trim().toLowerCase()
  if (!ans) return !defaultNo
  return ans === 'y' || ans === 'yes'
}

function info(msg: string) {
  process.stdout.write(msg + '\n')
}
function warn(msg: string) {
  process.stderr.write('[snapfeed] warn: ' + msg + '\n')
}
function err(msg: string) {
  process.stderr.write('[snapfeed] error: ' + msg + '\n')
}

// ─── Detection ──────────────────────────────────────────────────────────────

interface ProjectInfo {
  cwd: string
  isNextjs: boolean
  pkgPath: string
}

function detectProject(cwd: string): ProjectInfo | null {
  const pkgPath = join(cwd, 'package.json')
  if (!existsSync(pkgPath)) return null
  let isNextjs = false
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
    isNextjs = typeof allDeps['next'] === 'string'
  } catch {
    /* ignore */
  }
  return { cwd, isNextjs, pkgPath }
}

// ─── File generators ────────────────────────────────────────────────────────

/**
 * Maps a CLI `Destination` to the matching `RoutingDestination` field name
 * (and a placeholder value to put in the generated config). `console`/`file`
 * have no `RoutingDestination` slot — they're adapter-only — so they're
 * surfaced as inline comments instead of dropped silently.
 */
function routingFieldFor(d: Destination): { key: string; placeholder: string } | null {
  switch (d) {
    case 'slack':
      return { key: 'slack', placeholder: '#bugs' }
    case 'discord':
      return { key: 'discord', placeholder: '#bugs' }
    case 'github':
      return { key: 'github', placeholder: 'YOUR_ORG/YOUR_REPO' }
    case 'jira':
      return { key: 'jira', placeholder: 'YOUR_PROJECT_KEY' }
    case 'linear':
      return { key: 'linear', placeholder: 'YOUR_TEAM_ID' }
    case 'sheets':
      return { key: 'sheet', placeholder: 'YOUR_SHEET_ID' }
    // file/console/telegram/webhook live on the adapter side, not on
    // RoutingDestination. They're configured via env vars / autoAdapters().
    case 'file':
    case 'console':
    case 'telegram':
    case 'webhook':
      return null
  }
}

function configFileContents(choices: InitChoices): string {
  // Pick the first destination that maps to a real RoutingDestination field.
  // If none do (only file/console/etc.), default to a slack placeholder so
  // the generated config still type-checks AND demonstrates real usage.
  const routableDests = choices.destinations
    .map(d => ({ d, mapped: routingFieldFor(d) }))
    .filter((x): x is { d: Destination; mapped: { key: string; placeholder: string } } =>
      x.mapped !== null
    )

  const primary = routableDests[0]?.mapped ?? { key: 'slack', placeholder: '#bugs' }

  // Inline-commented hints for each chosen destination so the user can see
  // which env vars unlock which path. Adapter-only destinations (file/console)
  // are surfaced as comments, not as RoutingDestination fields. We use ` *  - `
  // (JSDoc continuation prefix) so the lines render cleanly inside the header.
  const destHints = choices.destinations
    .map(d => ` *   - ${d}: ${envHintFor(d)}`)
    .join('\n')

  // Build the default object. Always include exactly one real RoutingDestination
  // field so the generated file conforms to the type and is immediately useful.
  const defaultBlock = `{ ${primary.key}: ${JSON.stringify(primary.placeholder)} }`

  // Build the example route. Use the user's first chosen routable destination
  // (falling back to slack) and route 'bug' category to it.
  const exampleRoute = `    { category: 'bug', to: { ${primary.key}: ${JSON.stringify(primary.placeholder)} } },`

  return `/**
 * snapfeed routing config
 * Generated by \`npx snapfeed init\`.
 *
 * This config is loaded by your handler — see app/api/feedback/route.ts
 * for how \`resolveRoute\` is called.
 *
 * Mode chosen during init: ${choices.mode}
 * Hotkey chosen during init: ${choices.hotkey}
 *   (mode/hotkey are NOT routing fields — set \`hotkey\` on <FeedbackProvider>
 *    in your layout. They're recorded here as a hint for your team.)
 *
 * Destinations chosen during init:
${destHints || ' *   (none)'}
 *
 * Replace placeholder values with real ones, or set the matching SNAPFEED_*
 * env vars and use \`autoAdapters()\` in your handler.
 *
 * See https://github.com/shimoverse/snapfeed for routing docs.
 */
import { defineRouting } from 'snapfeed/routing'

export default defineRouting({
  routes: [
${exampleRoute}
  ],

  default: ${defaultBlock},
})
`
}

function envHintFor(d: Destination): string {
  switch (d) {
    case 'file':
      return "'feedback.jsonl'  // SNAPFEED_FILE_PATH"
    case 'console':
      return 'true              // (no env var; always available)'
    case 'slack':
      return "process.env.SNAPFEED_SLACK_WEBHOOK"
    case 'github':
      return "'YOUR_ORG/YOUR_REPO'  // SNAPFEED_GITHUB_TOKEN + SNAPFEED_GITHUB_REPO"
    case 'jira':
      return "'YOUR_PROJECT_KEY'   // SNAPFEED_JIRA_TOKEN + SNAPFEED_JIRA_HOST"
    case 'linear':
      return "'YOUR_TEAM_ID'        // SNAPFEED_LINEAR_TOKEN"
    case 'sheets':
      return "'YOUR_SHEET_ID'       // SNAPFEED_SHEETS_ID + SNAPFEED_SHEETS_KEY"
    case 'discord':
      return "process.env.SNAPFEED_DISCORD_WEBHOOK"
    case 'telegram':
      return "{ chatId: '...' }     // SNAPFEED_TELEGRAM_BOT_TOKEN + SNAPFEED_TELEGRAM_CHAT_ID"
    case 'webhook':
      return "process.env.SNAPFEED_WEBHOOK_URL"
  }
}

function envVarsFor(d: Destination): string[] {
  switch (d) {
    case 'file':
      return ['SNAPFEED_FILE_PATH=feedback.jsonl']
    case 'console':
      return [] // no env vars
    case 'slack':
      return [
        'SNAPFEED_SLACK_WEBHOOK=https://hooks.slack.com/services/XXX/YYY/ZZZ',
        '# SNAPFEED_SLACK_USERNAME=snapfeed',
        '# SNAPFEED_SLACK_CHANNEL=#feedback',
      ]
    case 'github':
      return [
        'SNAPFEED_GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx',
        'SNAPFEED_GITHUB_REPO=your-org/your-repo',
      ]
    case 'jira':
      return [
        'SNAPFEED_JIRA_HOST=https://your-org.atlassian.net',
        'SNAPFEED_JIRA_EMAIL=you@example.com',
        'SNAPFEED_JIRA_TOKEN=xxxxxxxxxxxxxxxxxxxx',
        'SNAPFEED_JIRA_PROJECT=YOUR_PROJECT_KEY',
      ]
    case 'linear':
      return [
        'SNAPFEED_LINEAR_TOKEN=lin_api_xxxxxxxxxxxxxxxxxxxx',
        'SNAPFEED_LINEAR_TEAM=YOUR_TEAM_ID',
      ]
    case 'sheets':
      return [
        'SNAPFEED_SHEETS_ID=1AbCdEfGhIjKlMnOpQrStUvWxYz',
        'SNAPFEED_SHEETS_KEY=base64-encoded-service-account-json',
      ]
    case 'discord':
      return ['SNAPFEED_DISCORD_WEBHOOK=https://discord.com/api/webhooks/XXX/YYY']
    case 'telegram':
      return [
        'SNAPFEED_TELEGRAM_BOT_TOKEN=123456:abcdef',
        'SNAPFEED_TELEGRAM_CHAT_ID=-1001234567890',
      ]
    case 'webhook':
      return ['SNAPFEED_WEBHOOK_URL=https://your-endpoint.example.com/feedback']
  }
}

function buildEnvExample(choices: InitChoices, existing: string | null): string {
  const header =
    '# Generated by `npx snapfeed init`\n' +
    '# Set any of these to wire that destination automatically via autoAdapters().\n'

  const sections = choices.destinations
    .filter(d => envVarsFor(d).length > 0)
    .map(d => `# ── ${d} ─────────────────────────────────────\n${envVarsFor(d).join('\n')}`)
    .join('\n\n')

  const generated = header + '\n' + sections + '\n'

  if (!existing) return generated

  // Merge: append a marked block if not already present.
  const marker = '# >>> snapfeed (added by snapfeed init) >>>'
  const endMarker = '# <<< snapfeed <<<'
  if (existing.includes(marker)) {
    return existing // already merged; leave alone
  }
  const trail = existing.endsWith('\n') ? '' : '\n'
  return (
    existing +
    trail +
    '\n' +
    marker +
    '\n' +
    generated +
    endMarker +
    '\n'
  )
}

function nextjsRouteFileContents(_choices: InitChoices): string {
  return `/**
 * snapfeed feedback API route (Next.js App Router)
 * Generated by \`npx snapfeed init\`.
 *
 * Set SNAPFEED_* env vars in .env.local and \`autoAdapters()\`
 * will pick them up automatically. Routing decisions come from
 * \`snapfeed.config.ts\` at the project root.
 */
import { createFeedbackHandler } from 'snapfeed/server/nextjs'
import { autoAdapters } from 'snapfeed/adapters'
import { resolveRoute } from 'snapfeed/routing'
import routing from '../../../snapfeed.config'

export const POST = createFeedbackHandler({
  adapters: autoAdapters(),
  // Run the file-based routing config and stash the resolved destination
  // on \`payload.metadata.custom\` (a sanctioned extension seam — see
  // FeedbackMetadata.custom in snapfeed types). Adapters can read it from
  // there to make destination-aware decisions.
  onReceive: async (payload) => {
    const dest = resolveRoute(payload, routing)
    payload.metadata = {
      ...(payload.metadata ?? { viewport: '', userAgent: '', consoleErrors: [] }),
      custom: { ...(payload.metadata?.custom ?? {}), route: JSON.stringify(dest) },
    }
    return true
  },
  // rateLimit: { max: 10, windowMs: 60_000 },
  // allowedOrigins: ['https://your-app.com'],
})
`
}

function nextjsPagesRouteFileContents(_choices: InitChoices): string {
  return `/**
 * snapfeed feedback API route (Next.js Pages Router)
 * Generated by \`npx snapfeed init\`.
 *
 * Set SNAPFEED_* env vars in .env.local and \`autoAdapters()\`
 * will pick them up automatically. Routing decisions come from
 * \`snapfeed.config.ts\` at the project root.
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { autoAdapters } from 'snapfeed/adapters'
import { resolveRoute } from 'snapfeed/routing'
import routing from '../../snapfeed.config'

const adapters = autoAdapters()

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const payload = req.body as {
    pageUrl?: string
    category?: string
    metadata?: { flags?: string[]; custom?: Record<string, string> }
  }

  // Run the file-based routing config and stash the resolved destination
  // on \`payload.metadata.custom\` (sanctioned extension seam).
  const dest = resolveRoute(
    {
      pageUrl: payload.pageUrl ?? '',
      ...(payload.category !== undefined ? { category: payload.category } : {}),
      ...(payload.metadata?.flags ? { metadata: { flags: payload.metadata.flags } } : {}),
    },
    routing
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const enriched = payload as any
  enriched.metadata = {
    ...(enriched.metadata ?? {}),
    custom: { ...(enriched.metadata?.custom ?? {}), route: JSON.stringify(dest) },
  }

  const results = await Promise.allSettled(adapters.map(a => a.send(enriched)))
  const anyOk = results.some(r => r.status === 'fulfilled' && r.value.ok)
  return res.status(anyOk ? 200 : 502).json({ ok: anyOk })
}
`
}

/**
 * Detect whether a Next.js project uses Pages Router, App Router, or both.
 * - app/ present (and pages/ absent OR app/ takes precedence): App Router
 * - only pages/ present: Pages Router
 * - neither present: default to App Router (greenfield)
 */
function detectNextRouter(cwd: string): 'app' | 'pages' {
  const hasApp = existsSync(join(cwd, 'app')) || existsSync(join(cwd, 'src', 'app'))
  const hasPages = existsSync(join(cwd, 'pages')) || existsSync(join(cwd, 'src', 'pages'))
  if (hasApp) return 'app'
  if (hasPages) return 'pages'
  return 'app'
}

// ─── Write w/ overwrite-prompt ──────────────────────────────────────────────

async function maybeWriteFile(
  path: string,
  contents: string,
  opts: { yes: boolean; label: string; ensureDir?: () => void }
): Promise<'wrote' | 'skipped' | 'merged'> {
  if (existsSync(path)) {
    if (!opts.yes) {
      const ok = await confirm(`Overwrite ${opts.label} (${path})?`)
      if (!ok) {
        info(`  skipped ${opts.label}`)
        return 'skipped'
      }
    }
    opts.ensureDir?.()
    writeFileSync(path, contents, 'utf8')
    info(`  overwrote ${opts.label}`)
    return 'wrote'
  }
  opts.ensureDir?.()
  writeFileSync(path, contents, 'utf8')
  info(`  created   ${opts.label}`)
  return 'wrote'
}

// ─── Main flow ──────────────────────────────────────────────────────────────

function printBanner() {
  info('')
  info(`  snapfeed v${VERSION}`)
  info('  Drop-in feedback widget for React/Next.js')
  info('')
}

function printHelp() {
  info(`snapfeed v${VERSION}

Usage:
  npx snapfeed init [flags]

Flags:
  -y, --yes                 Skip prompts; use defaults (file + console).
      --mode=<n>            1=cloud / 2=self-hosted / 3=air-gapped (also accepts string form: cloud, self-hosted, air-gapped)
      --destinations=<csv>  Comma-separated list, e.g. file,slack,github
      --hotkey=<key>        Hotkey to toggle the widget (default: ctrl+shift+f)
  -h, --help                Show this help

Files created:
  - snapfeed.config.ts at project root
  - .env.example (or merged into existing) at project root
  - app/api/feedback/route.ts when Next.js is detected
`)
}

async function runInit(args: ParsedArgs) {
  const cwd = process.cwd()
  const project = detectProject(cwd)
  if (!project) {
    err('snapfeed init must be run inside a Node project (no package.json found).')
    process.exit(1)
  }

  printBanner()
  info(`Detected: ${project.isNextjs ? 'Next.js project' : 'Generic Node/React project'}`)
  info(`Project root: ${project.cwd}`)
  info('')

  // ── Resolve choices (flags > prompts > defaults) ─────────────────────────
  let mode: Mode | undefined = args.mode
  let destinations: Destination[] | undefined = args.destinations
  let hotkey: string | undefined = args.hotkey

  if (args.yes) {
    mode ??= 'cloud'
    destinations ??= ['file', 'console']
    hotkey ??= 'ctrl+shift+f'
  } else {
    if (!mode) {
      const ans = (
        await ask('Mode: (1) Cloud-relayed [default]  (2) Self-hosted  (3) Air-gapped: ')
      ).trim()
      mode = parseModeFlag(ans) ?? 'cloud'
    }
    if (!destinations) {
      const ans = (
        await ask(
          'Where should feedback go? (comma-separated)\n' +
            '  options: file, console, slack, github, jira, linear, sheets, discord, telegram, webhook\n' +
            '  [default: file,console]: '
        )
      ).trim()
      destinations = ans
        ? parseDestinationsFlag(ans)
        : (['file', 'console'] as Destination[])
      if (destinations.length === 0) {
        warn('No valid destinations provided; falling back to file,console.')
        destinations = ['file', 'console']
      }
    }
    if (!hotkey) {
      const ans = (await ask('Hotkey [ctrl+shift+f]: ')).trim()
      hotkey = ans || 'ctrl+shift+f'
    }
  }

  const choices: InitChoices = {
    mode: mode!,
    destinations: destinations!,
    hotkey: hotkey!,
    isNextjs: project.isNextjs,
    cwd: project.cwd,
  }

  info('')
  info('Plan:')
  info(`  mode          ${choices.mode}`)
  info(`  destinations  ${choices.destinations.join(', ')}`)
  info(`  hotkey        ${choices.hotkey}`)
  info('')

  // ── Write snapfeed.config.ts ─────────────────────────────────────────────
  const configPath = join(project.cwd, 'snapfeed.config.ts')
  await maybeWriteFile(configPath, configFileContents(choices), {
    yes: args.yes,
    label: 'snapfeed.config.ts',
  })

  // ── Write/merge .env.example ─────────────────────────────────────────────
  const envExamplePath = join(project.cwd, '.env.example')
  let existingEnv: string | null = null
  try {
    if (existsSync(envExamplePath) && statSync(envExamplePath).isFile()) {
      existingEnv = readFileSync(envExamplePath, 'utf8')
    }
  } catch {
    /* ignore */
  }
  const envContents = buildEnvExample(choices, existingEnv)
  if (existingEnv) {
    // merging — never prompt, never wipe
    if (envContents !== existingEnv) {
      writeFileSync(envExamplePath, envContents, 'utf8')
      info('  merged    .env.example (snapfeed block appended)')
    } else {
      info('  unchanged .env.example (snapfeed block already present)')
    }
  } else {
    await maybeWriteFile(envExamplePath, envContents, {
      yes: args.yes,
      label: '.env.example',
    })
  }
  // Explicitly leave .env / .env.local alone — never touch them.

  // ── Write Next.js route ──────────────────────────────────────────────────
  let nextRouter: 'app' | 'pages' | undefined
  if (project.isNextjs) {
    nextRouter = detectNextRouter(project.cwd)
    if (nextRouter === 'pages') {
      const routePath = join(project.cwd, 'pages', 'api', 'feedback.ts')
      const routeDir = dirname(routePath)
      const ensureDir = () => {
        try {
          mkdirSync(routeDir, { recursive: true })
        } catch {
          /* ignore */
        }
      }
      await maybeWriteFile(routePath, nextjsPagesRouteFileContents(choices), {
        yes: args.yes,
        label: 'pages/api/feedback.ts',
        ensureDir,
      })
    } else {
      const routePath = join(project.cwd, 'app', 'api', 'feedback', 'route.ts')
      const routeDir = dirname(routePath)
      // mkdirSync is deferred to ensureDir so we don't leave an empty
      // app/api/feedback/ behind when the user declines the overwrite prompt.
      const ensureDir = () => {
        try {
          mkdirSync(routeDir, { recursive: true })
        } catch {
          /* ignore */
        }
      }
      await maybeWriteFile(routePath, nextjsRouteFileContents(choices), {
        yes: args.yes,
        label: 'app/api/feedback/route.ts',
        ensureDir,
      })
    }
  }

  // ── README snippet ───────────────────────────────────────────────────────
  info('')
  info('Next steps:')
  info('  1. Install snapfeed if you haven\'t:  npm install snapfeed')
  info('  2. Copy .env.example → .env.local and fill in values for your destinations.')
  if (project.isNextjs && nextRouter === 'app') {
    info('  3. Wrap your app in <FeedbackProvider>.')
    info('     The provider uses React state, so it must live inside a Client')
    info('     Component. Create app/snapfeed-client.tsx:')
    info('')
    info("       'use client'")
    info("       import { FeedbackProvider } from 'snapfeed'")
    info('       export function SnapfeedClient({ children }: { children: React.ReactNode }) {')
    info(`         return <FeedbackProvider appName="My App" hotkey="${choices.hotkey}">{children}</FeedbackProvider>`)
    info('       }')
    info('')
    info('     Then in app/layout.tsx wrap {children} with <SnapfeedClient>.')
    info('  4. Run `next dev`.')
  } else if (project.isNextjs) {
    info('  3. Wrap your app in <FeedbackProvider> in pages/_app.tsx, e.g.')
    info("       import { FeedbackProvider } from 'snapfeed'")
    info('       export default function App({ Component, pageProps }) {')
    info(`         return <FeedbackProvider appName="My App" hotkey="${choices.hotkey}"><Component {...pageProps} /></FeedbackProvider>`)
    info('       }')
    info('  4. Run `next dev`.')
  } else {
    info('  3. Wrap your app in <FeedbackProvider appName="My App"> and start your dev server.')
  }
  info('')
  info(`  Press ${choices.hotkey} to open the widget.`)
  info('')
  info('Docs: https://github.com/shimoverse/snapfeed#readme')
  info('')
}

// ─── Entry ──────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    printHelp()
    return
  }

  switch (args.command) {
    case undefined:
    case 'help':
      printHelp()
      return
    case 'init':
      await runInit(args)
      return
    default:
      err(`Unknown command "${args.command}". Run \`npx snapfeed --help\`.`)
      process.exit(1)
  }
}

main().catch(e => {
  err(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
