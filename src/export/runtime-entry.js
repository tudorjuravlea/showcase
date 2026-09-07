// Standalone runtime entry point. Bundled by vite.runtime.config.js into
// generated/runtime.iife.js, which exporter.js inlines verbatim into
// exported HTML files. Plain JS only — no React, no bundler assumptions —
// because this script runs inside a standalone file with no build step of
// its own.
//
// It exposes the exact same createCssRenderer + runAnimation the editor's
// Preview uses (see src/app/Preview.jsx), so an exported animation looks
// identical to the editor.

import { createCssRenderer } from '../render/css/cssRenderer.js'
import { runAnimation } from '../core/presets.js'

function mount(el, scene) {
  const renderer = createCssRenderer(el)
  renderer.render(scene)
  const animation = runAnimation(scene, (pose) => renderer.setPose(pose), el)

  return {
    destroy() {
      animation.stop()
      renderer.destroy()
    },
  }
}

window.Showcase = { mount }
