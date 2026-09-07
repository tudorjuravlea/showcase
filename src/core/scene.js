// Scene spec model — the single source of truth consumed by both renderers
// and the exporter. See docs/superpowers/specs/2026-09-01-mockupanimate-design.md
// ("Scene spec (JSON)") for the authoritative field list.

import { DEVICES } from './devices.js'

/** @returns a fresh default scene object matching the spec JSON shape. */
export function defaultScene() {
  return {
    version: 1,
    device: 'phone',
    orientation: 'portrait',
    content: {
      type: 'image',
      src: '',
    },
    pose: {
      rotateX: 0,
      rotateY: 0,
      rotateZ: 0,
      translateX: 0,
      translateY: 0,
      translateZ: 0,
      scale: 1,
      explode: 0,
      lidAngle: 110,
    },
    style: {
      shadow: true,
      glare: true,
      glow: false,
      background: 'transparent',
      // WebGL-only device frame finish (src/render/webgl/glRenderer.js's
      // FRAME_FINISHES) — the CSS renderer ignores it. The editor never
      // sets this explicitly, so it always gets the default gold finish.
      frame: 'gold',
    },
    animation: {
      preset: 'none',
      duration: 2000,
      easing: 'ease-out',
      loop: false,
      autoplay: true,
    },
    renderer: 'css',
  }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function deepMerge(target, patch) {
  const result = { ...target }
  for (const key of Object.keys(patch)) {
    const patchValue = patch[key]
    const targetValue = target[key]
    result[key] =
      isPlainObject(patchValue) && isPlainObject(targetValue)
        ? deepMerge(targetValue, patchValue)
        : patchValue
  }
  return result
}

/**
 * Deep-merges `patch` into `scene`, returning a new scene object. Neither
 * argument is mutated.
 */
export function mergeScene(scene, patch) {
  return deepMerge(scene, patch)
}

/**
 * WebGL has no live-URL (iframe) content (see
 * docs/superpowers/specs/2026-09-01-mockupanimate-design.md, "Renderer 2 —
 * WebGL") — url content must always render via the CSS renderer. The
 * browser device itself is WebGL-supported as of v2 (see
 * docs/superpowers/specs/2026-09-01-mockupanimate-v2-design.md §2) and no
 * longer forces css. Shared by App.jsx (updateScene) and Preview.jsx
 * (Photoreal toggle) so the two stay in sync.
 *
 * @param {ReturnType<typeof defaultScene>['content']} content
 */
export function requiresCssRenderer(content) {
  return content.type === 'url'
}

/**
 * @param {ReturnType<typeof defaultScene>} scene
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateScene(scene) {
  const errors = []

  if (!Object.keys(DEVICES).includes(scene.device)) {
    errors.push(`Unknown device: ${scene.device}`)
  }

  const explode = scene.pose?.explode
  if (typeof explode !== 'number' || explode < 0 || explode > 1) {
    errors.push(`pose.explode must be between 0 and 1, got ${explode}`)
  }

  return { ok: errors.length === 0, errors }
}
