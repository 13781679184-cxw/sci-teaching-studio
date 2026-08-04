import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const demo = mode === 'demo'
  return {
    plugins: [react()],
    // Demo deploys to Cloudflare Pages at site root. GitHub mirror: `npm run build:demo:github`.
    base: '/',
    define: demo
      ? {
          'import.meta.env.VITE_DEMO_BUILD': JSON.stringify(String(Date.now())),
        }
      : undefined,
    server: {
      host: '0.0.0.0',
      port: 5180,
      allowedHosts: true,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:2025',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api/, ''),
        },
      },
    },
  }
})
