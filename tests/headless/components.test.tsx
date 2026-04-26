// @vitest-environment jsdom
/**
 * Tests for src/headless/components.
 *
 * NOTE: All cases here are currently `it.todo` for the same reasons as
 * useFeedbackWidget.test.tsx — see that file's header for the full list:
 *   1. devDep: jsdom
 *   2. devDep: @testing-library/react
 *   3. vitest.config.ts: include `tests/**\/*.test.tsx`
 *
 * The hook-level coverage in useFeedbackWidget.test.tsx exercises the
 * core state machine; these tests cover render contract + slot swap.
 *
 * v0.5.2 added accessibility + focus-trap behavior to FeedbackModal and
 * FeedbackTextarea; the new it.todo entries below cover those for v0.6.
 */

import { describe, it } from 'vitest'

describe('FeedbackTrigger', () => {
  it.todo(
    'renders a <button> by default and opens the widget on click'
    //   render(
    //     <FeedbackProvider adapters={[consoleAdapter()]}>
    //       <FeedbackTrigger>Open</FeedbackTrigger>
    //     </FeedbackProvider>
    //   )
    //   const btn = screen.getByRole('button', { name: 'Open' })
    //   fireEvent.click(btn)
    //   // Modal should now be in the document — assert via FeedbackModal.
  )

  it.todo(
    'asChild clones the single child and attaches onClick'
    //   const MyButton = ({ onClick, children }) => (
    //     <a href="#" onClick={onClick}>{children}</a>
    //   )
    //   render(
    //     <FeedbackProvider …>
    //       <FeedbackTrigger asChild><MyButton>Open</MyButton></FeedbackTrigger>
    //     </FeedbackProvider>
    //   )
    //   const link = screen.getByText('Open')
    //   expect(link.tagName).toBe('A')
    //   fireEvent.click(link)
    //   // Widget should now be open.
  )
})

describe('FeedbackModal', () => {
  it.todo(
    'renders nothing while widget state is "idle"'
    //   const { container } = render(
    //     <FeedbackProvider …>
    //       <FeedbackModal>hi</FeedbackModal>
    //     </FeedbackProvider>
    //   )
    //   expect(container.firstChild).toBeNull()
  )

  it.todo(
    'renders content once open() is called'
    //   const onClose = vi.fn()
    //   render(
    //     <FeedbackProvider …>
    //       <FeedbackTrigger>Open</FeedbackTrigger>
    //       <FeedbackModal onClose={onClose}>panel</FeedbackModal>
    //     </FeedbackProvider>
    //   )
    //   fireEvent.click(screen.getByText('Open'))
    //   expect(screen.getByText('panel')).toBeInTheDocument()
  )

  it.todo(
    'ESC key calls the onClose prop'
    //   fireEvent.keyDown(document, { key: 'Escape' })
    //   expect(onClose).toHaveBeenCalledTimes(1)
  )

  // ── v0.5.2 accessibility additions ────────────────────────────────────
  // These assert the inline focus-trap / focus-return / ARIA wiring added
  // when we landed the pre-publish hardening pass. None require new deps
  // beyond the (deferred) jsdom + @testing-library/react.

  it.todo(
    'sets role="dialog" and aria-modal="true" on the panel'
    //   open the modal, then:
    //   const panel = screen.getByRole('dialog')
    //   expect(panel.getAttribute('aria-modal')).toBe('true')
  )

  it.todo(
    'wires aria-labelledby to a stable useId() heading id'
    //   const panel = screen.getByRole('dialog')
    //   const labelId = panel.getAttribute('aria-labelledby')
    //   expect(labelId).toBeTruthy()
    //   expect(document.getElementById(labelId!)).not.toBeNull()
  )

  it.todo(
    'traps Tab focus inside the modal — Tab from last focusable wraps to first'
    //   open modal with several focusable children
    //   const focusables = within(panel).getAllByRole('button')
    //   focusables[focusables.length - 1].focus()
    //   fireEvent.keyDown(document, { key: 'Tab' })
    //   expect(document.activeElement).toBe(focusables[0])
  )

  it.todo(
    'Shift+Tab from first focusable wraps to last'
    //   focusables[0].focus()
    //   fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    //   expect(document.activeElement).toBe(focusables[focusables.length - 1])
  )

  it.todo(
    'restores focus to the previously-focused element on close'
    //   const opener = document.createElement('button')
    //   document.body.appendChild(opener)
    //   opener.focus()
    //   <open the modal, then close it via ESC>
    //   await waitFor(() => expect(document.activeElement).toBe(opener))
  )

  it.todo(
    'ignores backdrop click while state === "submitting"'
    //   <kick off a slow submit so state is "submitting">
    //   fireEvent.click(getByTestId('overlay'))
    //   <modal must still be visible — onClose was not called>
  )

  it.todo(
    'ignores ESC while state === "submitting"'
    //   <as above; then>
    //   fireEvent.keyDown(document, { key: 'Escape' })
    //   <modal must still be visible — onClose was not called>
  )
})

describe('FeedbackTextarea', () => {
  it.todo(
    'renders with the given placeholder and tracks form.text via context'
    //   render(<FeedbackProvider …><FeedbackTextarea placeholder="hi" /></FeedbackProvider>)
    //   const ta = screen.getByPlaceholderText('hi') as HTMLTextAreaElement
    //   fireEvent.change(ta, { target: { value: 'typing' } })
    //   expect(ta.value).toBe('typing')
  )

  // ── v0.5.2 accessibility additions ────────────────────────────────────

  it.todo(
    'renders a visually-hidden <label> with default text "Feedback"'
    //   const ta = screen.getByLabelText('Feedback') as HTMLTextAreaElement
    //   expect(ta.tagName).toBe('TEXTAREA')
    //   const label = document.querySelector(`label[for="${ta.id}"]`)!
    //   const cs = getComputedStyle(label)
    //   expect(cs.position).toBe('absolute')
    //   expect(cs.width).toBe('1px')
  )

  it.todo(
    'uses the provided label prop instead of the default'
    //   render(<FeedbackTextarea label="Bug description" />)
    //   expect(screen.getByLabelText('Bug description')).toBeInTheDocument()
  )

  it.todo(
    'omits the <label> entirely when label={null}'
    //   render(<FeedbackTextarea label={null} />)
    //   expect(screen.queryByText('Feedback')).toBeNull()
  )
})

describe('FeedbackComponentsProvider', () => {
  it.todo(
    'swaps in a custom Trigger component when provided'
    //   const MyTrigger = ({ onOpen, children }) => (
    //     <button data-custom onClick={onOpen}>{children}</button>
    //   )
    //   render(
    //     <FeedbackProvider …>
    //       <FeedbackComponentsProvider components={{ Trigger: MyTrigger }}>
    //         <FeedbackTrigger>Open</FeedbackTrigger>
    //       </FeedbackComponentsProvider>
    //     </FeedbackProvider>
    //   )
    //   expect(screen.getByText('Open').dataset.custom).toBe('')
  )
})

describe('FeedbackProvider — context value memoization (v0.5.2)', () => {
  it.todo(
    'does not re-call useFeedbackContext consumers when the provider re-renders with the same props'
    //   const renderSpy = vi.fn()
    //   function Spy() { useFeedbackContext(); renderSpy(); return null }
    //   const { rerender } = render(
    //     <FeedbackProvider appName="x"><Spy /></FeedbackProvider>
    //   )
    //   const baseline = renderSpy.mock.calls.length
    //   rerender(<FeedbackProvider appName="x"><Spy /></FeedbackProvider>)
    //   // With memoization, the context value identity is stable, so the
    //   // memoized Spy doesn't re-render. Without it, every parent render
    //   // forces all consumers through React.memo.
    //   expect(renderSpy.mock.calls.length).toBe(baseline)
  )
})
