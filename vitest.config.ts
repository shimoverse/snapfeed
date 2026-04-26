import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',          // most tests are pure / Node
    globals: false,
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/*.tsx', 'src/cli.ts'], // skip React for now
    },
  },
})
