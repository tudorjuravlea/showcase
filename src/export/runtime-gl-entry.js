// Standalone WebGL-capable runtime entry point. Bundled by
// vite.runtime.config.js (MA_RUNTIME_TARGET=gl) into
// generated/runtime-gl.iife.js, which exporter.js inlines verbatim into
// webgl-scene exported HTML files. Plain JS only — no React, no bundler
// assumptions — because this script runs inside a standalone file with no
// build step of its own. Unlike runtime-entry.js, this bundle includes
// three.js, so it's only embedded for scene.renderer === 'webgl' exports.
//
// Registers both renderer factories and picks by scene.renderer so the same
// mount() contract works regardless of which renderer produced the scene
// (see src/export/exporter.js).

import { createCssRenderer } from '../render/css/cssRenderer.js'
import { createGlRenderer } from '../render/webgl/glRenderer.js'
import { runAnimation } from '../core/presets.js'

const RENDERER_FACTORIES = { css: createCssRenderer, webgl: createGlRenderer }

const FALLBACK_MESSAGE = 'This animation needs WebGL, which this browser can’t run.'
const FALLBACK_STYLE = [
  'display:flex',
  'align-items:center',
  'justify-content:center',
  'box-sizing:border-box',
  'min-height:240px',
  'padding:24px',
  'border-radius:12px',
  'background:#f2f2f4',
  'color:#3a3a3c',
  'font:15px/1.5 system-ui, -apple-system, Segoe UI, sans-serif',
  'text-align:center',
].join(';')

// Per the spec's "Error handling" section: "WebGL unavailable -> ... exported
// WebGL file shows a static fallback message". Without this the exported file
// renders blank and throws on load, because createGlRenderer/THREE.WebGLRenderer
// only fails once it tries to obtain a context — which the editor's own
// availability check can't cover for whatever browser opens the export later.
function mountFallback(el) {
  el.innerHTML = ''
  const notice = document.createElement('div')
  notice.className = 'ma-fallback'
  notice.setAttribute('role', 'status')
  notice.style.cssText = FALLBACK_STYLE
  notice.textContent = FALLBACK_MESSAGE
  el.appendChild(notice)

  return {
    destroy() {
      el.innerHTML = ''
    },
  }
}

function mount(el, scene) {
  const createRenderer = RENDERER_FACTORIES[scene.renderer] || createCssRenderer
  let renderer = null
  try {
    renderer = createRenderer(el)
    renderer.render(scene)
  } catch {
    try {
      renderer?.destroy()
    } catch {
      // a renderer that failed mid-build may also fail to tear itself down;
      // the fallback below clears the container either way.
    }
    return mountFallback(el)
  }

  const animation = runAnimation(scene, (pose) => renderer.setPose(pose), el)

  return {
    destroy() {
      animation.stop()
      renderer.destroy()
    },
  }
}

window.Showcase = { mount }
