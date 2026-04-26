#!/usr/bin/env node
/**
 * snapfeed CLI — `npx snapfeed init`
 *
 * Scaffolds a snapfeed config + .env.example (and a Next.js API route, when
 * applicable) into the current project. Zero runtime deps; only Node built-ins.
 */

import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs'
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
      out.hotkey = argv[++i]
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

function configFileContents(choices: InitChoices): string {
  const destLines = choices.destinations
    .map(d => `      // ${d}: ${envHintFor(d)}`)
    .join('\n')

  return `/**
 * snapfeed routing config
 * Generated by \`npx snapfeed init\`.
 *
 * See https://github.com/shimoverse/snapfeed for routing docs.
 */
import { defineRouting } from 'snapfeed'

export default defineRouting({
  // Per-route overrides go here. Example:
  // routes: [
  //   { match: { pageName: 'Billing' }, jira: 'BILL' },
  //   { match: { category: 'bug' }, github: 'my-org/my-app' },
  // ],
  routes: [],

  default: {
    mode: ${JSON.stringify(choices.mode)},
    hotkey: ${JSON.stringify(choices.hotkey)},
    // Destinations chosen during \`snapfeed init\`.
    // Replace these placeholders with real values, or set the matching
    // SNAPFEED_* env vars and use \`autoAdapters()\` instead.
${destLines || '      // (no destinations selected)'}
  },
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
  const adapterImports = ['autoAdapters']
  const importLine = `import { ${adapterImports.join(', ')} } from 'snapfeed/adapters'`

  return `/**
 * snapfeed feedback API route
 * Generated by \`npx snapfeed init\`.
 *
 * Set SNAPFEED_* env vars in .env.local and \`autoAdapters()\`
 * will pick them up automatically. Override here for custom routing.
 */
import { createFeedbackHandler } from 'snapfeed/server/nextjs'
${importLine}

export const POST = createFeedbackHandler({
  adapters: autoAdapters(),
  // rateLimit: { max: 10, windowMs: 60_000 },
  // allowedOrigins: ['https://your-app.com'],
})
`
}

// ─── Write w/ overwrite-prompt ──────────────────────────────────────────────

async function maybeWriteFile(
  path: string,
  contents: string,
  opts: { yes: boolean; label: string }
): Promise<'wrote' | 'skipped' | 'merged'> {
  if (existsSync(path)) {
    if (!opts.yes) {
      const ok = await confirm(`Overwrite ${opts.label} (${path})?`)
      if (!ok) {
        info(`  skipped ${opts.label}`)
        return 'skipped'
      }
    }
    writeFileSync(path, contents, 'utf8')
    info(`  overwrote ${opts.label}`)
    return 'wrote'
  }
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
      --mode=<n>            1=cloud-relayed, 2=self-hosted, 3=air-gapped
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
  if (project.isNextjs) {
    const routePath = join(project.cwd, 'app', 'api', 'feedback', 'route.ts')
    const routeDir = dirname(routePath)
    try {
      // mkdir -p
      const { mkdirSync } = await import('node:fs')
      mkdirSync(routeDir, { recursive: true })
    } catch {
      /* ignore */
    }
    await maybeWriteFile(routePath, nextjsRouteFileContents(choices), {
      yes: args.yes,
      label: 'app/api/feedback/route.ts',
    })
  }

  // ── README snippet ───────────────────────────────────────────────────────
  info('')
  info('Next steps:')
  info('  1. Install snapfeed if you haven\'t:  npm install snapfeed')
  info('  2. Copy .env.example → .env.local and fill in values for your destinations.')
  if (project.isNextjs) {
    info('  3. Wrap your app in <FeedbackProvider> (in app/layout.tsx) and run `next dev`.')
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
