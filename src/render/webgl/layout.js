// Pure device-layout math for the WebGL renderer — deliberately THREE-free.
//
// This is the geometry half of src/render/webgl/glRenderer.js (which owns the
// rest and re-exports everything here, so existing importers are unaffected).
// It lives in its own module for one reason: bin/showcase.mjs, a plain Node
// CLI, needs the GL screen rect to derive the output frame's aspect, and must
// not pull `three` (and its addons/DOM assumptions) into the CLI process.
// Nothing below may import THREE — keep new code here to plain arithmetic
// over src/core/devices.js specs.

import { DEVICES, deviceDims } from '../../core/devices.js'

// DEVICES' bezel values render correctly in the CSS renderer's flat 2D
// layout, but next to the thicker GL body they read as an oversized dark
// ring — the reference hardware's bezel is thin and uniform. Scales each
// side's bezel down for GL screen geometry only (phone/tablet;
// laptop/browser are unaffected — the browser's bezel is its chrome bar,
// not a cosmetic margin, and laptop is out of scope here).
const GL_BEZEL_SCALE = { phone: 0.45, tablet: 0.6 }

/** @returns the GL-only bezel scale factor for `deviceName` (1 = untouched, i.e. the DEVICES value as-is). */
export function glBezelScale(deviceName) {
  return GL_BEZEL_SCALE[deviceName] ?? 1
}

/**
 * Pure geometry-spec mapping from a device + orientation to the body/screen
 * dimensions the WebGL renderer builds from. No WebGL context involved —
 * safe to unit-test directly.
 *
 * @param {typeof import('../../core/devices.js').DEVICES[keyof typeof import('../../core/devices.js').DEVICES]} device
 * @param {'portrait'|'landscape'} orientation
 */
export function glLayout(device, orientation) {
  const dims = deviceDims(device, orientation)
  const { bezel, cornerRadius, screenRadius } = device
  // GL-only bezel tightening (see glBezelScale's doc comment) — DEVICES'
  // own bezel values are read as-is by the CSS renderer; only this
  // function's derived screen rect is scaled down.
  const scale = glBezelScale(device.name)
  const inset = {
    left: bezel.left * scale,
    right: bezel.right * scale,
    top: bezel.top * scale,
    bottom: bezel.bottom * scale,
  }
  return {
    width: dims.width,
    height: dims.height,
    body: {
      width: dims.width,
      height: dims.height,
      radius: cornerRadius,
    },
    screen: {
      width: dims.width - inset.left - inset.right,
      height: dims.height - inset.top - inset.bottom,
      radius: screenRadius,
      // Center offset from the body's own center, in the same unit space.
      // Zero when the opposing bezels are equal; shifts toward the thinner
      // bezel otherwise (e.g. laptop's bigger top bezel for the camera).
      offsetX: (inset.left - inset.right) / 2,
      offsetY: (inset.bottom - inset.top) / 2,
    },
  }
}

/**
 * Aspect ratio (width / height) of the GL screen rect for a device +
 * orientation — glLayout's own screen dims, i.e. bezel-tightened.
 *
 * This is the number the showcase's output frame is shaped by (see
 * bin/showcase.mjs's outputDimensions): with the frame aspect equal to the
 * screen aspect, a camera at the `bleed` bound covers the frame exactly on
 * both axes at once, so the "zoomed all the way in" beat shows the WHOLE
 * screen rather than a cropped middle of it.
 *
 * Laptop caveat: the laptop's screen actually lives on the hinged lid, whose
 * rect (screenPlaneLayout in glRenderer.js) is shorter than glLayout's by the
 * base height — and it is foreshortened by the 110deg lid angle anyway, so an
 * exact full-screen fill is not reachable for that device at any frame aspect.
 * glLayout's rect is the right approximation here: it is the same rect the
 * content is cover-fit into (src/showcase/runtime.js), so the frame matches
 * the *content's* aspect for every device.
 *
 * @param {object|string} device - a DEVICES spec or its name (bin/showcase.mjs
 *   passes the name straight off the CLI flag)
 * @param {'portrait'|'landscape'} orientation
 * @returns {number}
 */
export function screenAspect(device, orientation) {
  const spec = typeof device === 'string' ? DEVICES[device] : device
  if (!spec) throw new Error(`screenAspect: unknown device "${device}"`)
  const { screen } = glLayout(spec, orientation)
  return screen.width / screen.height
}
