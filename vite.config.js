import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Identifiant du build, affiché dans le menu de l'application. Sur Vercel,
// VERCEL_GIT_COMMIT_SHA est renseigné à la construction : la version installée
// sur un téléphone devient donc vérifiable en deux gestes, sans avoir à
// deviner si un correctif est bien déployé.
const commit = process.env.VERCEL_GIT_COMMIT_SHA || ''
const buildId = commit ? commit.slice(0, 7) : 'dev'

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')),
  },
  optimizeDeps: {
    exclude: ['@imgly/background-removal', '@huggingface/transformers', 'onnxruntime-web'],
  },
})
