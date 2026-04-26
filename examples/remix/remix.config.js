// This file is `.js` but the example's package.json sets `"type": "module"`,
// so it MUST be ESM. Earlier versions used `module.exports = {...}` which
// fails with "module is not defined in ES module scope" — Remix wouldn't
// load the config and `npm run dev` aborted.

/** @type {import('@remix-run/dev').AppConfig} */
export default {
  ignoredRouteFiles: ['**/.*'],
  serverModuleFormat: 'esm',
  // The `snapfeed` barrel re-exports a few server-only adapters (`fileAdapter`,
  // `googleSheetsAdapter`, `defaultRateLimitStore`) that import `node:fs`,
  // `node:path`, and `node:crypto`. Tree-shaking removes them from runtime
  // browser code, but Remix's bundler still needs to satisfy the resolution.
  // Polyfilling these to empty modules in the browser bundle is the fix Remix
  // itself recommends in the error message — and safe here because none of the
  // server-only code paths execute in the browser. (We do NOT need polyfills
  // on the server bundle — the node built-ins resolve normally there.)
  browserNodeBuiltinsPolyfill: {
    modules: {
      fs: true,
      'fs/promises': true,
      path: true,
      crypto: true,
      stream: true,
      url: true,
      util: true,
      buffer: true,
    },
  },
}
