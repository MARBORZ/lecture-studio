import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // Development only (`npm run dev`): the app itself serves the built UI (frontend/dist) from its server.
  // UI on 5173, API on 3000 (proxied, same-origin for the browser: SSE, Range, uploads). While the app runs, its server
  // holds 5173: Vite takes the next free port. LS_UI_PORT / LS_API_PORT pin both (then the UI port must be free).
  server: {
    host: '127.0.0.1',
    port: Number(process.env.LS_UI_PORT ?? 5173),
    strictPort: Boolean(process.env.LS_UI_PORT),
    proxy: { '/api': { target: `http://127.0.0.1:${process.env.LS_API_PORT ?? 3000}` } },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
})
