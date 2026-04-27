import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Default to Node — keeps non-DOM tests fast. React component / hook
    // tests under tests/headless/ opt into jsdom via environmentMatchGlobs.
    environment: 'node',
    globals: false,
    // Match both .ts (Node helpers, adapters, server code) and .tsx
    // (React component tests).
    include: ['tests/**/*.test.{ts,tsx}'],
    // Per-file environment selection. Files under tests/headless/ run under
    // jsdom; everything else stays on the fast Node environment.
    environmentMatchGlobs: [
      ['tests/headless/**/*.test.tsx', 'jsdom'],
    ],
    // Shared setup for jsdom-environment tests (matchMedia polyfill, etc).
    setupFiles: ['tests/setup-jsdom.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/cli.ts'],
    },
  },
})
