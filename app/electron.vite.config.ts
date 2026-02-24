import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    build: {
      lib: {
        entry: resolve(__dirname, 'backend/main.ts')
      }
    },
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'backend/preload.ts'),
        output: {
          entryFileNames: 'index.js'
        }
      }
    },
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: resolve(__dirname, 'frontend'),
    server: {
      port: 5174
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'frontend/index.html')
      }
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'frontend/src')
      }
    },
    plugins: [vue()]
  }
})
