/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,

  // The `snapfeed` package re-exports server-only adapters (file, googleSheets,
  // s3 storage, etc.) from its main barrel. These import Node built-ins
  // (`node:fs/promises`, `node:crypto`, etc.) lazily via `await import(...)`,
  // but webpack's static analysis still tries to resolve them in the client
  // bundle and fails the build. Provide explicit fallbacks so the client
  // chunk treats them as empty modules.
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
