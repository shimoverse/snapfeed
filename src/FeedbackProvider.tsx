'use client'

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import type {
  FeedbackContextValue,
  FeedbackDeliveryRecord,
  FeedbackPayload,
  FeedbackProviderConfig,
  FeedbackMetadata,
  FeedbackUser,
} from './types'
import { FeedbackWidget } from './FeedbackWidget'
import { FeedbackButton } from './FeedbackButton'
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

/** @internal */
export interface ParsedHotkey {
  ctrl: boolean
  meta: boolean
  shift: boolean
  alt: boolean
  key: string
}

/** @internal — exported for unit tests; not part of the public API. */
export function parseHotkey(hotkey: string): ParsedHotkey {
  const parts = hotkey.toLowerCase().split('+')
  return {
    ctrl: parts.includes('ctrl'),
    meta: parts.includes('meta') || parts.includes('cmd') || parts.includes('command'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt') || parts.includes('option'),
    key: parts[parts.length - 1] ?? '',
  }
}

/**
 * Detect whether the current runtime is macOS, where Cmd (metaKey) is the
 * conventional primary modifier instead of Ctrl. We check both
 * `navigator.platform` (deprecated but still set on Safari/Chrome) and the
 * UA string as a fallback. Server-side rendering returns `false`.
 *
 * @internal
 */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const platform = navigator.platform ?? ''
  if (platform.includes('Mac')) return true
  const ua = navigator.userAgent ?? ''
  return ua.includes('Mac OS') || ua.includes('Macintosh')
}

/**
 * Match a keydown event against a parsed hotkey spec.
 *
 * Mac convention: when the configured hotkey says `ctrl` and the user is on
 * macOS, ALSO accept `meta` (Cmd) as the primary modifier. This means a
 * single `ctrl+shift+f` config works as Cmd+Shift+F on a Mac without
 * requiring per-platform setup. The mirror does NOT apply the other way:
 * a hotkey explicitly written as `meta+/` won't be matched by Ctrl+/ on
 * Linux/Windows.
 *
 * @param isMac override the platform check (used by tests). Falls back to
 *              `isMacPlatform()` when omitted.
 * @internal — exported for unit tests; not part of the public API.
 */
export function matchesHotkey(
  e: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'key'>,
  parsed: ParsedHotkey,
  isMac: boolean = isMacPlatform()
): boolean {
  // On Mac, allow Cmd to substitute for Ctrl when the config says ctrl-only.
  // We require exactly one of {ctrl, meta} to be down so the user still has
  // to press a primary modifier — accidental shift+f doesn't fire.
  const ctrlMatches =
    isMac && parsed.ctrl && !parsed.meta
      ? e.ctrlKey || e.metaKey
      : e.ctrlKey === parsed.ctrl
  const metaMatches =
    isMac && parsed.ctrl && !parsed.meta
      ? true // already checked via ctrlMatches
      : e.metaKey === parsed.meta

  return (
    ctrlMatches &&
    metaMatches &&
    e.shiftKey === parsed.shift &&
    e.altKey === parsed.alt &&
    e.key.toLowerCase() === parsed.key
  )
}

/**
 * Decide whether the keydown listener should ignore the event because the
 * user is typing in an editable element.
 *
 * v0.5.2 behavior change: ALWAYS skip when the target is INPUT/TEXTAREA/
 * SELECT/contenteditable, regardless of whether the hotkey includes shift.
 * Tradeoff: testers must focus the page (not an input) to open the widget,
 * but their typing is never stolen mid-sentence — which the prior
 * "shift bypasses skip" rule allowed.
 *
 * Exported so unit tests can verify the skip-while-typing behavior without
 * spinning up React + jsdom.
 *
 * @internal
 */
export function shouldSkipHotkeyForTarget(
  target: EventTarget | null,
  _parsed: ParsedHotkey
): boolean {
  void _parsed // kept in signature for back-compat with callers
  const el = target as { tagName?: string; isContentEditable?: boolean } | null
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.isContentEditable === true) return true
  return false
}

// ─── Provider ─────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  appName: 'App',
  hotkey: 'ctrl+shift+f',
  position: 'bottom-right' as const,
  theme: 'auto' as const,
  // WCAG AA: ~4.7:1 against white. Was #D4714B (~3.1:1, AA fail). Bump to
  // a deeper terra-cotta so the gradient buttons + focus rings clear AA
  // on the default light theme.
  accentColor: '#B85A36',
  collectMetadata: true,
  autoScreenshot: false,
  enableInProduction: false,
  apiUrl: '/api/feedback',
  floatingButton: true as boolean | string,
  persistDraft: true,
  persistIdentity: true,
}

// localStorage keys for the persisted-identity feature. Kept private to
// the provider so we have a single source of truth.
const LS_KEY_NAME = 'snapfeed_user_name'
const LS_KEY_EMAIL = 'snapfeed_user_email'

/** @internal — exported so the widget's "set name" form can write it. */
export function readPersistedIdentity(): FeedbackUser | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const name = window.localStorage.getItem(LS_KEY_NAME) ?? undefined
    const email = window.localStorage.getItem(LS_KEY_EMAIL) ?? undefined
    if (!name && !email) return undefined
    return { name, email }
  } catch {
    // localStorage may throw in privacy modes — silently no-op.
    return undefined
  }
}

/** @internal */
export function writePersistedIdentity(user: FeedbackUser | undefined): void {
  if (typeof window === 'undefined') return
  try {
    if (user?.name) window.localStorage.setItem(LS_KEY_NAME, user.name)
    else window.localStorage.removeItem(LS_KEY_NAME)
    if (user?.email) window.localStorage.setItem(LS_KEY_EMAIL, user.email)
    else window.localStorage.removeItem(LS_KEY_EMAIL)
  } catch {
    /* swallow */
  }
}

export function FeedbackProvider({
  children,
  ...config
}: FeedbackProviderConfig & { children: ReactNode }) {
  // Persisted identity (localStorage) — only read once on mount. The provider
  // prop ALWAYS wins over the persisted value; persistence only fills in
  // when the host app didn't pass `user`.
  const [persistedUser, setPersistedUser] = useState<FeedbackUser | undefined>(
    () =>
      (config.persistIdentity ?? DEFAULT_CONFIG.persistIdentity)
        ? readPersistedIdentity()
        : undefined
  )

  // Memoize the merged config so its identity only changes when an actual
  // user-supplied prop changes. Without this, every provider render produces
  // a new `mergedConfig` object, which cascades into a new `contextValue`
  // and re-renders every consumer of useFeedbackContext().
  const mergedConfig = useMemo(
    () => {
      const base = { ...DEFAULT_CONFIG, ...config }
      // Prop wins; otherwise fall back to persisted identity (if enabled).
      if (!config.user && base.persistIdentity && persistedUser) {
        base.user = persistedUser
      }
      return base
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      config.appName,
      config.hotkey,
      config.position,
      config.theme,
      config.accentColor,
      config.collectMetadata,
      config.autoScreenshot,
      config.enableInProduction,
      config.apiUrl,
      config.adapters,
      config.user,
      config.onSuccess,
      config.onError,
      config.floatingButton,
      config.persistDraft,
      config.persistIdentity,
      config.messages,
      config.metadata,
      persistedUser,
    ]
  )
  const [isOpen, setIsOpen] = useState(false)
  const [lastResults, setLastResults] = useState<FeedbackDeliveryRecord[]>([])

  /**
   * Update the persisted identity (used by the widget's inline "set name"
   * form). The provider prop still wins on the next merge, but if the host
   * doesn't pass `user`, this becomes the active identity.
   */
  const setIdentity = useCallback(
    (user: FeedbackUser | undefined) => {
      writePersistedIdentity(user)
      setPersistedUser(user)
    },
    []
  )

  // Safety: disabled in production unless explicitly enabled
  const isEnabled =
    mergedConfig.enableInProduction ||
    (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') ||
    (typeof window !== 'undefined' && window.location.hostname === 'localhost')

  // Intercept console errors for metadata.
  //
  // StrictMode safety: under React 18 StrictMode, effects run mount-unmount-
  // mount in development. The earlier `patchedRef` guard skipped the install
  // on the SECOND mount (after StrictMode had already restored), leaving
  // `consoleErrors` empty for the rest of the session. Letting the cleanup
  // restore on every effect teardown means: install -> restore -> install,
  // which lands in the correct steady state and survives StrictMode.
  useEffect(() => {
    if (!isEnabled) return
    return patchConsoleError()
  }, [isEnabled])

  // Hotkey listener
  useEffect(() => {
    if (!isEnabled) return
    const parsed = parseHotkey(mergedConfig.hotkey)

    function onKeyDown(e: KeyboardEvent) {
      // Skip when the user is typing in an editable element AND the hotkey
      // doesn't include `shift` — a "normal" combo like meta+/ would
      // otherwise hijack a command-palette or in-input shortcut. The
      // default ctrl+shift+f includes shift so it always fires.
      if (shouldSkipHotkeyForTarget(e.target, parsed)) return
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
      const baseMetadata = partial.metadata ?? collectMetadataFn()
      // Plumb provider-level `metadata` (build SHA, env, gitSha, …) through
      // payload.metadata.custom. Host-supplied custom keys win on collision.
      const mergedMetadata: FeedbackMetadata | undefined =
        baseMetadata
          ? {
              ...baseMetadata,
              custom:
                mergedConfig.metadata || baseMetadata.custom
                  ? { ...(mergedConfig.metadata ?? {}), ...(baseMetadata.custom ?? {}) }
                  : undefined,
            }
          : mergedConfig.metadata
            ? {
                viewport: '',
                userAgent: '',
                consoleErrors: [],
                custom: { ...mergedConfig.metadata },
              }
            : undefined

      const payload: FeedbackPayload = {
        ...partial,
        appName: mergedConfig.appName,
        timestamp: new Date().toISOString(),
        metadata: mergedMetadata,
        user: partial.user ?? mergedConfig.user,
      }

      // Reset before dispatch so a stale prior-success doesn't bleed over
      // into the new submit's UI surface if the network call throws.
      setLastResults([])

      // If adapters are configured directly, call them
      if (mergedConfig.adapters && mergedConfig.adapters.length > 0) {
        const adapters = mergedConfig.adapters
        const settled = await Promise.allSettled(
          adapters.map(adapter => adapter.send(payload))
        )
        const summary = summarizeAdapterResults(settled)

        // Build per-adapter delivery records for the widget to render.
        const records: FeedbackDeliveryRecord[] = settled.map((r, i) => {
          const name = adapters[i]?.name ?? `adapter-${i}`
          if (r.status === 'rejected') {
            const reason = r.reason
            const error =
              reason instanceof Error
                ? reason.message
                : typeof reason === 'string'
                  ? reason
                  : String(reason)
            return { name, ok: false, error }
          }
          return {
            name,
            ok: r.value.ok,
            deliveryId: r.value.deliveryId,
            error: r.value.error,
            warnings: r.value.warnings,
          }
        })
        setLastResults(records)

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

  // Memoize the context value so consumers don't see a new reference on
  // every provider render. Without this, any state change in any consumer
  // produces a new value, which re-renders every other consumer.
  // The widget reads `setIdentity` off the context via a back-channel cast
  // so we don't have to leak it into the public type until v0.6.
  const contextValue = useMemo<FeedbackContextValue & {
    /** @internal — used by the widget's "set name" inline form. */
    __setIdentity: (user: FeedbackUser | undefined) => void
  }>(
    () => ({
      isOpen,
      open,
      close,
      toggle,
      submit,
      lastResults,
      config: mergedConfig,
      __setIdentity: setIdentity,
    }),
    [isOpen, open, close, toggle, submit, lastResults, mergedConfig, setIdentity]
  )

  if (!isEnabled) {
    return <>{children}</>
  }

  // Discovery surface: a small floating trigger so testers who don't know
  // the hotkey can find the widget. `floatingButton: false` opts out;
  // a string is treated as a CSS selector to portal the trigger into.
  const fb = mergedConfig.floatingButton
  const showButton = fb !== false
  const portalSelector = typeof fb === 'string' ? fb : null

  return (
    <FeedbackContext.Provider value={contextValue}>
      {children}
      <FeedbackWidget />
      {showButton && portalSelector === null && <FeedbackButton />}
      {showButton && portalSelector !== null && (
        <PortalIfMounted selector={portalSelector}>
          <FeedbackButton inline />
        </PortalIfMounted>
      )}
    </FeedbackContext.Provider>
  )
}

/**
 * Render `children` into the DOM node matching `selector` via React portal.
 * Renders nothing on the server (no `document`) and nothing if the selector
 * doesn't match — the widget itself stays available via hotkey, so a
 * missing slot fails open rather than crashing.
 */
function PortalIfMounted({
  selector,
  children,
}: {
  selector: string
  children: ReactNode
}) {
  const [target, setTarget] = useState<Element | null>(null)

  useEffect(() => {
    if (typeof document === 'undefined') return
    setTarget(document.querySelector(selector))
  }, [selector])

  if (!target) return null
  return createPortal(children, target)
}
