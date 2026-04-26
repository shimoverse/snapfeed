// Bundle-size budgets for snapfeed. Limits leave headroom for legitimate
// growth but catch runaway regressions (e.g. accidentally bundling a heavy
// dep, breaking tree-shaking).
//
// Only browser-safe entries are measured here. Server-side entries
// (snapfeed/adapters, snapfeed/llm, snapfeed/storage, snapfeed/audit-log,
// snapfeed/routing-sources, snapfeed/server/*) import Node built-ins like
// `node:crypto` / `node:fs/promises` and can't be bundled in browser-mode
// without an externalize-Node-builtins shim. Their size is largely a function
// of which adapters the consumer enables, so a single budget number isn't
// meaningful.
//
// To re-baseline: run `npm run size` after a `npm run build`.

module.exports = [
  // Pure config — should be tiny.
  { name: 'snapfeed/routing', path: 'dist/routing.js', limit: '5 KB', gzip: true },

  // Theme tokens — pure data.
  { name: 'snapfeed/theme', path: 'dist/theme.js', limit: '5 KB', gzip: true },

  // Campaigns — pure data + helpers.
  { name: 'snapfeed/campaigns', path: 'dist/campaigns.js', limit: '5 KB', gzip: true },

  // Voice — browser-only utility.
  { name: 'snapfeed/voice', path: 'dist/voice.js', limit: '5 KB', gzip: true },

  // Screen recording — browser-only utility.
  {
    name: 'snapfeed/screen-recording',
    path: 'dist/screen-recording.js',
    limit: '5 KB',
    gzip: true,
  },

  // Network capture — browser-only utility.
  {
    name: 'snapfeed/network-capture',
    path: 'dist/network-capture.js',
    limit: '5 KB',
    gzip: true,
  },
]
