import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Builds a self-contained IIFE of the showcase runtime (src/showcase/runtime.js)
// for bin/showcase.mjs's --html export to inline verbatim into a single HTML
// file alongside an embedded cfg + content data URI (see runHtmlExport in
// bin/showcase.mjs). Mirrors vite.runtime.config.js's pattern for the
// editor's own standalone-export runtime — built on demand by the CLI, not
// wired into npm's predev/prebuild/pretest hooks, since only --html needs it.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'src/showcase/generated',
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, 'src/showcase/runtime.js'),
      name: 'ShowcaseHeroRuntime',
      formats: ['iife'],
      fileName: () => 'showcase-runtime.iife.js',
    },
  },
})
