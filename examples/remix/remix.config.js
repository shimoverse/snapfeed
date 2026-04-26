// This file is `.js` but the example's package.json sets `"type": "module"`,
// so it MUST be ESM. Earlier versions used `module.exports = {...}` which
// fails with "module is not defined in ES module scope" — Remix wouldn't
// load the config and `npm run dev` aborted.

/** @type {import('@remix-run/dev').AppConfig} */
export default {
  ignoredRouteFiles: ['**/.*'],
  serverModuleFormat: 'esm',
}
