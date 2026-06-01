/**
 * Tests for src/cli.ts (the `npx snapfeed init` scaffolder).
 *
 * We exercise the *compiled* CLI from dist/cli.cjs by spawning it as a
 * subprocess inside a tmp project directory. That mirrors how end users
 * invoke it via `npx snapfeed init` and exercises the full path —
 * including the no-side-effect-on-decline behaviour for the Next.js
 * route scaffold.
 *
 * Each test sets up its own tmp project, runs the CLI, and asserts on
 * the resulting filesystem state. No mocking, no internals.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI_PATH = resolve(__dirname, '..', 'dist', 'cli.cjs')

interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
}

function runCli(args: string[], cwd: string, stdinChunks: string[] = []): Promise<RunResult> {
  return new Promise((resolveP, rejectP) => {
    const proc = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd,
      env: { ...process.env, NODE_ENV: 'test' },
    })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    proc.on('error', rejectP)
    proc.on('close', code => {
      resolveP({ exitCode: code ?? 0, stdout, stderr })
    })
    for (const chunk of stdinChunks) {
      proc.stdin.write(chunk)
    }
    proc.stdin.end()
  })
}

let tmpRoot: string

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'snapfeed-cli-test-'))
})

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe('snapfeed init', () => {
  it('generates snapfeed.config.ts that mentions every chosen destination as a hint', async () => {
    writeFileSync(
      join(tmpRoot, 'package.json'),
      JSON.stringify({ name: 'test', version: '0.0.0' }),
    )

    const res = await runCli(
      ['init', '--yes', '--mode=cloud', '--destinations=file,console'],
      tmpRoot,
    )

    expect(res.exitCode).toBe(0)
    const config = readFileSync(join(tmpRoot, 'snapfeed.config.ts'), 'utf8')
    // Every chosen destination should appear in the JSDoc destination-hint
    // block (formatted as " *   - <dest>: ..." inside the header comment).
    expect(config).toMatch(/^ \* {3}- file:/m)
    expect(config).toMatch(/^ \* {3}- console:/m)
    // The config must use the subpath import for routing (matches docs).
    expect(config).toContain("from 'snapfeed/routing'")
    // file/console aren't RoutingDestination fields — the generator should
    // fall back to a slack placeholder so the default still type-checks.
    expect(config).toMatch(/default:\s*\{\s*slack:\s*"#bugs"/)
    // An ACTIVE example route is present (not commented out).
    expect(config).toMatch(/routes:\s*\[\s*\{[^}]*category:\s*'bug'/)
    // The header points users at the route file, making the connection explicit.
    expect(config).toContain('app/api/feedback/route.ts')
    expect(config).toContain('resolveRoute')
  })

  it('does NOT leave an empty app/api/feedback/ directory when the user declines the overwrite prompt', async () => {
    // Pretend this is a Next.js project so the CLI tries to write a route.
    writeFileSync(
      join(tmpRoot, 'package.json'),
      JSON.stringify({
        name: 'test',
        version: '0.0.0',
        dependencies: { next: '^14.2.0' },
      }),
    )

    // First run with --yes to scaffold the route (creates the dir + file).
    const first = await runCli(
      ['init', '--yes', '--mode=cloud', '--destinations=file,console'],
      tmpRoot,
    )
    expect(first.exitCode).toBe(0)
    const routePath = join(tmpRoot, 'app', 'api', 'feedback', 'route.ts')
    expect(existsSync(routePath)).toBe(true)

    // Now scrub the file and parent dir, then put the route file back so the
    // overwrite prompt fires next time. (We need a clean slate to test that
    // a *new* mkdir doesn't happen on decline.)
    rmSync(join(tmpRoot, 'app'), { recursive: true })
    expect(existsSync(join(tmpRoot, 'app'))).toBe(false)

    // Recreate just the route file (and its parents) so the prompt triggers.
    mkdirSync(dirname(routePath), { recursive: true })
    writeFileSync(routePath, '// existing handcrafted code\n')

    // Second run *without* --yes; feed "n" to every prompt (mode, destinations,
    // hotkey, and the overwrite prompts).
    const second = await runCli(
      ['init'],
      tmpRoot,
      // Mode prompt → empty (default cloud), destinations → empty (default),
      // hotkey → empty, overwrite snapfeed.config.ts → n,
      // overwrite .env.example → n, overwrite route.ts → n.
      ['\n', '\n', '\n', 'n\n', 'n\n', 'n\n'],
    )
    expect(second.exitCode).toBe(0)

    // The route file is still there (we said "no overwrite") with the
    // original handcrafted content — proving the CLI honoured the decline.
    expect(readFileSync(routePath, 'utf8')).toBe('// existing handcrafted code\n')
  })

  it('generates a slack-rooted RoutingConfig and a wired App Router handler', async () => {
    // Next.js project, slack destination → the generated config should bind
    // the user's chosen destination to a real RoutingDestination field, and
    // the route handler should import resolveRoute and the config.
    writeFileSync(
      join(tmpRoot, 'package.json'),
      JSON.stringify({
        name: 'test',
        version: '0.0.0',
        dependencies: { next: '^14.2.0' },
      }),
    )

    const res = await runCli(
      ['init', '--yes', '--destinations=slack'],
      tmpRoot,
    )
    expect(res.exitCode).toBe(0)

    // ── snapfeed.config.ts shape ──────────────────────────────────────────
    const configSource = readFileSync(join(tmpRoot, 'snapfeed.config.ts'), 'utf8')

    expect(configSource).toContain("import { defineRouting } from 'snapfeed/routing'")
    // Should contain a real RoutingDestination key (slack) and an active example route.
    // The placeholder is JSON.stringify'd, so it lands as "#bugs" (double quotes).
    expect(configSource).toMatch(/default:\s*\{\s*slack:\s*"#bugs"\s*\}/)
    expect(configSource).toMatch(
      /routes:\s*\[\s*\{[^}]*category:\s*'bug'[^}]*to:\s*\{\s*slack:\s*"#bugs"\s*\}\s*\}/
    )

    // Parse the file to a real RoutingConfig via dynamic import. Strip the
    // import line + replace `defineRouting(x)` with just `x` to make it a
    // self-contained module the test runner can evaluate without bundle resolution.
    const stripped = configSource
      .replace(/import\s*\{[^}]*\}\s*from\s*'snapfeed\/routing'\s*\n?/u, '')
      .replace(/export\s+default\s+defineRouting\(/u, 'export default (')

    const evalDir = join(tmpRoot, '.eval')
    mkdirSync(evalDir, { recursive: true })
    const evalPath = join(evalDir, 'snapfeed.config.eval.mjs')
    writeFileSync(evalPath, stripped, 'utf8')

    const mod = (await import(`file://${evalPath}`)) as {
      default: { routes: unknown[]; default?: Record<string, unknown> }
    }
    expect(Array.isArray(mod.default.routes)).toBe(true)
    expect(mod.default.routes.length).toBeGreaterThanOrEqual(1)
    expect(mod.default.default).toEqual({ slack: '#bugs' })

    // ── app/api/feedback/route.ts shape ──────────────────────────────────
    const routeSource = readFileSync(
      join(tmpRoot, 'app', 'api', 'feedback', 'route.ts'),
      'utf8',
    )
    expect(routeSource).toContain("import { resolveRoute } from 'snapfeed/routing'")
    expect(routeSource).toContain("import routing from '../../../snapfeed.config'")
    // The handler must wire resolveRoute via onReceive and include active
    // production guardrails (not merely commented examples).
    expect(routeSource).toMatch(/onReceive:[\s\S]*resolveRoute\(payload,\s*routing\)/)
    expect(routeSource).toContain('const allowedOrigins =')
    expect(routeSource).toContain("SNAPFEED_ALLOWED_ORIGINS must be set")
    expect(routeSource).toMatch(/allowedOrigins,/)
    expect(routeSource).toContain('const rateLimit =')
    expect(routeSource).toMatch(/rateLimit,/)

    // ── "Next steps" output must include the literal `<FeedbackProvider` snippet ──
    expect(res.stdout).toContain('<FeedbackProvider')
    expect(res.stdout).toContain("'use client'")
  })

  it('generates a Pages Router handler when only pages/ exists', async () => {
    writeFileSync(
      join(tmpRoot, 'package.json'),
      JSON.stringify({
        name: 'test',
        version: '0.0.0',
        dependencies: { next: '^13.0.0' },
      }),
    )
    // Pre-create pages/ to make this look like a Pages Router project.
    mkdirSync(join(tmpRoot, 'pages'), { recursive: true })

    const res = await runCli(
      ['init', '--yes', '--destinations=slack'],
      tmpRoot,
    )
    expect(res.exitCode).toBe(0)

    // Pages Router handler exists.
    const pagesRoute = join(tmpRoot, 'pages', 'api', 'feedback.ts')
    expect(existsSync(pagesRoute)).toBe(true)

    // App Router handler should NOT have been created.
    expect(existsSync(join(tmpRoot, 'app', 'api', 'feedback', 'route.ts'))).toBe(false)

    const src = readFileSync(pagesRoute, 'utf8')
    expect(src).toContain('export default async function handler')
    expect(src).toContain("import { resolveRoute } from 'snapfeed/routing'")
    expect(src).toContain("import routing from '../../snapfeed.config'")
  })

  it('--help shows both numeric and string forms for --mode', async () => {
    writeFileSync(
      join(tmpRoot, 'package.json'),
      JSON.stringify({ name: 'test', version: '0.0.0' }),
    )

    const res = await runCli(['--help'], tmpRoot)
    expect(res.exitCode).toBe(0)
    // The help output should mention BOTH the numeric form and the string form,
    // because the parser accepts both.
    expect(res.stdout).toMatch(/--mode/)
    expect(res.stdout).toMatch(/string form/i)
  })
})
