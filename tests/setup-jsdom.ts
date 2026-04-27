/**
 * Vitest setup file used by jsdom-environment tests.
 *
 * jsdom (as of v24) does not implement a few browser APIs that snapfeed
 * touches at render time. Stubbing them once globally is cleaner than
 * patching every test file.
 *
 * Loaded only by tests opting into jsdom (see vitest.config.ts:
 *   environmentMatchGlobs maps tests/headless/*.test.tsx -> jsdom).
 */

if (typeof window !== 'undefined') {
  // FeedbackProvider's theme resolver calls window.matchMedia('(prefers-color-scheme: dark)')
  // when theme === 'auto'. Default it to "light scheme" in tests.
  if (typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        // Legacy listener API
        addListener: () => undefined,
        removeListener: () => undefined,
        // Modern listener API
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }),
    })
  }

  // Some snapfeed widgets touch window.scrollTo / window.scrollX during open.
  // jsdom implements these as no-ops, which is what we want — but if a
  // future jsdom tightens behavior, stub them here.
}
