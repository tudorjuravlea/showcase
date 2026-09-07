// Showcase runtime — mounted by showcase.html (a standalone vite entry, see
// vite.config.js). Exposes window.__showcase.init(cfg)/seek(t) per
// docs/superpowers/specs/2026-09-04-showcase-design.md §4:
//
// - Headless mode: bin/showcase.mjs (task 3) drives this via Playwright —
//   init(cfg) builds the scene once, seek(t) deterministically advances the
//   content video to t*duration (looped) and re-renders the GL frame, so a
//   frame-by-frame capture loop can screenshot the canvas after each await.
// - Live mode (cfg.live: true, used by the HTML export): plays the chosen
//   look once over cfg.duration, then idles — a slow float loop plus a
//   soft pointer-follow (rotateX/Y eased toward the pointer, spring-
//   smoothed, ±6deg).
//
// Must not import React — this file is bundled standalone (no App/editor
// code) and, for the HTML export, ends up inlined into a file with no
// build step of its own.

import {
  constrainCameraDistance,
  constrainCameraDistanceContained,
  createGlRenderer,
  distanceBounds,
  glLayout,
} from '../render/webgl/glRenderer.js'
import { DEVICES } from '../core/devices.js'
import { defaultScene, mergeScene } from '../core/scene.js'
import { lookFrame } from './looks.js'

const STAGE_ID = 'stage'
// Must match the ids bin/showcase.mjs's --html export writes into the
// exported page's static markup (the poster <img>) and that this runtime
// creates itself (the play-button overlay) — see runIntroThenIdle's
// autoplay-rejection handling and init()'s poster hand-off below.
const POSTER_ID = 'ma-hero-poster'
const PLAY_OVERLAY_ID = 'ma-hero-play'

// Idle (post-look) float + hover-follow tuning — same scale conventions as
// looks.js (see its own header comment).
const IDLE_FLOAT_PERIOD_S = 6
const IDLE_FLOAT_ROTATE_Y = 3
const IDLE_FLOAT_TRANSLATE_Y = 6
const HOVER_MAX_DEG = 6
const HOVER_SPRING = 0.06 // per-frame ease factor toward the pointer target

let renderer = null
let stageEl = null
let workCanvas = null
let workCtx = null
let mediaEl = null
let contentKind = 'image'
let contentDurationSec = 0
let cfgState = null
let rafHandle = null
// {device, orientation, viewportW, viewportH, pixelSizeMode} — the fixed half
// of every distanceBounds() call, captured from the built canvas in init().
let boundsSpec = null
// The cover-fit crop window (source pixel space) drawMediaFrame() reads the
// source frame through — see coverCropBox()'s doc comment. Reset on every
// init() (also cleared by teardown() so a stale box can't survive a
// destroyed renderer, even though nothing would read it until the next
// init() sets a fresh one).
let cropBox = { x: 0, y: 0, width: 0, height: 0 }
const hoverState = { x: 0, y: 0 }
const hoverTarget = { x: 0, y: 0 }
let pointerListenersAttached = false
// Hysteresis memory for constrainCameraDistance()'s two-state snap — the
// distance it returned last frame, so a request parked near the fit/bleed
// midpoint doesn't flip sides on every tiny wobble of the bounds themselves
// (see that function's `lastDistance` param). Reset per session in
// teardown() (called at the top of every init()), since a fresh look/render
// session has no prior side to remember. Contained mode never touches this —
// there's no two-state choice to have a side.
let lastFramingDistance = null

function teardown() {
  if (rafHandle !== null) {
    cancelAnimationFrame(rafHandle)
    rafHandle = null
  }
  document.getElementById(PLAY_OVERLAY_ID)?.remove()
  if (mediaEl && contentKind === 'video') {
    mediaEl.pause()
    mediaEl.removeAttribute('src')
    mediaEl.load()
  }
  mediaEl = null
  renderer?.destroy()
  renderer = null
  workCanvas = null
  workCtx = null
  contentDurationSec = 0
  cropBox = { x: 0, y: 0, width: 0, height: 0 }
  boundsSpec = null
  lastFramingDistance = null
}

function waitForVideoMetadata(video) {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 1) {
      resolve()
      return
    }
    video.addEventListener('loadedmetadata', () => resolve(), { once: true })
    video.addEventListener('error', () => reject(new Error('showcase: failed to load video content')), {
      once: true,
    })
  })
}

function waitForImageLoad(img) {
  return new Promise((resolve, reject) => {
    if (img.complete && img.naturalWidth > 0) {
      resolve()
      return
    }
    img.addEventListener('load', () => resolve(), { once: true })
    img.addEventListener('error', () => reject(new Error('showcase: failed to load image content')), { once: true })
  })
}

// Resolves once the video's 'seeked' event fires for `time` — the
// deterministic per-frame contract the spec calls for (rVFC is unneeded
// here: a plain seek + 'seeked' is enough to guarantee the decoded frame is
// current before drawImage()). Falls back after a short timeout so a
// browser that doesn't fire 'seeked' for a no-op seek (new time ~= current
// time) can't hang the whole capture loop.
function seekVideoTo(video, time) {
  const duration = video.duration || 0
  const clamped = Math.min(Math.max(time, 0), Math.max(duration - 0.001, 0))
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      video.removeEventListener('seeked', onSeeked)
      resolve()
    }
    const onSeeked = () => finish()
    video.addEventListener('seeked', onSeeked)
    video.currentTime = clamped
    setTimeout(finish, 500)
  })
}

/**
 * Center-crop box (in source pixel space) matching `targetAspect` exactly,
 * sized as large as the source allows without upscaling — the "cover, crop
 * overflow, center" fit the showcase content needs so it reaches the
 * rounded screen mask borderlessly instead of stretching or letterboxing.
 * Pure math (no canvas/DOM), safe to unit-test directly.
 *
 * @param {number} sourceWidth
 * @param {number} sourceHeight
 * @param {number} targetAspect - width/height
 * @returns {{x: number, y: number, width: number, height: number}}
 */
export function coverCropBox(sourceWidth, sourceHeight, targetAspect) {
  const sourceAspect = sourceWidth / sourceHeight
  const width = sourceAspect > targetAspect ? Math.round(sourceHeight * targetAspect) : sourceWidth
  const height = sourceAspect > targetAspect ? sourceHeight : Math.round(sourceWidth / targetAspect)
  return { x: Math.round((sourceWidth - width) / 2), y: Math.round((sourceHeight - height) / 2), width, height }
}

function drawMediaFrame() {
  if (!workCtx || !mediaEl) return
  // cropBox is sized to exactly match workCanvas (see init()) — this is a
  // plain center-crop copy, no scaling, so there's no interpolation blur.
  workCtx.drawImage(mediaEl, cropBox.x, cropBox.y, cropBox.width, cropBox.height, 0, 0, workCanvas.width, workCanvas.height)
}

// Draws the content frame for headless progress `t` (0..1 across
// cfg.duration) onto the work canvas. Video content time is
// t*cfg.duration seconds along the OUTPUT timeline, wrapped (looped) into
// the content's own duration — so a short fixture clip loops to fill a
// longer requested showcase duration, and is a no-op wrap when the output
// is shorter than the content.
async function drawContentFrameAt(t) {
  if (contentKind === 'video') {
    const rawSeconds = t * cfgState.duration
    const videoTime = contentDurationSec > 0 ? rawSeconds % contentDurationSec : 0
    await seekVideoTo(mediaEl, videoTime)
  }
  drawMediaFrame()
}

function currentCtx() {
  return { duration: cfgState.duration, activity: cfgState.activity || [] }
}

// cfg.contained (--contained, for slide/column embeds) swaps the two-state
// snap for a simple floor — see constrainCameraDistanceContained's doc
// comment: the device stays fully visible for the entire video, so there is
// no full-bleed state to snap toward. contained mode never reads/writes
// lastFramingDistance — there's no side to remember.
function constrainForMode(camera, bounds) {
  if (cfgState.contained) return constrainCameraDistanceContained(camera, bounds)
  const constrained = constrainCameraDistance(camera, bounds, lastFramingDistance)
  lastFramingDistance = constrained.distance ?? camera.distance ?? 1
  return constrained
}

// The lateral-fit rule (see glRenderer's distanceBounds) lives here, in the
// driver, rather than inside lookFrame(): looks stay pure functions of t that
// their unit tests can pin, while EVERY look — plus auto-action's
// activity-derived zooms, plus live mode's hover-perturbed idle pose — passes
// through the one constraint on its way to the renderer.
function framedCamera(pose, camera) {
  return constrainForMode(camera, distanceBounds({ ...boundsSpec, pose }))
}

// Two passes: the bounds depend on the pose, and a look's symbolic distances
// ('fit'/'bleed') depend on the bounds. Pass 1 gets the pose (which no look
// derives from its own distance, beyond the reference look's distance-scaled
// micro-float — a sub-degree difference), pass 2 resolves the camera against
// the bounds that pose implies. Both calls are pure and cost a few flops.
function resolveFrame(t) {
  const ctx = currentCtx()
  const probe = lookFrame(cfgState.look, t, ctx)
  const bounds = distanceBounds({ ...boundsSpec, pose: probe.pose })
  const { pose, camera, screen } = lookFrame(cfgState.look, t, { ...ctx, bounds })
  return { pose, camera: constrainForMode(camera, bounds), screen }
}

// A look that drives no screen state leaves the corners as authored (see
// setScreenCorners); only the reference look's ending squares them off, and
// only because the screen fills the frame there. In --contained mode it never
// does — the whole device stays in shot — so a squared-off screen would just
// read as a rounded phone with a square display. Keep the corners.
function screenCornerScale(screen) {
  if (cfgState.contained) return 1
  return screen?.cornerScale ?? 1
}

function applyFrame(t) {
  const { pose, camera, screen } = resolveFrame(t)
  renderer.setPose(pose)
  renderer.setCamera(camera)
  renderer.setScreenCorners(screenCornerScale(screen))
  renderer.updateScreen()
}

function attachPointerFollow() {
  if (pointerListenersAttached) return
  pointerListenersAttached = true

  const onMove = (event) => {
    if (event.pointerType === 'touch') return // touch: float only, per spec
    hoverTarget.x = (event.clientX / window.innerWidth) * 2 - 1
    hoverTarget.y = (event.clientY / window.innerHeight) * 2 - 1
  }
  const onLeave = () => {
    hoverTarget.x = 0
    hoverTarget.y = 0
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerleave', onLeave)
}

// A sandboxed embed (e.g. a scripts-allowed-but-autoplay-blocked chat
// preview panel) can reject the live-mode play() call below — per the
// browser's autoplay policy, not a real error. Left unhandled, the video
// never advances past its initial (possibly undecoded, i.e. black) frame:
// this makes the fallback visible instead. Seeks to 0 (forcing a decode,
// since the frame drawn synchronously in init() may predate any decoded
// data), draws it, pushes it to the GL texture, then hands off straight to
// the idle float/hover loop (there's no point animating the intro's camera
// move over a frozen video) and shows a play-button overlay whose first
// click/tap — or any other pointer gesture on the stage — retries play().
function handleAutoplayBlocked() {
  if (rafHandle !== null) {
    cancelAnimationFrame(rafHandle)
    rafHandle = null
  }
  seekVideoTo(mediaEl, 0).then(() => {
    drawMediaFrame()
    renderer.updateScreen()
    enterIdle()
    showAutoplayOverlay()
  })
}

function showAutoplayOverlay() {
  if (document.getElementById(PLAY_OVERLAY_ID)) return
  const overlay = document.createElement('div')
  overlay.id = PLAY_OVERLAY_ID
  overlay.setAttribute('role', 'button')
  overlay.setAttribute('aria-label', 'Play video')
  overlay.textContent = '▶'
  Object.assign(overlay.style, {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: '64px',
    height: '64px',
    borderRadius: '50%',
    background: 'rgba(0, 0, 0, 0.45)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '22px',
    lineHeight: '1',
    cursor: 'pointer',
    zIndex: '10',
    userSelect: 'none',
  })

  const retry = () => {
    mediaEl.play().then(() => {
      overlay.remove()
      stageEl.removeEventListener('pointerdown', retry)
    }).catch(() => {})
  }
  overlay.addEventListener('click', retry)
  stageEl.addEventListener('pointerdown', retry)
  document.body.appendChild(overlay)
}

function runIntroThenIdle() {
  const durationMs = Math.max(0, cfgState.duration * 1000)
  const startTime = performance.now()

  if (contentKind === 'video') {
    mediaEl.loop = true
    mediaEl.play().catch(() => handleAutoplayBlocked())
  }

  function introFrame(now) {
    const elapsed = now - startTime
    if (elapsed >= durationMs) {
      enterIdle()
      return
    }
    drawMediaFrame()
    applyFrame(durationMs > 0 ? elapsed / durationMs : 1)
    rafHandle = requestAnimationFrame(introFrame)
  }

  rafHandle = requestAnimationFrame(introFrame)
}

function enterIdle() {
  const restFrame = resolveFrame(1)
  const idleStart = performance.now()

  function idleFrame(now) {
    const elapsedS = (now - idleStart) / 1000
    const floatPhase = (elapsedS / IDLE_FLOAT_PERIOD_S) * Math.PI * 2
    const floatRotateY = Math.sin(floatPhase) * IDLE_FLOAT_ROTATE_Y
    const floatTranslateY = Math.sin(floatPhase * 0.8 + 1) * IDLE_FLOAT_TRANSLATE_Y

    hoverState.x += (hoverTarget.x - hoverState.x) * HOVER_SPRING
    hoverState.y += (hoverTarget.y - hoverState.y) * HOVER_SPRING

    const pose = {
      ...restFrame.pose,
      rotateY: restFrame.pose.rotateY + floatRotateY + hoverState.x * HOVER_MAX_DEG,
      rotateX: restFrame.pose.rotateX + hoverState.y * HOVER_MAX_DEG,
      translateY: restFrame.pose.translateY + floatTranslateY,
    }

    drawMediaFrame()
    renderer.setPose(pose)
    // Re-constrained against the *hovered* pose: a hover tilt at the
    // full-bleed ending would otherwise swing a device edge into frame.
    renderer.setCamera(framedCamera(pose, restFrame.camera))
    // The idle rests ON the look's last frame, so it keeps that frame's
    // corner state too (no-op after the first call — see setScreenCorners).
    renderer.setScreenCorners(screenCornerScale(restFrame.screen))
    renderer.updateScreen()
    rafHandle = requestAnimationFrame(idleFrame)
  }

  rafHandle = requestAnimationFrame(idleFrame)
}

/**
 * @param {object} cfg
 * @param {keyof import('../core/devices.js').DEVICES} cfg.device
 * @param {'portrait'|'landscape'} [cfg.orientation]
 * @param {string} cfg.look - a src/showcase/looks.js LOOKS key
 * @param {{kind: 'video'|'image', url: string}} cfg.content
 * @param {number} cfg.duration - seconds
 * @param {number} cfg.width
 * @param {number} cfg.height
 * @param {string} [cfg.frame] - a src/render/webgl/glRenderer.js FRAME_FINISHES key
 * @param {boolean} [cfg.live] - live (idle float + hover-follow) mode
 * @param {boolean} [cfg.contained] - keep the whole device in frame the
 *   entire time (no full-bleed state) — for slide/column embeds
 * @param {{t0: number, t1: number, u: number, v: number, zoom?: number}[]} [cfg.activity]
 * @returns {Promise<void>} resolves once the renderer is ready and the
 *   first frame is drawn
 */
async function init(cfg) {
  teardown()
  cfgState = cfg

  stageEl = document.getElementById(STAGE_ID)
  stageEl.innerHTML = ''

  // pixelSize + pixelSizeMode 'exact' (see glRenderer's resolvePixelSize)
  // sizes the canvas's drawing buffer to EXACTLY cfg.width x cfg.height at a
  // pixel ratio of 1. Exact, not the default aspect-fit: the showcase frame is
  // derived from the device SCREEN's aspect (e.g. 1080x2352 for a phone —
  // bin/showcase.mjs's outputDimensions), while aspect-fit sizes the buffer to
  // the device BODY's layout (300x650) instead. Under the older 16:9 frame
  // that fit rendered an 886-wide buffer bin/showcase.mjs had to pad with
  // background — two permanent pillars in the output, and a camera whose
  // 'fit'/'bleed' bounds only ever meant that 886-wide sub-rect. Rendering at
  // the true frame size is what lets the full-bleed ending actually reach the
  // output's own left/right edges. glRenderer
  // deliberately leaves the canvas's CSS box unset for the pixelSize path
  // (it's normally an offscreen, never-displayed capture target) — reapplied
  // below so the canvas is also correctly sized on screen, for live mode and
  // for the dev-preview screenshots this page is used for.
  renderer = createGlRenderer(stageEl, {
    pixelSize: { width: cfg.width, height: cfg.height },
    pixelSizeMode: 'exact',
  })
  const orientation = cfg.orientation || 'portrait'
  const scene = mergeScene(defaultScene(), {
    device: cfg.device,
    orientation,
    content: { type: 'none', src: '' },
    // glare: false — the glare layer is a flat white veil over the whole
    // screen (MeshPhysicalMaterial at 0.18 opacity, lit by the showcase key
    // light), and the showcase's whole job is to show the recording as it
    // really looks. Measured on a known-colour test card through the full
    // pipeline: with the veil, black 0 came out 45 and 200 grey came out 219
    // — a ~17% black lift, clipped whites and visibly desaturated colour.
    // The bezel/band still catches the same environment reflections, so the
    // device keeps its gloss; only the screen is left alone.
    style: { scene: 'showcase', shadow: true, glare: false, glow: false, background: cfg.background || 'transparent', frame: cfg.frame },
  })

  // The screen mesh's own aspect ratio (post GL-only bezel tightening — see
  // glLayout/glBezelScale) — the target every content frame is cover-fit
  // into below, so it reaches the rounded screen mask borderlessly instead
  // of stretching (a plain texture-to-plane map) or letterboxing.
  const screenLayout = glLayout(DEVICES[cfg.device], orientation).screen
  const targetAspect = screenLayout.width / screenLayout.height

  contentKind = cfg.content.kind
  workCanvas = document.createElement('canvas')

  if (contentKind === 'video') {
    mediaEl = document.createElement('video')
    mediaEl.muted = true
    mediaEl.preload = 'auto'
    mediaEl.playsInline = true
    mediaEl.src = cfg.content.url
    await waitForVideoMetadata(mediaEl)
    contentDurationSec = mediaEl.duration || 0
    cropBox = coverCropBox(mediaEl.videoWidth || cfg.width, mediaEl.videoHeight || cfg.height, targetAspect)
  } else {
    mediaEl = new Image()
    mediaEl.src = cfg.content.url
    await waitForImageLoad(mediaEl)
    contentDurationSec = 0
    cropBox = coverCropBox(mediaEl.naturalWidth || cfg.width, mediaEl.naturalHeight || cfg.height, targetAspect)
  }
  workCanvas.width = cropBox.width
  workCanvas.height = cropBox.height
  workCtx = workCanvas.getContext('2d')

  await renderer.render(scene)
  renderer.setScreenSource(workCanvas)

  // The drawing buffer stays at the authored resolution, but the on-page box
  // must be free to scale down to the embedding viewport (the exported page
  // constrains it with max-width/max-height). Never pin inline pixel
  // width/height here: max-* clamps EACH axis independently against inline
  // sizes, which visibly stretches the device in small/wide windows. An
  // explicit aspect-ratio (from the buffer dims) plus auto sizing keeps any
  // max-constrained fit proportional; with no page constraints (dev preview)
  // the canvas still renders at its attribute size.
  const canvasEl = stageEl.querySelector('canvas')
  if (canvasEl) {
    canvasEl.style.aspectRatio = `${canvasEl.width} / ${canvasEl.height}`
    canvasEl.style.width = ''
    canvasEl.style.height = ''
  }

  // The framing bounds are a function of the drawing buffer actually being
  // rendered, so they're read off the built canvas — which in 'exact' mode is
  // the output frame itself (the CLI's ffmpeg `pad` is a no-op at these dims).
  // pixelSizeMode must match what the renderer was built with, or kx and the
  // real frame aspect disagree — see distanceBounds' own doc comment.
  boundsSpec = {
    device: DEVICES[cfg.device],
    orientation,
    viewportW: canvasEl?.width || cfg.width,
    viewportH: canvasEl?.height || cfg.height,
    pixelSizeMode: 'exact',
  }

  if (cfg.live) {
    attachPointerFollow()
    drawMediaFrame()
    applyFrame(0)
    // The exported --html page's static poster <img> (see bin/showcase.mjs's
    // runHtmlExport) is visible by default so a scripts-disabled sandbox
    // still shows it; now that a real frame has been drawn to the canvas
    // above, hide it (a no-op when there's no poster, e.g. the dev-preview
    // page this runtime also serves).
    const poster = document.getElementById(POSTER_ID)
    if (poster) poster.hidden = true
    runIntroThenIdle()
    return
  }

  await drawContentFrameAt(0)
  applyFrame(0)
}

/**
 * Headless-mode only (a no-op once live mode's own intro/idle loop is
 * driving the renderer) — advances the content video to t*duration
 * (looped) and re-renders. Resolves once the content frame is on the
 * screen texture and the GL frame is rendered.
 *
 * @param {number} t - 0..1 progress across cfg.duration
 * @returns {Promise<void>}
 */
async function seek(t) {
  if (!renderer || !cfgState || cfgState.live) return
  await drawContentFrameAt(t)
  applyFrame(t)
}

window.__showcase = { init, seek }

export { init, seek }
