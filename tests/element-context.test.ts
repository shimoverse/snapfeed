// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  buildElementContext,
  shouldIgnoreElementForSnapfeedContext,
} from '../src/element-context'

describe('buildElementContext', () => {
  it('captures selector, dom path, accessible labels, text, and bounds for an element', () => {
    document.body.innerHTML = `
      <main id="app">
        <section class="checkout-panel">
          <button
            class="primary cta"
            data-testid="pay-now"
            aria-label="Pay now"
            data-component="CheckoutButton"
          >
            Pay now with card
          </button>
        </section>
      </main>
    `
    const button = document.querySelector('button') as HTMLButtonElement
    button.getBoundingClientRect = () =>
      ({ x: 10, y: 20, width: 120, height: 40, top: 20, right: 130, bottom: 60, left: 10, toJSON: () => ({}) }) as DOMRect

    const context = buildElementContext(button)

    expect(context).toMatchObject({
      tagName: 'button',
      id: undefined,
      classes: ['primary', 'cta'],
      role: 'button',
      ariaLabel: 'Pay now',
      text: 'Pay now with card',
      selector: '[data-testid="pay-now"]',
      componentName: 'CheckoutButton',
      boundingRect: { x: 10, y: 20, width: 120, height: 40 },
    })
    expect(context.domPath).toContain('main#app')
    expect(context.domPath).toContain('button.primary.cta')
  })

  it('truncates noisy text content so feedback payloads stay small', () => {
    document.body.innerHTML = `<div>${'x'.repeat(300)}</div>`
    const context = buildElementContext(document.querySelector('div')!)

    expect(context.text).toHaveLength(120)
    expect(context.text?.endsWith('…')).toBe(true)
  })
})

describe('shouldIgnoreElementForSnapfeedContext', () => {
  it('ignores snapfeed-owned DOM so opening/submitting the widget does not replace the app target', () => {
    document.body.innerHTML = `
      <button id="host">Host app button</button>
      <div data-snapfeed-ui="true"><textarea></textarea></div>
    `

    expect(
      shouldIgnoreElementForSnapfeedContext(document.querySelector('textarea')!)
    ).toBe(true)
    expect(
      shouldIgnoreElementForSnapfeedContext(document.querySelector('#host')!)
    ).toBe(false)
  })
})
