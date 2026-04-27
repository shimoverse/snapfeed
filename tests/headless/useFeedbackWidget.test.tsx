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

import { describe, it, expect, vi, afterEach } from 'vitest'
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
