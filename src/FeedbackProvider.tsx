'use client'

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react'
import type {
  FeedbackContextValue,
  FeedbackPayload,
  FeedbackProviderConfig,
  FeedbackMetadata,
} from './types'
import { FeedbackWidget } from './FeedbackWidget'
import { summarizeAdapterResults } from './lib/adapter-results'

// ─── Context ──────────────────────────────────────────────────────────────────

const FeedbackContext = createContext<FeedbackContextValue | null>(null)

export function useFeedbackContext(): FeedbackContextValue {
  const ctx = useContext(FeedbackContext)
  if (!ctx) {
    throw new Error('[devtools/feedback] useFeedbackContext must be used inside <FeedbackProvider>')
  }
  return ctx
}

// ─── Console error interceptor ────────────────────────────────────────────────

const MAX_CONSOLE_ERRORS = 20
const consoleErrors: string[] = []

function patchConsoleError(): () => void {
  if (typeof window === 'undefined') return () => undefined

  const original = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    const msg = args.map(a => (typeof a === 'string' ? a : String(a))).join(' ')
    if (consoleErrors.length >= MAX_CONSOLE_ERRORS) consoleErrors.shift()
    consoleErrors.push(msg)
    original(...args)
  }

  return () => {
    console.error = original
  }
}

// ─── Hotkey parser ────────────────────────────────────────────────────────────

interface ParsedHotkey {
  ctrl: boolean
  meta: boolean
  shift: boolean
  alt: boolean
  key: string
}

function parseHotkey(hotkey: string): ParsedHotkey {
  const parts = hotkey.toLowerCase().split('+')
  return {
    ctrl: parts.includes('ctrl'),
    meta: parts.includes('meta') || parts.includes('cmd') || parts.includes('command'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt') || parts.includes('option'),
    key: parts[parts.length - 1] ?? '',
  }
}

function matchesHotkey(e: KeyboardEvent, parsed: ParsedHotkey): boolean {
  return (
    e.ctrlKey === parsed.ctrl &&
    e.metaKey === parsed.meta &&
    e.shiftKey === parsed.shift &&
    e.altKey === parsed.alt &&
    e.key.toLowerCase() === parsed.key
  )
}

// ─── Provider ─────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  appName: 'App',
  hotkey: 'ctrl+shift+f',
  position: 'bottom-right' as const,
  theme: 'auto' as const,
  accentColor: '#D4714B',
  collectMetadata: true,
  autoScreenshot: false,
  enableInProduction: false,
  apiUrl: '/api/feedback',
}

export function FeedbackProvider({
  children,
  ...config
}: FeedbackProviderConfig & { children: ReactNode }) {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config }
  const [isOpen, setIsOpen] = useState(false)
  const patchedRef = useRef(false)

  // Safety: disabled in production unless explicitly enabled
  const isEnabled =
    mergedConfig.enableInProduction ||
    (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') ||
    (typeof window !== 'undefined' && window.location.hostname === 'localhost')

  // Intercept console errors for metadata
  useEffect(() => {
    if (!isEnabled) return
    if (patchedRef.current) return
    patchedRef.current = true
    const restore = patchConsoleError()
    return restore
  }, [isEnabled])

  // Hotkey listener
  useEffect(() => {
    if (!isEnabled) return
    const parsed = parseHotkey(mergedConfig.hotkey)

    function onKeyDown(e: KeyboardEvent) {
      if (matchesHotkey(e, parsed)) {
        e.preventDefault()
        setIsOpen(prev => !prev)
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isEnabled, mergedConfig.hotkey])

  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])
  const toggle = useCallback(() => setIsOpen(prev => !prev), [])

  const collectMetadataFn = useCallback((): FeedbackMetadata | undefined => {
    if (!mergedConfig.collectMetadata || typeof window === 'undefined') return undefined
    return {
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      userAgent: navigator.userAgent,
      consoleErrors: [...consoleErrors],
    }
  }, [mergedConfig.collectMetadata])

  const submit = useCallback(
    async (partial: Omit<FeedbackPayload, 'timestamp' | 'appName'>) => {
      const payload: FeedbackPayload = {
        ...partial,
        appName: mergedConfig.appName,
        timestamp: new Date().toISOString(),
        metadata: partial.metadata ?? collectMetadataFn(),
        user: partial.user ?? mergedConfig.user,
      }

      // If adapters are configured directly, call them
      if (mergedConfig.adapters && mergedConfig.adapters.length > 0) {
        const adapters = mergedConfig.adapters
        const results = await Promise.allSettled(
          adapters.map(adapter => adapter.send(payload))
        )
        const summary = summarizeAdapterResults(results)

        if (summary.someFailed && !summary.allFailed) {
          // Partial failure — surface so the caller knows even though
          // the submission counts as delivered.
          const detail = summary.failures
            .map(f => `${adapters[f.index]?.name ?? '?'}: ${f.error}`)
            .join('; ')
          console.warn(`[snapfeed] Some adapters failed: ${detail}`)
        }

        if (summary.allFailed) {
          throw new Error('All adapters failed to deliver feedback')
        }
        return
      }

      // Otherwise, POST to the API URL (server-side adapters)
      const res = await fetch(mergedConfig.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }
    },
    [mergedConfig, collectMetadataFn]
  )

  if (!isEnabled) {
    return <>{children}</>
  }

  const contextValue: FeedbackContextValue = {
    isOpen,
    open,
    close,
    toggle,
    submit,
    config: mergedConfig,
  }

  return (
    <FeedbackContext.Provider value={contextValue}>
      {children}
      <FeedbackWidget />
    </FeedbackContext.Provider>
  )
}
