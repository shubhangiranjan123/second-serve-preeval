import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // The AI backend (server/index.mjs) holds the API key. The browser only
    // ever talks to /api on its own origin; Vite forwards it in development.
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: true } },
  },
  preview: {
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: true } },
  },
})
