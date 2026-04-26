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
  // LLM (Node-only — server-side BYOK)
  {
    entry: { 'llm/index': 'src/llm/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    external: ['react', 'react-dom'],
    treeshake: true,
    outDir: 'dist',
  },
  // Voice capture (browser-only — uses MediaRecorder + getUserMedia)
  {
    entry: { voice: 'src/voice.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    external: ['react', 'react-dom'],
    treeshake: true,
    outDir: 'dist',
  },
  // Storage adapters (Node-only — uses node:crypto + node:fs)
  {
    entry: { 'storage/index': 'src/storage/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    external: ['react', 'react-dom'],
    treeshake: true,
    outDir: 'dist',
  },
  // Routing sources — Tier 2: spreadsheet + CSV (Node-only)
  {
    entry: { 'routing-sources/index': 'src/routing-sources/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    external: ['react', 'react-dom'],
    treeshake: true,
    outDir: 'dist',
  },
  // Audit log (Node-only)
  {
    entry: { 'audit-log': 'src/audit-log.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    external: ['react', 'react-dom'],
    treeshake: true,
    outDir: 'dist',
  },
  // Network capture (browser-only — patches fetch + XHR)
  {
    entry: { 'network-capture': 'src/network-capture.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    external: ['react', 'react-dom'],
    treeshake: true,
    outDir: 'dist',
  },
  // Screen recording (browser-only — uses getDisplayMedia + MediaRecorder)
  {
    entry: { 'screen-recording': 'src/screen-recording.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    external: ['react', 'react-dom'],
    treeshake: true,
    outDir: 'dist',
  },
  // Release Campaigns (isomorphic — pure data + helpers)
  {
    entry: { campaigns: 'src/campaigns.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    external: ['react', 'react-dom'],
    treeshake: true,
    outDir: 'dist',
  },
  // Theme tokens (pure data — useful for consumers extracting just CSS vars)
  {
    entry: { theme: 'src/theme.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    external: ['react', 'react-dom'],
    treeshake: true,
    outDir: 'dist',
  },
  // Headless API (compound components, render-prop, slot-swap provider)
  {
    entry: { 'headless/index': 'src/headless/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    external: ['react', 'react-dom', 'html2canvas'],
    esbuildOptions(options) {
      options.jsx = 'automatic'
    },
    treeshake: true,
    splitting: false,
    outDir: 'dist',
  },
])
