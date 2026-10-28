import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  // FLESPI_TOKEN (no VITE_ prefix, so it is never inlined into the bundle) is the
  // one Flespi key. In `vite dev` mock mode the dev server adds it to /flespi
  // requests — the same job netlify/functions/flespi-proxy.mjs does in production.
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: {
        '/flespi': {
          target: 'https://flespi.io',
          changeOrigin: true,
          rewrite: path => path.replace(/^\/flespi/, ''),
          configure: proxy => {
            proxy.on('proxyReq', proxyReq => {
              proxyReq.setHeader('Authorization', `FlespiToken ${env.FLESPI_TOKEN ?? ''}`)
            })
          },
        },
      },
    },
  }
})
