import { defineConfig } from 'tsup'

export default defineConfig([
  // Main entry (React components + hooks)
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    external: ['react', 'react-dom', 'html2canvas'],
    esbuildOptions(options) {
      options.jsx = 'automatic'
    },
    treeshake: true,
    splitting: false,
    outDir: 'dist',
  },
  // Adapters entry (no React dependency)
  {
    entry: { 'adapters/index': 'src/adapters/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    external: ['react', 'react-dom', 'html2canvas', '@supabase/supabase-js'],
    treeshake: true,
    splitting: false,
    outDir: 'dist',
  },
  // Server: Next.js handler
  {
    entry: { 'server/nextjs': 'src/server/nextjs.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    external: ['react', 'react-dom', 'next', '@supabase/supabase-js'],
    treeshake: true,
    outDir: 'dist',
  },
  // Server: Express middleware
  {
    entry: { 'server/express': 'src/server/express.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    external: ['react', 'react-dom', 'express', '@supabase/supabase-js'],
    treeshake: true,
    outDir: 'dist',
  },
  // Routing module (pure config helpers, no React)
  {
    entry: { routing: 'src/routing.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    external: ['react', 'react-dom'],
    treeshake: true,
    outDir: 'dist',
  },
  // CLI (Node-only). Source already begins with `#!/usr/bin/env node`,
  // so we don't add a banner — that would double-shebang the output.
  {
    entry: { cli: 'src/cli.ts' },
    format: ['cjs'],
    dts: false,
    sourcemap: false,
    target: 'node18',
    platform: 'node',
    treeshake: true,
    outDir: 'dist',
  },
])
