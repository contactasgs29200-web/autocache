import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@imgly/background-removal', '@huggingface/transformers', 'onnxruntime-web'],
  },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        'refine-debug': 'refine-debug.html',
      },
    },
  },
})
