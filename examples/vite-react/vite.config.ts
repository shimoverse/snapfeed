import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Vite dev server proxies POSTs to /api/feedback to the small Express
 * backend in `server.mjs`. In production you'd point the widget at your
 * own backend via the `apiUrl` prop on <FeedbackProvider>.
 *
 * The proxy target reads PORT from the environment so it stays in sync
 * with `server.mjs` when you move the backend off the default 8788.
 */
const backendPort = Number(process.env.PORT ?? 8788)

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api/feedback': {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
      },
    },
  },
})
