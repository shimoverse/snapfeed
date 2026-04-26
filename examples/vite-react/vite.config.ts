import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Vite dev server proxies POSTs to /api/feedback to the small Express
 * backend in `server.mjs` (port 8788). In production you'd point the
 * widget at your own backend via the `apiUrl` prop on <FeedbackProvider>.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api/feedback': {
        target: 'http://localhost:8788',
        changeOrigin: true,
      },
    },
  },
})
