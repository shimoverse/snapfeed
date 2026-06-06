// @vitest-environment jsdom
import React from 'react'
import { describe, expect, it, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FeedbackProvider } from '../src/FeedbackProvider'
import type { FeedbackAdapter, FeedbackPayload } from '../src/types'

afterEach(() => {
  cleanup()
})

function recordingAdapter(): FeedbackAdapter & { calls: FeedbackPayload[] } {
  const calls: FeedbackPayload[] = []
  return {
    name: 'recording',
    async send(payload) {
      calls.push(payload)
      return { ok: true }
    },
    calls,
  } as FeedbackAdapter & { calls: FeedbackPayload[] }
}

describe('FeedbackProvider element context capture', () => {
  it('adds the last host-app element to submitted feedback and ignores snapfeed UI interactions', async () => {
    const adapter = recordingAdapter()

    render(
      <FeedbackProvider
        appName="Checkout"
        adapters={[adapter]}
        persistDraft={false}
        persistIdentity={false}
      >
        <button
          type="button"
          data-testid="checkout-pay"
          data-component="CheckoutPayButton"
          aria-label="Pay checkout"
        >
          Pay now
        </button>
      </FeedbackProvider>
    )

    fireEvent.pointerDown(screen.getByTestId('checkout-pay'))
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }))

    fireEvent.change(screen.getByLabelText('Feedback'), {
      target: { value: 'Button copy feels risky' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send Feedback' }))

    await waitFor(() => expect(adapter.calls).toHaveLength(1))
    expect(adapter.calls[0]!.target).toMatchObject({
      tagName: 'button',
      selector: '[data-testid="checkout-pay"]',
      ariaLabel: 'Pay checkout',
      text: 'Pay now',
      componentName: 'CheckoutPayButton',
    })
  })

  it('allows callers to disable automatic element context capture', async () => {
    const adapter = recordingAdapter()

    render(
      <FeedbackProvider
        appName="Checkout"
        adapters={[adapter]}
        floatingButton={false}
        persistDraft={false}
        persistIdentity={false}
        collectElementContext={false}
      >
        <button type="button" data-testid="host">Host button</button>
        <button type="button" onClick={() => undefined}>open shim</button>
      </FeedbackProvider>
    )

    fireEvent.pointerDown(screen.getByTestId('host'))
    fireEvent.keyDown(document, { key: 'f', ctrlKey: true, shiftKey: true })
    fireEvent.change(screen.getByLabelText('Feedback'), {
      target: { value: 'No target please' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send Feedback' }))

    await waitFor(() => expect(adapter.calls).toHaveLength(1))
    expect(adapter.calls[0]!.target).toBeUndefined()
  })
})
