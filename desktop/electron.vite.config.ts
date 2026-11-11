import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

// Default entries: src/main/index.ts, src/preload/index.ts and src/renderer/index.html, built to out/.
export default defineConfig({
  main: {},
  // A sandboxed preload script must be CommonJS, even though the package is an ES module.
  preload: { build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } } },
  renderer: { plugins: [react()] }
})
