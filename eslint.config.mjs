// ESLint flat config (ESLint 9). See MAIN_THREAD_LINT_NOTES.md for the
// list of devDependencies + scripts that need to be added to package.json
// before this config can run.
//
// Design decisions:
//   - We use `tseslint.configs.recommended` (NOT `recommendedTypeChecked`) for
//     the base TS rules. Type-aware linting is great but it generates 100+
//     warnings on existing code (no-unsafe-assignment, no-unsafe-member-access,
//     no-floating-promises, etc.) that would force a large refactor right now.
//     Once the codebase is stabilized we can switch to recommendedTypeChecked
//     for src/ specifically.
//   - parserOptions.project is wired up only for src/**, so type-aware rules
//     CAN be opted into per-rule later without re-config. Tests + examples
//     stay non-type-aware to keep lint fast and to avoid project-reference
//     drift on the example apps (which have their own tsconfigs).
//   - Most plugin findings are 'warn' rather than 'error' — the goal is to
//     surface issues without blocking CI on existing code. Tighten to 'error'
//     once warnings hit zero.

import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import importPlugin from 'eslint-plugin-import'
import security from 'eslint-plugin-security'

export default [
  // 1. Global ignores. Flat config requires this as its own object with only
  //    `ignores` — anything else makes it a regular config block.
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'examples/*/node_modules/**',
      'examples/*/.next/**',
      'coverage/**',
      '**/*.tsbuildinfo',
    ],
  },

  // 2. Base recommended rule sets.
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // 3. Source files (src/**). Type-aware parser is wired in here so that any
  //    rule we later promote to type-aware will work without further config.
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
        ecmaFeatures: { jsx: true },
      },
      globals: {
        // Browser + Node globals — the lib runs in both environments.
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        fetch: 'readonly',
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        FormData: 'readonly',
        Blob: 'readonly',
        File: 'readonly',
        FileReader: 'readonly',
        MediaRecorder: 'readonly',
        MediaStream: 'readonly',
        HTMLElement: 'readonly',
        HTMLCanvasElement: 'readonly',
        HTMLImageElement: 'readonly',
        HTMLInputElement: 'readonly',
        XMLHttpRequest: 'readonly',
        AbortController: 'readonly',
        crypto: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
      import: importPlugin,
      security,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      // --- React ---
      ...react.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off', // new JSX transform (Next.js / React 17+)
      'react/prop-types': 'off', // we use TypeScript

      // --- React hooks ---
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn', // famously noisy — keep as warn

      // --- jsx-a11y subset (warn — many existing widget components likely trip these) ---
      'jsx-a11y/alt-text': 'warn',
      'jsx-a11y/anchor-has-content': 'warn',
      'jsx-a11y/click-events-have-key-events': 'warn',
      'jsx-a11y/no-static-element-interactions': 'warn',

      // --- import ---
      'import/no-cycle': 'warn',
      'import/no-duplicates': 'warn',
      'import/no-unresolved': 'off', // TS handles this

      // --- security (recommended-ish, with several off) ---
      ...security.configs.recommended.rules,
      'security/detect-non-literal-regexp': 'off', // adapters use dynamic patterns intentionally
      'security/detect-object-injection': 'off', // mostly false positives on typed-object key access
      'security/detect-non-literal-fs-filename': 'off', // CLI legitimately uses dynamic paths
      'security/detect-unsafe-regex': 'off', // CC pattern is intentional and bounded
      // no-eval is part of base eslint:recommended already; security plugin
      // has detect-eval-with-expression which we leave on.

      // --- TypeScript overrides ---
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',

      // --- Misc ---
      'no-console': 'off', // adapters legitimately log warnings
    },
  },

  // 4. Tests + examples — same rule set, but no type-aware parsing (faster,
  //    avoids project-reference drift with example apps).
  {
    files: ['tests/**/*.{ts,tsx}', 'examples/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        fetch: 'readonly',
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        // Vitest globals
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        vi: 'readonly',
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
      import: importPlugin,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'off', // tests often intentionally pass stale deps
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'off', // tests need any for mocking
      '@typescript-eslint/no-non-null-assertion': 'off', // tests assert known-good fixtures
      'no-console': 'off',
    },
  },

  // 5. Plain JS / CJS / MJS files (Node configs, plain JS scripts, server.mjs)
  {
    files: ['**/*.cjs', '**/*.mjs', '**/*.config.js', 'docker/worker.cjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
      // Plain JS / CJS — disable TS-only rules that flat config
      // tseslint.configs.recommended would otherwise apply.
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-var-requires': 'off',
    },
  },

  // 6. server.mjs in vite-react example (ESM, Node-only)
  {
    files: ['examples/vite-react/server.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
]
