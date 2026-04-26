'use client'

/**
 * snapfeed/headless — useFeedbackWidget hook.
 *
 * Extracts the form-state + submit orchestration from FeedbackWidget so
 * consumers can build their own UI on top. Reads `isOpen`, `submit`, and
 * `config` from the surrounding `<FeedbackProvider>` context.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import { useFeedbackContext } from '../FeedbackProvider'
import { captureScreenshot as captureScreenshotImpl } from '../screenshot'
import { lightTheme, darkTheme, type SnapfeedTheme } from '../theme'
import type {
  FeedbackPayload,
  FeedbackCategory,
  FeedbackScreenshot,
} from '../types'
import type { UseFeedbackResult, WidgetState } from './types'

/**
 * Resolve which built-in theme to use given the provider's `theme` config.
 * Mirrors the resolution logic in `src/styles.ts` so the headless API
 * matches the default widget at runtime.
 */
function resolveBuiltInTheme(themeConfig: 'auto' | 'light' | 'dark'): SnapfeedTheme {
  if (themeConfig === 'dark') return darkTheme
  if (themeConfig === 'light') return lightTheme
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? darkTheme
      : lightTheme
  }
  return lightTheme
}

export function useFeedbackWidget(): UseFeedbackResult {
  const { isOpen, open, close, toggle, submit: ctxSubmit, config } =
    useFeedbackContext()

  const [text, setText] = useState('')
  const [category, setCategory] = useState<FeedbackCategory | null>(null)
  const [screenshot, setScreenshot] = useState<FeedbackScreenshot | null>(null)
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'success' | 'error'>(
    'idle'
  )
  const [error, setError] = useState<Error | null>(null)

  // Track in-flight submissions so reset/close can't race a slow adapter.
  const inFlight = useRef(0)

  const reset = useCallback(() => {
    setText('')
    setCategory(null)
    setScreenshot(null)
    setError(null)
    setPhase('idle')
  }, [])

  const captureScreenshot = useCallback(async () => {
    const shot = await captureScreenshotImpl()
    if (shot) setScreenshot(shot)
  }, [])

  const submit = useCallback(
    async (overrides?: Partial<FeedbackPayload>) => {
      // Build the partial payload from current form state, allowing the
      // caller to override or supplement any field.
      const pageUrl =
        typeof window !== 'undefined' ? window.location.href : ''
      const pageName =
        typeof document !== 'undefined' ? document.title : ''

      const partial: Omit<FeedbackPayload, 'timestamp' | 'appName'> = {
        text: text.trim(),
        pageUrl,
        pageName,
        user: config.user,
        screenshot: screenshot ?? undefined,
        category: category ?? undefined,
        ...overrides,
      }

      setPhase('submitting')
      setError(null)
      // Capture the submit id at the start. Phase transitions only fire when
      // OUR id is still the latest — this prevents a slow earlier submit from
      // overwriting the state of a faster later one. Earlier code compared
      // `inFlight.current === 1` AFTER an increment, which incorrectly
      // suppressed `'success'` on every concurrent submit.
      const myId = ++inFlight.current
      try {
        await ctxSubmit(partial)
        if (inFlight.current === myId) {
          setPhase('success')
        }
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err))
        if (inFlight.current === myId) {
          setError(e)
          setPhase('error')
        }
        // Re-throw so callers can also `.catch()` if they want.
        throw e
      }
    },
    [text, category, screenshot, config.user, ctxSubmit]
  )

  // Map internal phase + provider isOpen into the public WidgetState.
  const state: WidgetState = useMemo(() => {
    if (phase === 'submitting') return 'submitting'
    if (phase === 'success') return 'success'
    if (phase === 'error') return 'error'
    return isOpen ? 'open' : 'idle'
  }, [phase, isOpen])

  const theme = useMemo(
    () => resolveBuiltInTheme(config.theme),
    [config.theme]
  )

  return {
    state,
    open,
    close,
    toggle,
    submit,
    error,
    theme,
    form: {
      text,
      setText,
      category,
      setCategory,
      screenshot,
      setScreenshot,
      captureScreenshot,
      reset,
    },
  }
}
