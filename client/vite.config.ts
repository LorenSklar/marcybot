import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same network as phone: listen on all interfaces (0.0.0.0). `true` is Vite’s shorthand.
    host: true,
    proxy: {
      // Express API (add `server` workspace later); avoids CORS during local dev
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: true,
  },
})
