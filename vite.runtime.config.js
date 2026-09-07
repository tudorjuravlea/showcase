import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Builds the standalone runtime that exporter.js inlines into exported
// HTML files (see src/export/runtime-entry.js). It must be a single
// self-contained IIFE with no ES module imports left in the output.
//
// MA_RUNTIME_TARGET selects which runtime entry to build: 'css' (default,
// small, no three.js) or 'gl' (includes three.js, for webgl-scene exports).
const TARGET = process.env.MA_RUNTIME_TARGET || 'css'

const ENTRIES = {
  css: path.resolve(__dirname, 'src/export/runtime-entry.js'),
  gl: path.resolve(__dirname, 'src/export/runtime-gl-entry.js'),
}

const OUTPUT_NAMES = {
  css: 'runtime.iife.js',
  gl: 'runtime-gl.iife.js',
}

const entry = ENTRIES[TARGET]
if (!entry) {
  throw new Error(`Unknown MA_RUNTIME_TARGET: ${TARGET}`)
}

// The 'gl' runtime bundles three.js (see THIRD-PARTY-NOTICES.md's "Bundled
// into generated output" section) — every standalone HTML this tool exports
// with a webgl scene carries this comment at the top of its inline <script>.
const BANNERS = {
  css: null,
  gl: '/*! three.js (MIT) Copyright 2010-2026 three.js authors — bundled; see THIRD-PARTY-NOTICES.md */',
}

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'src/export/generated',
    emptyOutDir: false,
    lib: {
      entry,
      name: 'ShowcaseRuntime',
      formats: ['iife'],
      fileName: () => OUTPUT_NAMES[TARGET],
    },
    rollupOptions: {
      output: {
        banner: BANNERS[TARGET] || undefined,
      },
    },
  },
})
