import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// La versión de la app vive en version.txt (raíz del repo); build.bat la bumpea.
const version = readFileSync(fileURLToPath(new URL('../version.txt', import.meta.url)), 'utf-8').trim()

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
})
