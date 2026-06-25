import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/flespi': {
        target: 'https://flespi.io',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/flespi/, ''),
      },
    },
  },
})
