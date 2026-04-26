// ─────────────────────────────────────────────────────────────────────────────
// Why this webpack fallback is here
//
// WHAT:  In v0.5 the `snapfeed` main barrel re-exports a few server-only
//        adapters (file, googleSheets, s3 storage, etc.) alongside the React
//        widget. Those adapters reach for Node built-ins (`node:fs/promises`,
//        `node:crypto`, …) via lazy `await import(…)`.
// WHY:   The lazy import is fine at runtime — the adapter code never
//        executes in the browser — but webpack 5 statically resolves every
//        `import(...)` specifier it sees while building the client bundle
//        and errors out when a Node-only module can't be resolved. The
//        fallback below tells webpack to substitute an empty module for
//        those identifiers in the client chunk only.
// COST:  None at runtime. The client bundle already never executes those
//        code paths; the fallback only changes how webpack resolves them
//        during build.
// FUTURE: v0.6 splits the barrel into client- and server-only entry points
//         (issue tracker → "barrel split"), at which point this fallback
//         block can be deleted entirely.
// ─────────────────────────────────────────────────────────────────────────────

/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,

  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        'fs/promises': false,
        path: false,
        crypto: false,
        'node:fs': false,
        'node:fs/promises': false,
        'node:path': false,
        'node:crypto': false,
      }
    }
    return config
  },
}
