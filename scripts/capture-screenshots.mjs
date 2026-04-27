#!/usr/bin/env node
/**
 * snapfeed — README screenshot capture script.
 *
 * Spins up a headless Chromium against the running vite-react example and
 * captures the widget in 4 representative states. Output goes to
 * docs/screenshots/*.png and is committed to the repo so the README can
 * reference them with relative paths (and they render on npmjs.com too).
 *
 * Pre-requisites:
 *   - The vite-react example is already running on http://localhost:5173.
 *     Either start it via `cd examples/vite-react && npm run dev`, or via
 *     the launch.json entry "snapfeed-vite-react" in this repo.
 *
 * Usage:
 *   npx playwright install --with-deps chromium    # one-time
 *   node scripts/capture-screenshots.mjs
 *
 * Why a separate script vs a vitest test: these are documentation
 * artifacts, not assertions. Treating capture as build/test infrastructure
 * would either fail CI on a flaky pixel diff or commit screenshots
 * without review. Manual run + commit is the right cadence.
 */

import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '..', 'docs', 'screenshots')
const URL = process.env.SNAPFEED_PREVIEW_URL ?? 'http://localhost:5173'
const VIEWPORT = { width: 1280, height: 800 }

async function main() {
  await mkdir(OUT_DIR, { recursive: true })

  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2, // retina-quality output for README
  })
  const page = await context.newPage()

  console.log(`Navigating to ${URL} ...`)
  await page.goto(URL, { waitUntil: 'networkidle' })

  // The floating button has `aria-label="Send feedback"` — disambiguates
  // it from any inline trigger that also says "Feedback".
  const FLOATING_BTN_SELECTOR = 'button[aria-label="Send feedback"]'
  await page.waitForSelector(FLOATING_BTN_SELECTOR, { timeout: 10_000 })

  // 1. Landing page with the floating Feedback button (closed/hero shot).
  await page.screenshot({
    path: resolve(OUT_DIR, 'widget-closed.png'),
    fullPage: false,
  })
  console.log('  ✓ widget-closed.png')

  // 2. Modal open with empty form. Click the floating Feedback button.
  await page.click(FLOATING_BTN_SELECTOR)
  // Wait for the dialog modal to appear.
  await page.waitForSelector('[role="dialog"]', { timeout: 5_000 })
  // Brief settle to let the entrance transition complete.
  await page.waitForTimeout(400)
  await page.screenshot({
    path: resolve(OUT_DIR, 'widget-open-empty.png'),
    fullPage: false,
  })
  console.log('  ✓ widget-open-empty.png')

  // 3. Modal with text typed and a category selected.
  // The textarea inside the dialog is the primary input.
  const textarea = page.locator('[role="dialog"] textarea').first()
  await textarea.fill(
    'The checkout button stays disabled even after I fill in all the required fields — happens consistently on the second cart item.'
  )
  // Click the "Bug" category if present (compound widget exposes
  // category buttons; their exact text varies by snapfeed version).
  const bugBtn = page.locator('[role="dialog"] button:has-text("Bug")').first()
  if (await bugBtn.count()) {
    await bugBtn.click()
  }
  await page.waitForTimeout(200)
  await page.screenshot({
    path: resolve(OUT_DIR, 'widget-open-filled.png'),
    fullPage: false,
  })
  console.log('  ✓ widget-open-filled.png')

  // 4. Success state — submit the form and wait until the adapter
  // dispatch completes. The widget swaps the button label from
  // "Send Feedback" → "Sending..." → out of the DOM (replaced by a
  // success surface). Wait for the success surface, not the spinner.
  const submitBtn = page
    .locator('[role="dialog"] button:has-text("Send")')
    .first()
  await submitBtn.click()

  // Wait for either: a success message in the dialog, OR the dialog to
  // close. Different builds of snapfeed show one or the other.
  await page
    .waitForFunction(
      () => {
        const dialog = document.querySelector('[role="dialog"]')
        if (!dialog) return true // dialog dismissed → submission completed
        const text = dialog.textContent ?? ''
        return /thank|sent|success|delivered/i.test(text)
      },
      { timeout: 10_000 }
    )
    .catch(() => {
      // If neither condition is met, fall through and capture whatever
      // state the widget is in — better than crashing the script.
      console.warn('    (success-state wait timed out; capturing current state)')
    })
  await page.waitForTimeout(400)
  await page.screenshot({
    path: resolve(OUT_DIR, 'widget-success.png'),
    fullPage: false,
  })
  console.log('  ✓ widget-success.png')

  await browser.close()
  console.log(`\nAll screenshots saved to ${OUT_DIR}`)
}

main().catch((err) => {
  console.error('Capture failed:', err)
  process.exit(1)
})
