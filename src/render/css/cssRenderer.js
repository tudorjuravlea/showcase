// CSS 3D renderer ("Interactive"). Builds a layered DOM tree from the
// parametric device specs and applies the scene's pose as CSS transforms.
// Must not import React — this module also runs inside exported standalone
// HTML files.

import { DEVICES, deviceDims } from '../../core/devices.js'

const PERSPECTIVE = 1200
const EXPLODE_GAP = 60
// Depth (px-ish units) of the laptop's keyboard-deck base, measured along the
// device plane before it's folded flat — see the isLaptop branch of
// buildDeviceDom() below. Not a DEVICES field: it's a CSS-renderer layout
// constant, not part of the shared device spec (unlike `thickness`, which
// both renderers consume).
const LAPTOP_BASE_DEPTH = 200

function px(n) {
  return `${n}px`
}

function poseTransform(pose) {
  return (
    `perspective(${px(PERSPECTIVE)}) ` +
    `translate3d(${px(pose.translateX)}, ${px(pose.translateY)}, ${px(pose.translateZ)}) ` +
    `rotateX(${pose.rotateX}deg) rotateY(${pose.rotateY}deg) rotateZ(${pose.rotateZ}deg) ` +
    `scale(${pose.scale})`
  )
}

function layerTransform(depth, index, explode) {
  return `translateZ(${px(depth + explode * EXPLODE_GAP * index)})`
}

function createLayer(id) {
  const el = document.createElement('div')
  el.className = `ma-layer ma-${id}`
  return el
}

function createContentEl(content) {
  if (content.type === 'url') {
    const iframe = document.createElement('iframe')
    iframe.className = 'ma-content'
    iframe.src = content.src || ''
    iframe.title = 'preview content'
    return iframe
  }
  const img = document.createElement('img')
  img.className = 'ma-content'
  if (content.src) img.src = content.src
  img.alt = ''
  return img
}

function createNotch() {
  const notch = document.createElement('div')
  notch.className = 'ma-notch'
  return notch
}

function createGlare() {
  const glare = document.createElement('div')
  glare.className = 'ma-glare'
  return glare
}

function createBoxFace(className) {
  const el = document.createElement('div')
  el.className = className
  return el
}

// Gives the body layer real thickness: a front face (existing visual role),
// a back face a `thickness` behind it, and four edge walls connecting them —
// per spec §1, "the body renders as a true 3D box... rotation around any
// axis must show shaded side surfaces, never a paper edge." Front/back get
// the device's cornerRadius (rounded silhouette); the walls are plain
// (unrounded) rectangles spanning the full edge — a cheap approximation
// that leaves a small, mostly-invisible square-corner sliver behind the
// rounded front/back faces rather than gaps at the rounded corners.
function buildBodyBox(device, scene) {
  const { cornerRadius, thickness } = device
  const body = createLayer('body')

  const front = createBoxFace('ma-box-front')
  front.style.borderRadius = px(cornerRadius)
  if (device.name === 'browser') {
    front.appendChild(createBrowserChrome(scene.content))
  }

  const back = createBoxFace('ma-box-back')
  back.style.borderRadius = px(cornerRadius)
  back.style.transform = `translateZ(${px(-thickness)})`

  const wallTop = createBoxFace('ma-box-wall ma-box-wall-top')
  wallTop.style.height = px(thickness)
  const wallBottom = createBoxFace('ma-box-wall ma-box-wall-bottom')
  wallBottom.style.height = px(thickness)
  const wallLeft = createBoxFace('ma-box-wall ma-box-wall-left')
  wallLeft.style.width = px(thickness)
  const wallRight = createBoxFace('ma-box-wall ma-box-wall-right')
  wallRight.style.width = px(thickness)

  // Back-to-front DOM order so the 2D stacking-context fallback (browsers
  // that don't sort preserve-3d children by depth) still reads plausibly.
  body.append(back, wallTop, wallBottom, wallLeft, wallRight, front)
  return body
}

// A soft blurred halo behind the device (per the spec's Renderer 1 section:
// "glow = blurred box-shadow"). Lives inside .ma-device (not a sibling in
// containerEl) so it inherits the device's own 3D pose transform via
// preserve-3d — it rotates/moves with the device the way a screen-light
// bleed would, rather than staying flat like the ground contact shadow.
// Given its own translateZ (behind the shell, which sits at depth 0) so it
// paints behind every other layer under preserve-3d's z-sorting.
function createGlowHalo() {
  const glow = document.createElement('div')
  glow.className = 'ma-glow-halo'
  glow.style.transform = 'translateZ(-40px)'
  return glow
}

function createBrowserChrome(content) {
  const chrome = document.createElement('div')
  chrome.className = 'ma-browser-chrome'

  const dots = document.createElement('div')
  dots.className = 'ma-browser-dots'
  for (let i = 0; i < 3; i += 1) {
    const dot = document.createElement('span')
    dot.className = 'ma-browser-dot'
    dots.appendChild(dot)
  }

  const urlPill = document.createElement('div')
  urlPill.className = 'ma-browser-url'
  urlPill.textContent = content.type === 'url' ? content.src : ''

  chrome.appendChild(dots)
  chrome.appendChild(urlPill)
  return chrome
}

function buildShell(device) {
  const shell = createLayer('shell')
  shell.style.borderRadius = px(device.cornerRadius)
  return shell
}

function buildLayers(device, scene) {
  const { bezel, screenRadius, hasNotch } = device

  const shell = buildShell(device)
  const body = buildBodyBox(device, scene)

  const screen = createLayer('screen')
  screen.style.borderRadius = px(screenRadius)
  screen.style.top = px(bezel.top)
  screen.style.right = px(bezel.right)
  screen.style.bottom = px(bezel.bottom)
  screen.style.left = px(bezel.left)
  screen.appendChild(createContentEl(scene.content))
  if (hasNotch) screen.appendChild(createNotch())

  const glass = createLayer('glass')
  glass.style.borderRadius = px(screenRadius)
  glass.style.top = px(bezel.top)
  glass.style.right = px(bezel.right)
  glass.style.bottom = px(bezel.bottom)
  glass.style.left = px(bezel.left)
  if (scene.style.glare) glass.appendChild(createGlare())

  return { shell, body, screen, glass }
}

// Maps a {shell, body, screen, glass} (or a subset of it — the laptop base
// only has shell/body) to the {el, depth, index} entries applyPose() uses
// for the per-layer explode translateZ, keeping each element's *original*
// device.layers index (0=shell..3=glass) even when some ids are absent.
function layerElsFor(byId, device) {
  return device.layers
    .map((layer, index) => ({ el: byId[layer.id], depth: layer.depth, index }))
    .filter((entry) => entry.el)
}

function buildDeviceDom(scene, dims) {
  const device = DEVICES[scene.device]
  const byId = buildLayers(device, scene)

  const isLaptop = device.name === 'laptop'

  const deviceEl = document.createElement('div')
  deviceEl.className = 'ma-device'
  deviceEl.dataset.device = device.name
  deviceEl.style.width = px(dims.width)
  // The laptop's base is a separate slab hinged below the lid (see below),
  // folded flat via a static rotateX(-90deg) rather than sharing the lid's
  // own height box — so the device's overall bounding box needs the extra
  // depth added on top of the lid's own dims.height, or the fit-to-wrapper
  // sizing in Preview.jsx (which reads this element's own box) would treat
  // the folded-down base as invisible overflow.
  deviceEl.style.height = px(isLaptop ? dims.height + LAPTOP_BASE_DEPTH : dims.height)
  // Appended first so it's the device's first child (paint-order fallback);
  // preserve-3d's z-sorting is what actually keeps it behind the other
  // layers once posed.
  if (scene.style.glow) deviceEl.appendChild(createGlowHalo())

  let lidEl = null
  let layerEls

  if (isLaptop) {
    // Lid: the full shell/body/screen/glass stack, unchanged in kind from
    // every other device, occupying the lid's own dims.height (the device
    // spec's bezel/cornerRadius/screenRadius are all authored against this
    // module). Hinged at its own bottom edge.
    lidEl = document.createElement('div')
    lidEl.className = 'ma-lid'
    lidEl.style.top = px(0)
    lidEl.style.height = px(dims.height)
    lidEl.appendChild(byId.shell)
    lidEl.appendChild(byId.body)
    lidEl.appendChild(byId.screen)
    lidEl.appendChild(byId.glass)

    // Base: a second, independent shell+body box (its own front/back/walls
    // via buildBodyBox) representing the keyboard deck. Positioned starting
    // exactly at the lid's hinge line and folded flat by the fixed
    // rotateX(-90deg) in device.css — see spec §1 "flat foreshortened
    // base... extending toward viewer".
    const baseShell = buildShell(device)
    const baseBody = buildBodyBox(device, scene)
    const base = document.createElement('div')
    base.className = 'ma-laptop-base'
    base.style.top = px(dims.height)
    base.style.height = px(LAPTOP_BASE_DEPTH)
    base.appendChild(baseShell)
    base.appendChild(baseBody)

    deviceEl.appendChild(base)
    deviceEl.appendChild(lidEl)

    // Both rigid parts explode independently along their own layer stack
    // (base: shell/body; lid: shell/body/screen/glass), each keeping the
    // shared device.layers depth/index — see layerElsFor().
    layerEls = [
      ...layerElsFor({ shell: baseShell, body: baseBody }, device),
      ...layerElsFor(byId, device),
    ]
  } else {
    deviceEl.appendChild(byId.shell)
    deviceEl.appendChild(byId.body)
    deviceEl.appendChild(byId.screen)
    deviceEl.appendChild(byId.glass)

    layerEls = layerElsFor(byId, device)
  }

  return { deviceEl, layerEls, lidEl }
}

function applyPose({ deviceEl, layerEls, lidEl }, pose) {
  deviceEl.style.transform = poseTransform(pose)
  for (const { el, depth, index } of layerEls) {
    el.style.transform = layerTransform(depth, index, pose.explode)
  }
  if (lidEl) {
    // lidAngle 0 = closed (lid folds forward onto the base), 90 = vertical
    // (upright, facing the viewer dead-on), 130 = max recline. .ma-lid's
    // transform-origin is bottom center (the hinge), so this is the lid's
    // tilt *relative to vertical*: 0 at 90deg.
    //
    // Sign: CSS's Y axis points *down*, so the lid's top edge sits at a
    // negative local Y and a positive rotateX carries it to negative Z —
    // i.e. AWAY from the viewer. lidAngle 110 therefore needs rotateX(+20),
    // the spec's "~20deg back tilt", and lidAngle 0 needs rotateX(-90),
    // laying the lid forward over the base with its screen face down
    // (closed). This is the exact negation of the WebGL renderer's
    // lidRotationX() (THREE is Y-up), the same flip poseToEuler() applies
    // to rotateX/rotateZ — see src/render/webgl/glRenderer.js.
    lidEl.style.transform = `rotateX(${pose.lidAngle - 90}deg)`
  }
}

// Paints scene.style.background on the renderer's own root element (the
// containerEl passed into createCssRenderer — .ma-stage in the editor,
// #ma-root in an exported file) per the spec's Renderer 1 section
// ("background: transparent | css color"). "transparent" clears any
// previously painted color rather than setting the literal CSS keyword, so
// the container falls back to whatever it would otherwise be (e.g. the
// editor's dot-grid stage behind it).
function applyBackground(containerEl, background) {
  containerEl.style.backgroundColor = background === 'transparent' ? '' : background
}

/**
 * @param {HTMLElement} containerEl
 * @returns {{render(scene): Promise<void>, setPose(pose): void, destroy(): void}}
 */
export function createCssRenderer(containerEl) {
  let current = null

  function render(scene) {
    containerEl.innerHTML = ''
    applyBackground(containerEl, scene.style.background)
    const device = DEVICES[scene.device]
    const dims = deviceDims(device, scene.orientation)
    current = buildDeviceDom(scene, dims)
    if (scene.style.shadow) {
      // See device.css .ma-shadow-wrap: the drop-shadow filter must live on
      // an ancestor OUTSIDE .ma-device's own 3D transform, or it forces an
      // early flattening of the device's 3D subtree that breaks compound
      // rotations (e.g. a body wall rotated in Y under the device's own
      // rotateY pose collapses to zero width).
      const shadowWrap = document.createElement('div')
      shadowWrap.className = 'ma-shadow-wrap'
      shadowWrap.appendChild(current.deviceEl)
      containerEl.appendChild(shadowWrap)
    } else {
      containerEl.appendChild(current.deviceEl)
    }
    applyPose(current, scene.pose)
    // Kept a Promise<void> to match createGlRenderer's render() surface (see
    // its readiness-signal doc comment) — the CSS renderer has no async
    // texture load to wait on (an <img> paints whenever the browser gets to
    // it, unobserved either way), so this just resolves immediately.
    return Promise.resolve()
  }

  function setPose(pose) {
    if (!current) return
    applyPose(current, pose)
  }

  function destroy() {
    containerEl.innerHTML = ''
    // Undo applyBackground so a leftover color doesn't bleed through if a
    // different renderer (e.g. glRenderer, which owns its own background
    // via clear color) takes over this same containerEl next.
    containerEl.style.backgroundColor = ''
    current = null
  }

  return { render, setPose, destroy }
}
