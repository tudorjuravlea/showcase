import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Second entry: showcase.html + src/showcase/runtime.js (no React) —
    // see docs/superpowers/specs/2026-09-04-showcase-design.md §4. The
    // editor app (index.html) is untouched.
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        showcase: path.resolve(__dirname, 'showcase.html'),
      },
    },
  },
  test: {
    // Playwright owns e2e/*.spec.js — keep Vitest scoped to unit tests.
    include: ['tests/**/*.test.js'],
  },
})
