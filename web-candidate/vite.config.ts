import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = (env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3011').replace(/\/$/, '')

  return {
    plugins: [react()],
    optimizeDeps: {
      include: ['trtc-sdk-v5']
    },
    server: {
      port: 5174,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true
        }
      }
    }
  }
})
