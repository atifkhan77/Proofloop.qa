import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Read .env from the monorepo root (only VITE_* vars are exposed to the client).
  envDir: path.resolve(__dirname, '../..'),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Regex, not the '/api' prefix: a plain prefix also matched client routes such as
      // /api-collections/:id, so a direct visit or refresh returned Express "Cannot GET".
      '^/api(/|$)': 'http://localhost:4000',
    },
  },
})
