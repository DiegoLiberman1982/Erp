import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom']
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:5000',
      '/accounts': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
        secure: false,
      }
    },
    fs: {
      allow: [
        path.resolve(__dirname),
        path.resolve(__dirname, '..')
      ]
    }
  },
  build: {
    rollupOptions: {
      input: {
        main: './index.html',
        handsontable: './handsontable-demo.html'
      }
    }
  }
})
