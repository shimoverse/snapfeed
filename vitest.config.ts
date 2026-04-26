import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Default to Node — individual React test files opt into jsdom by
    // adding a vitest-environment pragma at the top of the file. This
    // keeps non-DOM tests fast.
    environment: 'node',
    globals: false,
    // Match both .ts (Node helpers, adapters, server code) and .tsx
    // (React component tests). The previous glob was *.test.ts only,
    // which silently skipped every .tsx test file in CI.
    include: ['tests/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/cli.ts'],
    },
  },
})
