// @vitest-environment jsdom
/**
 * Real tests for src/headless/useFeedbackWidget.
 *
 * Covers the headless hook's state machine end-to-end through React:
 *   - Initial state (idle, empty form)
 *   - setText / setCategory updates
 *   - reset clears everything
 *   - submit happy-path (idle -> submitting -> success)
 *   - submit failure path (idle -> submitting -> error)
 *
 * Activated in v0.6.0 along with the jsdom + @testing-library/react devDeps.
 * The two `.tsx` test files were `it.todo` placeholders from v0.5.x — this
 * is the first real headless coverage.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, render, renderHook } from '@testing-library/react'

// @testing-library/react usually wires cleanup() automatically when used
// with vitest's globals: true, but our config sets globals: false.
afterEach(() => {
  cleanup()
})
import type { ReactNode } from 'react'
import { FeedbackProvider } from '../../src/FeedbackProvider'
import { useFeedbackWidget } from '../../src/headless/useFeedbackWidget'
import type { FeedbackAdapter, FeedbackPayload } from '../../src/types'

/**
 * Build a fake adapter that records every payload it sees and lets the test
 * choose whether to resolve `ok: true` (default) or fail.
 */
function recordingAdapter(
  result: { ok: true } | { ok: false; error: string } = { ok: true }
): FeedbackAdapter & { calls: FeedbackPayload[] } {
  const calls: FeedbackPayload[] = []
  return {
    name: 'recording',
    async send(payload) {
      calls.push(payload)
      return result
    },
    calls,
  } as FeedbackAdapter & { calls: FeedbackPayload[] }
}

function makeWrapper(adapter: FeedbackAdapter) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FeedbackProvider
        appName="TestApp"
        adapters={[adapter]}
        // Disable the floating button so it doesn't pollute test DOM.
        floatingButton={false}
        // Disable persistence so tests don't leak between cases via localStorage.
        persistDraft={false}
        persistIdentity={false}
      >
        {children}
      </FeedbackProvider>
    )
  }
}

describe('useFeedbackWidget — initial state', () => {
  it('starts idle with empty form fields', () => {
    const adapter = recordingAdapter()
    const { result } = renderHook(() => useFeedbackWidget(), {
      wrapper: makeWrapper(adapter),
    })

    expect(result.current.state).toBe('idle')
    expect(result.current.form.text).toBe('')
    expect(result.current.form.category).toBeNull()
    expect(result.current.form.screenshot).toBeNull()
    expect(result.current.error).toBeNull()
  })
})

describe('useFeedbackWidget — form updates', () => {
  it('setText updates text and survives subsequent renders', () => {
    const { result } = renderHook(() => useFeedbackWidget(), {
      wrapper: makeWrapper(recordingAdapter()),
    })

    act(() => {
      result.current.form.setText('checkout button is broken')
    })
    expect(result.current.form.text).toBe('checkout button is broken')
  })

  it('setCategory updates category', () => {
    const { result } = renderHook(() => useFeedbackWidget(), {
      wrapper: makeWrapper(recordingAdapter()),
    })

    act(() => {
      result.current.form.setCategory('bug')
    })
    expect(result.current.form.category).toBe('bug')
  })

  it('reset clears every form field and resets phase to idle', () => {
    const { result } = renderHook(() => useFeedbackWidget(), {
      wrapper: makeWrapper(recordingAdapter()),
    })

    act(() => {
      result.current.form.setText('something')
      result.current.form.setCategory('idea')
    })
    expect(result.current.form.text).toBe('something')
    expect(result.current.form.category).toBe('idea')

    act(() => {
      result.current.form.reset()
    })
    expect(result.current.form.text).toBe('')
    expect(result.current.form.category).toBeNull()
    expect(result.current.state).toBe('idle')
  })
})

describe('useFeedbackWidget — submit happy path', () => {
  it('transitions idle -> submitting -> success and dispatches the payload to the adapter', async () => {
    const adapter = recordingAdapter({ ok: true })
    const { result } = renderHook(() => useFeedbackWidget(), {
      wrapper: makeWrapper(adapter),
    })

    act(() => {
      result.current.form.setText('It loaded but is laggy')
      result.current.form.setCategory('bug')
    })

    await act(async () => {
      await result.current.submit()
    })

    expect(result.current.state).toBe('success')
    expect(adapter.calls).toHaveLength(1)
    expect(adapter.calls[0]!.text).toBe('It loaded but is laggy')
    expect(adapter.calls[0]!.category).toBe('bug')
    expect(adapter.calls[0]!.appName).toBe('TestApp')
    expect(adapter.calls[0]!.timestamp).toBeTruthy()
  })

  it('passes overrides through to the dispatched payload', async () => {
    const adapter = recordingAdapter({ ok: true })
    const { result } = renderHook(() => useFeedbackWidget(), {
      wrapper: makeWrapper(adapter),
    })

    act(() => {
      result.current.form.setText('base text')
    })

    await act(async () => {
      await result.current.submit({ text: 'overridden text', user: { name: 'Mohit' } })
    })

    expect(adapter.calls[0]!.text).toBe('overridden text')
    expect(adapter.calls[0]!.user?.name).toBe('Mohit')
  })
})

describe('useFeedbackWidget — submit error path', () => {
  // Contract: submit() rejects so callers can also `.catch()` it,
  // AND it sets state: 'error' + populates `result.current.error`.
  // We assert both: the await is wrapped in try/catch, then we read state.
  it('transitions idle -> submitting -> error when the adapter returns ok=false', async () => {
    const adapter = recordingAdapter({ ok: false, error: 'webhook 503' })
    const { result } = renderHook(() => useFeedbackWidget(), {
      wrapper: makeWrapper(adapter),
    })

    act(() => {
      result.current.form.setText('payload')
    })

    let caught: unknown = null
    await act(async () => {
      try {
        await result.current.submit()
      } catch (err) {
        caught = err
      }
    })

    expect(caught).toBeInstanceOf(Error)
    expect(result.current.state).toBe('error')
    expect(result.current.error).toBeInstanceOf(Error)
    // Provider's "All adapters failed" wraps the per-adapter error message.
    expect(result.current.error!.message).toMatch(/all adapters failed|webhook 503/i)
  })

  it('still records the call to the adapter even when the adapter rejects', async () => {
    let calls = 0
    const throwingAdapter: FeedbackAdapter = {
      name: 'throws',
      async send() {
        calls += 1
        throw new Error('connection reset')
      },
    }

    const { result } = renderHook(() => useFeedbackWidget(), {
      wrapper: makeWrapper(throwingAdapter),
    })

    act(() => {
      result.current.form.setText('crash test')
    })

    let caught: unknown = null
    await act(async () => {
      try {
        await result.current.submit()
      } catch (err) {
        caught = err
      }
    })

    expect(calls).toBe(1)
    expect(caught).toBeInstanceOf(Error)
    expect(result.current.state).toBe('error')
    expect(result.current.error).toBeInstanceOf(Error)
  })
})

describe('useFeedbackWidget — context guard', () => {
  it('throws a clear error when used outside a FeedbackProvider', () => {
    // Suppress React's expected-error console output for this case.
    const originalError = console.error
    console.error = vi.fn()
    try {
      expect(() =>
        renderHook(() => useFeedbackWidget())
      ).toThrowError(/FeedbackProvider/)
    } finally {
      console.error = originalError
    }
  })
})

describe('FeedbackProvider — context resolution under SSR-style render', () => {
  // This is the regression test for the v0.5.3 Next.js prerender failure.
  // If this passes, child components can call useFeedbackContext on the
  // initial server render without throwing.
  it('renders a child that uses useFeedbackWidget without throwing', () => {
    const adapter = recordingAdapter()

    function Child() {
      // Forces a useFeedbackContext call on initial render.
      const { state } = useFeedbackWidget()
      return <div data-testid="state">{state}</div>
    }

    expect(() =>
      render(
        <FeedbackProvider appName="TestApp" adapters={[adapter]} floatingButton={false}>
          <Child />
        </FeedbackProvider>
      )
    ).not.toThrow()
  })
})

// ─── v0.7: production-readiness mount warning ──────────────────────────────

describe('FeedbackProvider — production-readiness warning (v0.7)', () => {
  // Background: in production with `enableInProduction: false` (the default),
  // the widget renders nothing. Today: silent. Result: indie devs deploy and
  // think the widget is broken when it just opted out for safety.
  // v0.7: log a one-time console.warn at mount with the explanation + fix.

  let savedNodeEnv: string | undefined
  let savedLocation: Location

  beforeEach(() => {
    savedNodeEnv = process.env.NODE_ENV
    savedLocation = window.location
  })

  afterEach(() => {
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = savedNodeEnv
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: savedLocation,
    })
  })

  // jsdom's window.location.hostname is read-only, so we replace the
  // entire `location` object. The provider's prod warning intentionally
  // suppresses on localhost (so `NODE_ENV=production npm run dev` doesn't
  // spam) — tests that simulate a real production host must flip this.
  function setHostname(h: string): void {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { ...savedLocation, hostname: h, host: h, href: `https://${h}/` },
    })
  }

  it('warns once on mount when NODE_ENV=production AND enableInProduction !== true', () => {
    process.env.NODE_ENV = 'production'
    setHostname('app.example.com')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    render(
      <FeedbackProvider
        appName="ProdApp"
        adapters={[recordingAdapter()]}
        floatingButton={false}
        // enableInProduction omitted → defaults to false
      >
        <div>app</div>
      </FeedbackProvider>
    )

    const messages = warn.mock.calls.map((c) => String(c[0]))
    expect(
      messages.some(
        (m) => /enableInProduction/.test(m) && /production/i.test(m)
      )
    ).toBe(true)
  })

  it('does NOT warn when NODE_ENV=production AND enableInProduction is true', () => {
    process.env.NODE_ENV = 'production'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    render(
      <FeedbackProvider
        appName="ProdApp"
        adapters={[recordingAdapter()]}
        floatingButton={false}
        enableInProduction
      >
        <div>app</div>
      </FeedbackProvider>
    )

    const messages = warn.mock.calls.map((c) => String(c[0]))
    expect(messages.some((m) => /enableInProduction/.test(m))).toBe(false)
  })

  it('does NOT warn in development', () => {
    process.env.NODE_ENV = 'development'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    render(
      <FeedbackProvider
        appName="DevApp"
        adapters={[recordingAdapter()]}
        floatingButton={false}
      >
        <div>app</div>
      </FeedbackProvider>
    )

    const messages = warn.mock.calls.map((c) => String(c[0]))
    expect(messages.some((m) => /enableInProduction/.test(m))).toBe(false)
  })

  it('warns at most once per provider mount even when re-rendered', () => {
    // React 18 strict mode runs effects mount-unmount-mount in dev. The warn
    // ref guard must allow exactly one warning per provider lifetime.
    process.env.NODE_ENV = 'production'
    setHostname('app.example.com')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { rerender } = render(
      <FeedbackProvider
        appName="ProdApp"
        adapters={[recordingAdapter()]}
        floatingButton={false}
      >
        <div>app</div>
      </FeedbackProvider>
    )
    rerender(
      <FeedbackProvider
        appName="ProdApp"
        adapters={[recordingAdapter()]}
        floatingButton={false}
      >
        <div>app v2</div>
      </FeedbackProvider>
    )

    const matches = warn.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => /enableInProduction/.test(m))
    expect(matches.length).toBeLessThanOrEqual(1)
  })
})
