// Animation presets + the runAnimation wiring helper. Presets are pure
// functions from progress (or pointer/scroll input) to a partial pose;
// runAnimation drives them with a Timeline (or a pointermove/scroll
// listener) and hands a full merged pose to the caller's applyPose on every
// update. Must not import React — this module also runs inside exported
// standalone HTML files (see docs/superpowers/specs/2026-09-01-mockupanimate-design.md,
// "Animation engine").

import { Timeline } from './timeline.js'

const HOVER_TILT_MAX_DEG = 15
const FLOAT_TRANSLATE_AMPLITUDE = 10 // px
const FLOAT_ROTATE_AMPLITUDE = 5 // deg

// a*(1-t) + b*t rather than a + (b-a)*t so that lerp(a, b, 1) is exactly b
// (not b +/- float error) — exploded-reveal relies on that exactness.
function lerp(a, b, t) {
  return a * (1 - t) + b * t
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

// hover-tilt's tick accepts either a plain 0..1 number (both axes driven
// equally — this is what makes it satisfy the same tick(0)/(0.5)/(1)
// contract every other preset does) or a {x, y} pointer offset in -1..1
// (what runAnimation's real pointermove wiring passes, for independent
// axis control).
function normalizePointerInput(t) {
  if (t !== null && typeof t === 'object') {
    return { x: t.x, y: t.y }
  }
  const offset = t * 2 - 1
  return { x: offset, y: offset }
}

/** @type {Record<string, {mode: 'timeline'|'pointer'|'scroll', tick: (t: any, scene: object) => object}>} */
export const PRESETS = {
  none: {
    mode: 'timeline',
    tick() {
      return {}
    },
  },

  'rotate-in': {
    mode: 'timeline',
    tick(t, scene) {
      return { rotateY: lerp(-90, scene.pose.rotateY, t) }
    },
  },

  orbit: {
    mode: 'timeline',
    tick(t, scene) {
      return { rotateY: scene.pose.rotateY + t * 360 }
    },
  },

  float: {
    mode: 'timeline',
    tick(t, scene) {
      const wave = Math.sin(t * Math.PI * 2)
      return {
        translateY: scene.pose.translateY + wave * FLOAT_TRANSLATE_AMPLITUDE,
        rotateX: scene.pose.rotateX + wave * FLOAT_ROTATE_AMPLITUDE,
      }
    },
  },

  'exploded-reveal': {
    mode: 'timeline',
    tick(t, scene) {
      return { explode: lerp(1, scene.pose.explode, t) }
    },
  },

  'hover-tilt': {
    mode: 'pointer',
    tick(t) {
      const { x, y } = normalizePointerInput(t)
      return {
        rotateY: clamp(x * HOVER_TILT_MAX_DEG, -HOVER_TILT_MAX_DEG, HOVER_TILT_MAX_DEG),
        rotateX: clamp(-y * HOVER_TILT_MAX_DEG, -HOVER_TILT_MAX_DEG, HOVER_TILT_MAX_DEG),
      }
    },
  },

  'scroll-rotate': {
    mode: 'scroll',
    tick(t) {
      return { rotateY: lerp(-45, 45, t) }
    },
  },
}

function mergePose(scene, partialPose) {
  return { ...scene.pose, ...partialPose }
}

/**
 * scroll-rotate's progress, per the spec: "maps scroll progress of the
 * embed's container". Measured from the container's own position in the
 * viewport rather than the host document's scrollY — the editor's document
 * never scrolls, and an exported embed may be one element on someone else's
 * page (or inside a scrollable ancestor), so document scroll is meaningless
 * in both cases.
 *
 * 0 when the container's top edge is level with the bottom of the viewport
 * (just about to enter), 1 when its bottom edge has passed the top (just
 * left). Pure — unit-tested directly.
 *
 * @param {{top: number, height: number}} rect - the container's viewport rect
 * @param {number} viewportHeight
 * @returns {number} 0..1
 */
export function scrollProgress(rect, viewportHeight) {
  const span = viewportHeight + rect.height
  if (!(span > 0)) return 0
  return clamp((viewportHeight - rect.top) / span, 0, 1)
}

function noop() {}

/**
 * Wires the scene's chosen preset to a live pose update loop and returns a
 * handle to stop it. Used identically by the editor's Preview and by the
 * exported standalone HTML's runtime.
 *
 * @param {object} scene
 * @param {(pose: object) => void} applyPose - called with a full pose object
 * @param {HTMLElement} [containerEl] - the element the device is rendered
 *   into. Only the 'scroll' mode needs it (to measure its own position);
 *   omitting it is supported so existing callers keep working.
 * @returns {{stop(): void, play(): void, pause(): void, seek(t: number): void}}
 */
export function runAnimation(scene, applyPose, containerEl = null) {
  const preset = PRESETS[scene.animation.preset] || PRESETS.none

  if (preset.mode === 'timeline') {
    const timeline = new Timeline({
      duration: scene.animation.duration,
      easing: scene.animation.easing,
      loop: scene.animation.loop,
      onTick: (t) => applyPose(mergePose(scene, preset.tick(t, scene))),
    })
    if (scene.animation.autoplay) timeline.play()

    return {
      stop: () => timeline.destroy(),
      play: () => timeline.play(),
      pause: () => timeline.pause(),
      seek: (t) => timeline.seek(t),
    }
  }

  if (preset.mode === 'pointer') {
    const handlePointerMove = (event) => {
      const x = (event.clientX / window.innerWidth) * 2 - 1
      const y = (event.clientY / window.innerHeight) * 2 - 1
      applyPose(mergePose(scene, preset.tick({ x, y }, scene)))
    }
    window.addEventListener('pointermove', handlePointerMove)

    return {
      stop: () => window.removeEventListener('pointermove', handlePointerMove),
      play: noop,
      pause: noop,
      seek: noop,
    }
  }

  // mode === 'scroll'
  const handleScroll = () => {
    const rect = containerEl?.getBoundingClientRect?.()
    const progress = rect ? scrollProgress(rect, window.innerHeight) : 0
    applyPose(mergePose(scene, preset.tick(progress, scene)))
  }
  // Capture phase: scroll events don't bubble, but they *do* propagate down
  // the capture path, so one listener on window catches scrolling of the
  // document and of any scrollable ancestor the embed happens to sit in.
  window.addEventListener('scroll', handleScroll, true)
  window.addEventListener('resize', handleScroll)
  handleScroll()

  return {
    stop: () => {
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleScroll)
    },
    play: noop,
    pause: noop,
    seek: noop,
  }
}
