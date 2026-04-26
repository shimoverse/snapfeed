// @vitest-environment jsdom
/**
 * Tests for src/headless/useFeedbackWidget.
 *
 * NOTE: All cases here are currently `it.todo`. Two infrastructure pieces
 * need to land before they can run:
 *   1. `jsdom` (devDep) — for the jsdom environment annotation above.
 *   2. `@testing-library/react` (devDep) — for `render` / `act` / hook
 *      utilities. The spec disallows adding it to runtime deps; it would
 *      go in devDependencies only.
 *   3. vitest.config.ts must include `tests/**\/*.test.tsx` in `include`
 *      (currently only `.test.ts`).
 *
 * Once those are in place, replace the `it.todo` calls with the
 * implementation sketches below. The intended assertions are documented
 * verbatim so a follow-up PR is mechanical.
 */

import { describe, it } from 'vitest'

describe('useFeedbackWidget', () => {
  it.todo(
    'initial state: state === "idle", form text is empty, category is null'
    // Implementation sketch (needs @testing-library/react + jsdom):
    //   const wrapper = ({ children }) => (
    //     <FeedbackProvider adapters={[consoleAdapter()]}>{children}</FeedbackProvider>
    //   )
    //   const { result } = renderHook(() => useFeedbackWidget(), { wrapper })
    //   expect(result.current.state).toBe('idle')
    //   expect(result.current.form.text).toBe('')
    //   expect(result.current.form.category).toBeNull()
  )

  it.todo(
    'open() transitions widget state to "open"'
    //   act(() => result.current.open())
    //   expect(result.current.state).toBe('open')
  )

  it.todo(
    'form.setText("foo") updates form.text to "foo"'
    //   act(() => result.current.form.setText('foo'))
    //   expect(result.current.form.text).toBe('foo')
  )

  it.todo(
    'form.setCategory("bug") updates form.category to "bug"'
    //   act(() => result.current.form.setCategory('bug'))
    //   expect(result.current.form.category).toBe('bug')
  )

  it.todo(
    'submit() with a working adapter transitions submitting -> success'
    //   act(() => { result.current.form.setText('great'); result.current.open() })
    //   await act(async () => { await result.current.submit() })
    //   expect(result.current.state).toBe('success')
    //   expect(result.current.error).toBeNull()
  )

  it.todo(
    'submit() with all adapters failing transitions to "error" and populates error'
    //   const failing = { name: 'fail', send: async () => { throw new Error('boom') } }
    //   render with FeedbackProvider adapters={[failing]}
    //   await expect(act(async () => { await result.current.submit() })).rejects.toThrow()
    //   expect(result.current.state).toBe('error')
    //   expect(result.current.error?.message).toMatch(/all adapters failed/i)
  )

  it.todo(
    'form.reset() clears text, category, screenshot, and error'
    //   act(() => result.current.form.reset())
    //   expect(result.current.form.text).toBe('')
    //   expect(result.current.form.category).toBeNull()
    //   expect(result.current.form.screenshot).toBeNull()
    //   expect(result.current.error).toBeNull()
  )

  // ── v0.5.2 hardening additions ────────────────────────────────────────

  it.todo(
    'FeedbackWidget: success-close timer is cleared when the widget is closed and reopened quickly'
    //   open the widget, submit, get into the 2s success-close window
    //   close the widget within that window, then reopen
    //   wait > 2s
    //   the widget must remain open — the stale handleClose from the
    //   previous cycle must NOT have fired (it would clobber the reopen).
  )

  it.todo(
    'FeedbackWidget: success-close timer is cleared on unmount'
    //   open + submit, then unmount the FeedbackProvider before the 2s
    //   timer fires. No "setState on unmounted component" warning, no
    //   leaked timer. (Verifiable by spying on clearTimeout.)
  )
})
