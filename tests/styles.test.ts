/**
 * Tests for src/styles.ts — focused on the parts that can run in pure node
 * (no jsdom dep): the static lookup helpers, and the CSS string content
 * that injectAnimations() writes into the document.
 *
 * For the inject path, we install a minimal fake `document` shim on
 * `globalThis` so the code under test can exercise its DOM-touching branch
 * without pulling in jsdom. The shim only needs `createElement`,
 * `head.appendChild`, and `setAttribute` — that's everything
 * injectAnimations actually calls.
 */

import { afterEach, describe, expect, it } from 'vitest'
import {
  injectAnimations,
  __resetAnimationsForTest,
  getThemeColors,
  resolveTheme,
  getButtonPosition,
  getModalPosition,
} from '../src/styles'

interface FakeStyleEl {
  setAttribute(name: string, value: string): void
  textContent: string
}

interface FakeDocument {
  createElement(tag: string): FakeStyleEl
  head: { appendChild(node: FakeStyleEl): void; children: FakeStyleEl[] }
  querySelectorAll(selector: string): FakeStyleEl[]
}

function installFakeDocument(): { doc: FakeDocument; uninstall: () => void } {
  const created: FakeStyleEl[] = []
  const doc: FakeDocument = {
    createElement: () => {
      const el: FakeStyleEl = {
        setAttribute: () => undefined,
        textContent: '',
      }
      created.push(el)
      return el
    },
    head: {
      children: [] as FakeStyleEl[],
      appendChild(node: FakeStyleEl) {
        this.children.push(node)
      },
    },
    querySelectorAll: () => created,
  }
  const prev = (globalThis as { document?: unknown }).document
  ;(globalThis as { document?: unknown }).document = doc
  return {
    doc,
    uninstall: () => {
      if (prev === undefined) {
        delete (globalThis as { document?: unknown }).document
      } else {
        ;(globalThis as { document?: unknown }).document = prev
      }
    },
  }
}

describe('injectAnimations', () => {
  afterEach(() => {
    __resetAnimationsForTest()
  })

  it('injects a <style> tag containing the keyframes', () => {
    const { doc, uninstall } = installFakeDocument()
    try {
      __resetAnimationsForTest()
      injectAnimations()
      expect(doc.head.children).toHaveLength(1)
      const css = doc.head.children[0]!.textContent
      expect(css).toContain('@keyframes __dtfb_fadeIn')
      expect(css).toContain('.__dtfb_widget')
      expect(css).toContain('.__dtfb_overlay')
    } finally {
      uninstall()
    }
  })

  it('emits a prefers-reduced-motion guard that disables animations', () => {
    const { doc, uninstall } = installFakeDocument()
    try {
      __resetAnimationsForTest()
      injectAnimations()
      const css = doc.head.children[0]!.textContent
      // The guard must be present...
      expect(css).toContain('@media (prefers-reduced-motion: reduce)')
      // ...and inside it, transitions + animations must be neutralized.
      // We can't parse @media in pure node, but a substring check is
      // sufficient — the entire block lives in one contiguous chunk.
      const guardIdx = css.indexOf('@media (prefers-reduced-motion: reduce)')
      const guardChunk = css.slice(guardIdx)
      expect(guardChunk).toContain('animation: none')
      expect(guardChunk).toContain('transition: none')
    } finally {
      uninstall()
    }
  })

  it('is idempotent — calling it multiple times only injects once', () => {
    const { doc, uninstall } = installFakeDocument()
    try {
      __resetAnimationsForTest()
      injectAnimations()
      injectAnimations()
      injectAnimations()
      expect(doc.head.children).toHaveLength(1)
    } finally {
      uninstall()
    }
  })
})

describe('resolveTheme', () => {
  it('returns the passed theme when explicit', () => {
    expect(resolveTheme('light')).toBe('light')
    expect(resolveTheme('dark')).toBe('dark')
  })

  it('falls back to light when window is undefined and theme is auto', () => {
    // Node test env has no window, so auto -> light.
    expect(resolveTheme('auto')).toBe('light')
  })
})

describe('getThemeColors', () => {
  it('uses the LIGHT_THEME palette for light', () => {
    const c = getThemeColors('light', '#FF0000')
    expect(c.background).toBe('#FFFFFF')
    expect(c.accent).toBe('#FF0000')
  })

  it('uses the DARK_THEME palette for dark', () => {
    const c = getThemeColors('dark', '#00FF00')
    expect(c.background).toBe('#1C1C1E')
    expect(c.accent).toBe('#00FF00')
  })

  it('builds a 12% focus ring from the accent color', () => {
    const c = getThemeColors('light', '#ABCDEF')
    expect(c.accentFocusRing).toBe('#ABCDEF20')
  })
})

describe('getButtonPosition / getModalPosition', () => {
  it('places the button in each corner', () => {
    expect(getButtonPosition('bottom-right')).toMatchObject({ bottom: '24px', right: '24px' })
    expect(getButtonPosition('bottom-left')).toMatchObject({ bottom: '24px', left: '24px' })
    expect(getButtonPosition('top-right')).toMatchObject({ top: '24px', right: '24px' })
    expect(getButtonPosition('top-left')).toMatchObject({ top: '24px', left: '24px' })
  })

  it('matches the modal alignment for each corner', () => {
    expect(getModalPosition('bottom-right')).toMatchObject({
      alignItems: 'flex-end',
      justifyContent: 'flex-end',
    })
    expect(getModalPosition('top-left')).toMatchObject({
      alignItems: 'flex-start',
      justifyContent: 'flex-start',
    })
  })
})
