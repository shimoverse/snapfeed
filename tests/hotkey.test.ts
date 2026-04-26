/**
 * Unit tests for the hotkey helpers in FeedbackProvider.
 *
 * These run in plain node (no jsdom) because the helpers are pure
 * functions over a small subset of KeyboardEvent — `parseHotkey` works on
 * strings, `matchesHotkey` reads only the four modifier flags + key, and
 * `shouldSkipHotkeyForTarget` only inspects `tagName` + `isContentEditable`
 * on the event target. The helpers are intentionally exported with
 * `@internal` JSDoc so they can be tested without spinning up React.
 *
 * Coverage focus: the typing-skip behavior added in v0.5.2.
 */

import { describe, expect, it } from 'vitest'
import {
  parseHotkey,
  matchesHotkey,
  shouldSkipHotkeyForTarget,
} from '../src/FeedbackProvider'

describe('parseHotkey', () => {
  it('parses ctrl+shift+f into modifier flags + key', () => {
    expect(parseHotkey('ctrl+shift+f')).toEqual({
      ctrl: true,
      shift: true,
      meta: false,
      alt: false,
      key: 'f',
    })
  })

  it('treats meta/cmd/command as the same modifier', () => {
    expect(parseHotkey('cmd+/').meta).toBe(true)
    expect(parseHotkey('command+/').meta).toBe(true)
    expect(parseHotkey('meta+/').meta).toBe(true)
  })

  it('treats alt/option as the same modifier', () => {
    expect(parseHotkey('alt+x').alt).toBe(true)
    expect(parseHotkey('option+x').alt).toBe(true)
  })

  it('lowercases the key segment', () => {
    expect(parseHotkey('Ctrl+Shift+F').key).toBe('f')
  })
})

describe('matchesHotkey', () => {
  const parsed = parseHotkey('ctrl+shift+f')

  it('matches when all four modifiers + key align', () => {
    expect(
      matchesHotkey(
        { ctrlKey: true, metaKey: false, shiftKey: true, altKey: false, key: 'f' },
        parsed
      )
    ).toBe(true)
  })

  it('rejects when alt is also pressed (extra non-equivalent modifier)', () => {
    // ctrl+meta is allowed on Mac (meta substitutes for ctrl). alt is NOT
    // an equivalent — a hotkey of ctrl+shift+f must not fire when alt is also down.
    expect(
      matchesHotkey(
        { ctrlKey: true, metaKey: false, shiftKey: true, altKey: true, key: 'f' },
        parsed,
        false // force non-Mac to keep matcher strict on ctrl+meta combos
      )
    ).toBe(false)
  })

  it('compares the key case-insensitively', () => {
    expect(
      matchesHotkey(
        { ctrlKey: true, metaKey: false, shiftKey: true, altKey: false, key: 'F' },
        parsed
      )
    ).toBe(true)
  })
})

describe('shouldSkipHotkeyForTarget — typing in inputs', () => {
  // v0.5.2: ALWAYS skip the hotkey when the user is typing in an editable
  // element. Earlier versions only skipped for non-shift hotkeys, but that
  // meant the default ctrl+shift+f could steal a tester's in-progress input
  // and lose its content (e.g. an autocomplete that closes on blur).
  const ctrlShiftF = parseHotkey('ctrl+shift+f')

  // A "normal" custom combo without shift IS also subject to skip.
  const metaSlash = parseHotkey('meta+/')

  it('always skips when target is an editable element, even with shift', () => {
    const targets = [
      { tagName: 'INPUT' },
      { tagName: 'TEXTAREA' },
      { tagName: 'SELECT' },
      { isContentEditable: true },
    ]
    for (const t of targets) {
      expect(shouldSkipHotkeyForTarget(t as EventTarget, ctrlShiftF)).toBe(true)
    }
  })

  it('skips when target is an <input> and hotkey lacks shift', () => {
    expect(
      shouldSkipHotkeyForTarget({ tagName: 'INPUT' } as EventTarget, metaSlash)
    ).toBe(true)
  })

  it('skips when target is a <textarea> and hotkey lacks shift', () => {
    expect(
      shouldSkipHotkeyForTarget({ tagName: 'TEXTAREA' } as EventTarget, metaSlash)
    ).toBe(true)
  })

  it('skips when target is a contenteditable element and hotkey lacks shift', () => {
    expect(
      shouldSkipHotkeyForTarget(
        { tagName: 'DIV', isContentEditable: true } as EventTarget,
        metaSlash
      )
    ).toBe(true)
  })

  it('does not skip when target is a regular non-editable element', () => {
    expect(
      shouldSkipHotkeyForTarget({ tagName: 'BUTTON' } as EventTarget, metaSlash)
    ).toBe(false)
    expect(
      shouldSkipHotkeyForTarget({ tagName: 'DIV' } as EventTarget, metaSlash)
    ).toBe(false)
  })

  it('handles a null target safely', () => {
    expect(shouldSkipHotkeyForTarget(null, metaSlash)).toBe(false)
  })
})
