// Assembles a fully self-contained standalone HTML export from a scene:
// inline CSS, an inline copy of the runtime (the same createCssRenderer +
// runAnimation the editor's Preview drives, see runtime-entry.js), and the
// scene JSON itself. The only network request an exported file can make is
// the iframe src for content.type === 'url' — image content is already a
// data URI baked into the scene, and everything else here is inlined.
//
// The runtime scripts are prebuilt by `npm run build:runtime` (see
// vite.runtime.config.js) into generated/runtime.iife.js (css-only, small)
// and generated/runtime-gl.iife.js (adds three.js, for webgl scenes); `?raw`
// pulls each in verbatim so this module never needs its own bundler at
// export time. Only one is embedded per export, chosen by scene.renderer, so
// a css-scene export doesn't pay for three.js it never uses. Must not import
// React — this module also runs inside the exported runtime's build graph
// indirectly via shared core/render modules.

import runtimeCssScript from './generated/runtime.iife.js?raw'
import runtimeGlScript from './generated/runtime-gl.iife.js?raw'
import deviceCss from '../render/css/device.css?raw'

// The scene JSON sits inside an inline <script> tag. Escaping "<" means a
// literal "</script>" arriving through e.g. a url-content field can't
// terminate the tag early and inject a sibling script.
function escapeForInlineScript(json) {
  return json.replace(/</g, '\\u003c')
}

// scene.style.background is emitted into a <style> block, so it is allowlisted
// to shapes a CSS color can actually take (#hex, a bare keyword, or an
// rgb()/rgba()/hsl()/hsla() call). Anything else — including anything that
// could close the rule or the tag — is dropped rather than escaped.
const SAFE_CSS_COLOR = /^(#[0-9a-f]{3,8}|[a-z]+|(rgb|hsl)a?\([0-9a-z%.,\s/]+\))$/i

function safeBackground(background) {
  if (!background || background === 'transparent') return null
  return SAFE_CSS_COLOR.test(background.trim()) ? background.trim() : null
}

// The exported page's own chrome (the editor's app.css is not shipped): kill
// the UA body margin, center the device instead of pinning it to the top-left,
// and paint scene.style.background across the whole page so an exported file
// reads the same standalone as it did in the editor's stage.
function pageCss(scene, isScrollScene) {
  const background = safeBackground(scene.style.background)
  const bodyBackground = background ? `background:${background};` : ''
  if (isScrollScene) {
    // A scroll-rotate export needs something to scroll: the device sits in a
    // full-viewport band with a viewport-tall spacer above and below, so the
    // stage travels through the viewport and the preset's progress actually
    // sweeps 0 -> 1 in a standalone file.
    return (
      `html,body{margin:0;}body{${bodyBackground}}` +
      `.ma-scroll-spacer{height:100vh;}` +
      `.ma-scroll-stage{display:flex;align-items:center;justify-content:center;min-height:100vh;}`
    )
  }
  return `html,body{margin:0;}body{min-height:100vh;display:flex;align-items:center;justify-content:center;${bodyBackground}}`
}

/**
 * @param {object} scene - a scene spec object (see core/scene.js)
 * @returns {string} a complete, self-contained HTML document
 */
export function buildExportHtml(scene) {
  const sceneJson = escapeForInlineScript(JSON.stringify(scene))
  const runtimeScript = scene.renderer === 'webgl' ? runtimeGlScript : runtimeCssScript
  const isScrollScene = scene.animation?.preset === 'scroll-rotate'
  const rootMarkup = isScrollScene
    ? '<div class="ma-scroll-spacer"></div>\n<div class="ma-scroll-stage"><div id="ma-root"></div></div>\n<div class="ma-scroll-spacer"></div>'
    : '<div id="ma-root"></div>'

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Showcase export</title>
<style>${deviceCss}
${pageCss(scene, isScrollScene)}</style>
</head>
<body>
${rootMarkup}
<script>${runtimeScript}</script>
<script>window.Showcase.mount(document.getElementById('ma-root'), ${sceneJson})</script>
</body>
</html>
`
}
