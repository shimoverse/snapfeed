// @vitest-environment jsdom
/**
 * Tests for src/headless/components — compound widget components.
 *
 * v0.6.0: jsdom + @testing-library/react devDeps now installed, so this
 * file converts the highest-value `it.todo` placeholders for FeedbackTrigger
 * into real coverage. Modal-focus-trap and slot-swap tests remain as
 * placeholders — they need additional fixture setup; tracked for v0.7.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FeedbackProvider } from '../../src/FeedbackProvider'
import { FeedbackTrigger } from '../../src/headless/components'
import { consoleAdapter } from '../../src/adapters/console'

// @testing-library/react usually wires cleanup() automatically when used
// with vitest's globals: true, but our config sets globals: false. Wire it
// manually so DOM state doesn't bleed between cases.
afterEach(() => {
  cleanup()
})

function renderWithProvider(ui: React.ReactElement) {
  return render(
    <FeedbackProvider
      appName="TestApp"
      adapters={[consoleAdapter()]}
      floatingButton={false}
      persistDraft={false}
      persistIdentity={false}
    >
      {ui}
    </FeedbackProvider>
  )
}

describe('FeedbackTrigger', () => {
  it('renders a real <button> by default with the children as label', () => {
    renderWithProvider(<FeedbackTrigger>Open feedback</FeedbackTrigger>)
    const btn = screen.getByRole('button', { name: 'Open feedback' })
    expect(btn).toBeDefined()
    expect(btn.tagName).toBe('BUTTON')
    expect(btn.getAttribute('type')).toBe('button')
  })

  it('asChild clones the single child element and wires onClick through', () => {
    const childClick = vi.fn()

    function MyLink({
      onClick,
      children,
    }: {
      onClick?: (e: React.MouseEvent) => void
      children: React.ReactNode
    }) {
      return (
        <a href="#" onClick={onClick} data-testid="custom-trigger">
          {children}
        </a>
      )
    }

    renderWithProvider(
      <FeedbackTrigger asChild>
        <MyLink onClick={childClick}>Open</MyLink>
      </FeedbackTrigger>
    )

    const link = screen.getByTestId('custom-trigger')
    expect(link.tagName).toBe('A')

    // Confirm the cloned element fires the original onClick.
    fireEvent.click(link)
    expect(childClick).toHaveBeenCalledTimes(1)
  })

  it('default <button> click opens the widget (modal dialog appears)', () => {
    // The widget renders nothing while closed (FeedbackWidget early-returns
    // `null` when !isOpen). Once open, the modal mounts as `role="dialog"`.
    renderWithProvider(<FeedbackTrigger>Open</FeedbackTrigger>)

    // Pre-condition: no dialog mounted.
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Open' }))

    // Post-condition: dialog mounted (the widget panel).
    expect(screen.queryByRole('dialog')).not.toBeNull()
  })
})

describe('FeedbackModal — placeholders', () => {
  it.todo('renders nothing while widget state is "idle"')
  it.todo('renders content once open() is called')
  it.todo('ESC key calls the onClose prop')
  it.todo('sets role="dialog" and aria-modal="true" on the panel')
  it.todo('wires aria-labelledby to a stable useId() heading id')
  it.todo('traps Tab focus inside the modal — Tab from last focusable wraps to first')
  it.todo('Shift+Tab from first focusable wraps to last')
  it.todo('returns focus to the previously-focused element on close')
})

describe('FeedbackComponentsProvider — placeholders', () => {
  it.todo('Trigger slot replaces the default <button>')
  it.todo('Modal slot replaces the default panel')
  it.todo('SubmitButton slot replaces the default submit')
})
