// WebGL renderer ("Photoreal"). Builds devices procedurally with Three.js
// from the same parametric device specs the CSS renderer uses — no
// downloaded models. Must not import React — this module also runs inside
// exported standalone HTML files (see
// docs/superpowers/specs/2026-09-01-mockupanimate-design.md, "Renderer 2 —
// WebGL").

import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { DEVICES } from '../../core/devices.js'
import { glBezelScale, glLayout, screenAspect } from './layout.js'
import { composeChromeTexture } from './chromeTexture.js'

// The pure, THREE-free device-layout math lives in ./layout.js so the Node
// CLI (bin/showcase.mjs) can use it without importing three. Re-exported here
// so every existing `from './glRenderer.js'` importer keeps working.
export { glBezelScale, glLayout, screenAspect }

// Device specs are authored in the CSS renderer's px-ish unit space (phone
// width = 300). UNIT converts that into Three.js scene units so the whole
// procedural build lives at a sane physical scale for PBR lighting.
const UNIT = 0.01
// Per the spec: explode moves each layer group along Z by explode * 0.6 *
// layerIndex. 0.6 is exactly the CSS renderer's EXPLODE_GAP (60px) * UNIT,
// so an explode of 1 separates layers by the same proportion in both
// renderers.
const EXPLODE_Z_STEP = 0.6
const BODY_THICKNESS = 0.06
const LAPTOP_BASE_HEIGHT = 24 // px-ish units; matches the CSS renderer's laptop base height
const CAMERA_FOV = 30
const MAX_PIXEL_RATIO = 2
const SHADOW_TEXTURE_SIZE = 256

// GL-only "reference-grade finish" pass — DEVICES (shared with the CSS
// renderer) is never touched by any of the constants below; these only
// reshape how the WebGL build interprets that same spec.

// Metal band finishes for the device body's visible side (band) faces —
// scene.style.frame. Gold (a warm copper/gold, matching the reference
// recording's hardware) is the default; the others are plain finish swaps
// on the same PBR material. Front/back cap faces are never touched by this
// — they keep the existing dark composite color (see bodyMaterial()).
export const FRAME_FINISHES = {
  gold: { color: 0xc78f5c, metalness: 0.95, roughness: 0.25 },
  silver: { color: 0xd7d9dc, metalness: 0.95, roughness: 0.2 },
  graphite: { color: 0x55565a, metalness: 0.9, roughness: 0.3 },
  black: { color: 0x232325, metalness: 0.9, roughness: 0.3 },
}
export const DEFAULT_FRAME_FINISH = 'gold'

/** @returns the FRAME_FINISHES entry for `name`, falling back to the default gold finish for an unknown/missing name. */
export function resolveFrameFinish(name) {
  return FRAME_FINISHES[name] || FRAME_FINISHES[DEFAULT_FRAME_FINISH]
}

// The body layer (the true 3D frame — see src/render/css/cssRenderer.js's
// buildBodyBox, whose wall faces this mirrors) reads as thin plastic at its
// shared-with-CSS thickness. The reference hardware's side band is much
// thicker relative to the device footprint — this multiplies the GL body's
// extrusion depth per device, uniformly for phone/tablet/browser (it's the only device the
// reference recording actually shows). Laptop is intentionally excluded
// (multiplier 1): out of scope for this pass, and its hinge math assumes
// the original geometry.
//
// 5.6 is a measured proportion, not a taste knob: a real phone's side band is
// ~11% of its width (iPhone 16 Pro, 8.25mm over 71.5mm), which is what makes a
// 20-30deg tilt show the 5-7%-of-width band the reference mockups do. The
// phone body is 300 px-ish units wide = 3.0 scene units, so 11% is 0.33, i.e.
// 0.054 * 5.6 = 0.302 plus the 0.053 the screen/glass planes float ahead of
// the body's front cap — 0.355 all told, 11.8% of the width. At the old 2.6
// (4.7% of width, less than half a real phone) the band read as paper.
const GL_BODY_THICKNESS_MULTIPLIER = { phone: 5.6, tablet: 5.6, browser: 5.6 }

/** @returns the GL-only body (frame) extrusion depth for `deviceName` — BODY_THICKNESS * 0.9, scaled by GL_BODY_THICKNESS_MULTIPLIER (1 if the device isn't listed). */
export function glBodyThickness(deviceName) {
  const multiplier = GL_BODY_THICKNESS_MULTIPLIER[deviceName] ?? 1
  return BODY_THICKNESS * 0.9 * multiplier
}

// Chamfer (bevel) depth at each end of the band, as a fraction of the band's
// own thickness — the narrow bright line where the flat side band meets the
// front glass and the back. It is what makes thickness READ: a sharp 90deg
// extrusion gives the band a single normal, so it lights as one flat tone,
// while a 45deg facet catches the environment at a different angle and draws
// a hard highlight along each edge.
//
// 0.1 keeps the flat band at 80% of the thickness (reference mockups show a
// wide flat band between two narrow chamfers, not a rounded pillow) and,
// just as importantly, keeps the chamfer's XY inset below the GL bezel
// margin: the front cap shrinks by exactly this much per side, and the screen
// plane floating in front of it is inset by bezel*glBezelScale (phone:
// 8 * 0.45 = 3.6 px-ish = 0.036 scene units). A chamfer wider than that would
// eat the dark bezel ring and leave the screen overhanging the cap edge —
// pinned by a unit test.
const GL_BAND_CHAMFER_FRACTION = 0.1

/** @returns the chamfer depth (scene units) at each end of `deviceName`'s band — 0 for a device whose body isn't thickened (laptop), which keeps its original sharp extrusion. */
export function glBandChamfer(deviceName) {
  if (!GL_BODY_THICKNESS_MULTIPLIER[deviceName]) return 0
  return glBodyThickness(deviceName) * GL_BAND_CHAMFER_FRACTION
}

// Side buttons (trait 3): two volume pills and a longer power button standing
// slightly proud of the band, in the upper half of the sides. Phone/tablet
// only — the browser device has no hardware, and laptop is out of scope.
//
// Placement is a fraction of the body's own height/thickness so it follows
// glLayout rather than hard-coded scene units. `side` is the X sign (+1 =
// right). Caveat: a landscape phone/tablet keeps its buttons on the left/right
// edges of the (now wide) body rather than moving them to the top edge — the
// showcase renders portrait, and modelling a physically rotated device would
// mean rotating the whole button rig for no visible gain.
const SIDE_BUTTON_DEVICES = new Set(['phone', 'tablet'])
const SIDE_BUTTONS = [
  { id: 'power', side: 1, centerY: 0.235, length: 0.115 },
  { id: 'volume-up', side: -1, centerY: 0.3, length: 0.07 },
  { id: 'volume-down', side: -1, centerY: 0.208, length: 0.07 },
]
// ...as fractions of the band: how far a button stands proud of the side
// face, and how much of the FLAT band (chamfers excluded) it covers — a
// button wider than the flat band would clip through the chamfer lines.
const SIDE_BUTTON_PROTRUSION_FRACTION = 0.16
const SIDE_BUTTON_DEPTH_FRACTION = 0.6

/**
 * Where the side buttons sit, in the body layer group's own local scene-unit
 * space (the same space buildFrameMesh's geometry lands in, so a spec's `z` is
 * directly comparable to `frontOffset`). Pure — unit-tested without a WebGL
 * context.
 *
 * @param {ReturnType<typeof glLayout>} layout
 * @param {string} deviceName
 * @param {{thickness: number, chamfer: number, frontOffset: number}} band
 * @returns {{id: string, side: number, x: number, y: number, z: number, length: number, depth: number, protrusion: number}[]}
 *   empty for a device without side buttons. `length` runs along Y, `depth`
 *   along Z (both centred on x/y/z), `protrusion` outward along X.
 */
export function sideButtonSpecs(layout, deviceName, { thickness, chamfer, frontOffset }) {
  if (!SIDE_BUTTON_DEVICES.has(deviceName)) return []
  const halfWidth = (layout.body.width * UNIT) / 2
  const height = layout.body.height * UNIT
  const flatDepth = thickness - chamfer * 2
  return SIDE_BUTTONS.map((button) => ({
    id: button.id,
    side: button.side,
    x: button.side * halfWidth,
    y: button.centerY * height,
    z: frontOffset - thickness / 2,
    length: button.length * height,
    depth: flatDepth * SIDE_BUTTON_DEPTH_FRACTION,
    protrusion: thickness * SIDE_BUTTON_PROTRUSION_FRACTION,
  }))
}

/**
 * ShapeGeometry's UV attribute is set directly from each vertex's
 * shape-space position (roughly [-width/2, width/2] x [-height/2, height/2]
 * for a shape centered on its own origin, e.g. roundedRectShape — not
 * PlaneGeometry's normalized 0..1) — applied as-is, a screen texture renders
 * squashed into one corner instead of filling the shape. This remaps every
 * UV into 0..1 over the shape's own `width` x `height` bounding box, u
 * growing right and v growing up (top = 1), matching PlaneGeometry's own
 * convention so swapping geometries doesn't flip or stretch existing
 * content. Pure geometry math — no WebGL context needed, safe to
 * unit-test directly (see tests/glrenderer.test.js).
 *
 * @param {THREE.BufferGeometry} geometry - mutated in place
 * @param {number} width
 * @param {number} height
 * @returns {THREE.BufferGeometry} the same geometry, for chaining
 */
export function remapShapeUVs(geometry, width, height) {
  const uv = geometry.attributes.uv
  for (let i = 0; i < uv.count; i += 1) {
    const x = uv.getX(i)
    const y = uv.getY(i)
    uv.setXY(i, x / width + 0.5, y / height + 0.5)
  }
  uv.needsUpdate = true
  return geometry
}

// A rounded-rect Shape in the XY plane, corners clamped to half the
// shorter side (the only geometrically valid clamp for a rounded rect) —
// unlike RoundedBoxGeometry, whose radius is also clamped to half the
// extrusion depth, which is what made phone/tablet corners render nearly
// square (see BODY_THICKNESS: 0.06 scene units, so a RoundedBoxGeometry
// corner could never exceed 0.03 regardless of the device spec's actual
// cornerRadius, e.g. phone's 0.4 scene-unit corner).
export function roundedRectShape(width, height, radius) {
  const w = width / 2
  const h = height / 2
  const r = Math.min(radius, w, h)
  const shape = new THREE.Shape()
  shape.moveTo(-w + r, -h)
  shape.lineTo(w - r, -h)
  shape.quadraticCurveTo(w, -h, w, -h + r)
  shape.lineTo(w, h - r)
  shape.quadraticCurveTo(w, h, w - r, h)
  shape.lineTo(-w + r, h)
  shape.quadraticCurveTo(-w, h, -w, h - r)
  shape.lineTo(-w, -h + r)
  shape.quadraticCurveTo(-w, -h, -w + r, -h)
  return shape
}

/**
 * The screen mesh's corner radius, in scene units: the authored radius scaled
 * by `scale` (1 = as authored, 0 = square — see setScreenCorners) and clamped
 * to what the rect can actually hold. Pure; the geometry helper below is the
 * only caller.
 *
 * @param {number} radius - the authored radius, already in scene units
 * @param {number} width
 * @param {number} height
 * @param {number} [scale] - 0..1
 * @returns {number}
 */
export function screenCornerRadius(radius, width, height, scale = 1) {
  const wanted = Math.max(0, radius) * Math.min(1, Math.max(0, scale))
  return Math.min(wanted, Math.abs(width) / 2, Math.abs(height) / 2)
}

/**
 * Rounded-rect screen geometry with UVs remapped to 0..1 (see remapShapeUVs),
 * so screen content is clipped to rounded corners matching the body's own
 * curvature instead of showing through a sharp-cornered PlaneGeometry. Falls
 * back to a plain PlaneGeometry at radius 0 — the browser device's authored
 * screenRadius, and also what `scale` 0 produces at the showcase ending, where
 * a ShapeGeometry would just be a slower rectangle.
 *
 * Not tracked as a disposable: the caller owns the returned geometry (the
 * per-build path tracks it; setScreenCorners disposes its own replacements).
 *
 * @param {number} width
 * @param {number} height
 * @param {number} radius - authored radius in scene units
 * @param {number} [scale] - 0..1 corner-radius multiplier
 * @returns {THREE.BufferGeometry}
 */
export function buildScreenGeometry(width, height, radius, scale = 1) {
  const r = screenCornerRadius(radius, width, height, scale)
  if (r <= 0) return new THREE.PlaneGeometry(width, height)
  const shape = roundedRectShape(width, height, r)
  return remapShapeUVs(new THREE.ShapeGeometry(shape, 12), width, height)
}

export class UnsupportedDeviceError extends Error {
  constructor(deviceName) {
    super(`WebGL renderer does not support device: ${deviceName}`)
    this.name = 'UnsupportedDeviceError'
    this.device = deviceName
  }
}

/**
 * Static Z (scene units) of layer `index` at explode=0, mirroring the CSS
 * renderer's per-layer translateZ depths exactly (shell 0, body 4, screen 8,
 * glass 12 px-ish — see src/core/devices.js LAYER_DEPTHS).
 *
 * This is what keeps the screen visible: shell/body are extruded slabs
 * centered on their own Z, so the body's *front face* sits at
 * depth + BODY_THICKNESS * 0.9 / 2 = 0.04 + 0.027 = 0.067 scene units, while
 * the screen plane sits at 0.08 — in front of it. A uniform small gap (the
 * old index * 0.02) put the screen at 0.04, i.e. *behind* the body's front
 * face, so at explode=0 the device rendered as a featureless slab.
 *
 * @param {typeof DEVICES[keyof typeof DEVICES]} device
 * @param {number} index - layer index, back -> front (0 = shell)
 */
export function layerBaseZ(device, index) {
  return device.layers[index].depth * UNIT
}

/**
 * Maps a scene pose's rotation degrees onto THREE Euler angles (radians).
 *
 * CSS 3D and THREE do not share a handedness: CSS's Y axis points *down* the
 * screen while THREE's points up, so a positive CSS rotateX/rotateZ is the
 * opposite visual rotation from a positive THREE rotation.x/.z —
 * CSS rotateX(+30deg) tips the top edge away from the viewer, THREE
 * rotation.x = +30deg tips it toward. rotateY is unaffected (both take
 * +Z toward +X), which is why only X and Z are negated here. Same reason
 * applyPose() negates translateY.
 *
 * Exported (and pure) so the sign convention is unit-testable without a
 * WebGL context — see tests/glrenderer.test.js.
 *
 * @param {{rotateX: number, rotateY: number, rotateZ: number}} pose
 * @returns {{x: number, y: number, z: number}} radians
 */
export function poseToEuler(pose) {
  return {
    x: THREE.MathUtils.degToRad(-pose.rotateX),
    y: THREE.MathUtils.degToRad(pose.rotateY),
    z: THREE.MathUtils.degToRad(-pose.rotateZ),
  }
}

/**
 * The laptop lid's hinge rotation in radians, the exact negation of the CSS
 * renderer's `rotateX(lidAngle - 90)` on .ma-lid (transform-origin: bottom
 * center) — see src/render/css/cssRenderer.js applyPose(). lidAngle 0 =
 * closed (lid folded forward onto the base), 90 = vertical (upright, facing
 * the viewer), 130 = max recline; 110 is the default, a ~20deg back tilt.
 *
 * The lid group's screen/glass children sit at a *positive* local Y (up,
 * per THREE's Y-up convention — see buildLaptopDevice()), the opposite of
 * the CSS renderer's Y-down layout. A point at local (0, +Y, 0) rotated by
 * THREE's rotation.x = theta lands at Z = Y*sin(theta), so tipping the
 * screen's top away from the camera (negative Z, the camera being on the +Z
 * side) as lidAngle grows past 90 needs a *negative* theta — the same sign
 * flip poseToEuler() applies to rotateX/rotateZ, for the same reason.
 *
 * @param {number} lidAngle - degrees, 0 = closed, 90 = vertical, 130 = max
 */
export function lidRotationX(lidAngle) {
  return THREE.MathUtils.degToRad(90 - lidAngle)
}

/**
 * World-space (scene-unit) rect of the rendered screen plane at a device's
 * default, untransformed pose — the anchor `cameraLayout()` aims UV targets
 * at. Mirrors the exact placement math buildFlatDevice()/buildLaptopDevice()
 * use so it's computable without a WebGL context.
 *
 * phone/tablet/browser: the screen sits flat on the device's own Z axis
 * (buildFlatDevice), so this is just glLayout's screen rect scaled by UNIT.
 *
 * laptop: the screen lives on the hinged lid (buildLaptopDevice). This
 * resolves its position at the device's own default lidAngle (device.lidAngle,
 * e.g. 110deg) — a caller driving a non-default lidAngle via setPose would
 * see the camera's UV targeting drift slightly out of true, which is an
 * acceptable first-order approximation for this rig (the showcase choreography
 * this feeds keeps the laptop lid at its default angle).
 *
 * @param {typeof DEVICES[keyof typeof DEVICES]} device
 * @param {'portrait'|'landscape'} orientation
 * @returns {{width: number, height: number, offsetX: number, offsetY: number, offsetZ: number}}
 */
export function screenPlaneLayout(device, orientation) {
  const layout = glLayout(device, orientation)

  if (device.name !== 'laptop') {
    return {
      width: layout.screen.width * UNIT,
      height: layout.screen.height * UNIT,
      offsetX: layout.screen.offsetX * UNIT,
      offsetY: layout.screen.offsetY * UNIT,
      offsetZ: 0,
    }
  }

  // Laptop: reproduce buildLaptopDevice()'s lid placement math exactly.
  const baseHeight = LAPTOP_BASE_HEIGHT
  const lidHeight = layout.height - baseHeight
  const lidWidth = layout.width - device.bezel.left - device.bezel.right
  const screenWidth = lidWidth
  const screenHeight = lidHeight - device.bezel.top - device.bezel.bottom
  const screenOffsetX = (device.bezel.left - device.bezel.right) / 2

  const hingeY = -(layout.height * UNIT) / 2 + baseHeight * UNIT
  const lidLocalCenterY = (lidHeight * UNIT) / 2
  const localY = ((device.bezel.bottom - device.bezel.top) / 2) * UNIT + lidLocalCenterY
  const theta = lidRotationX(device.lidAngle)
  // Rotate the lid-local point (0, localY, 0) by theta about the hinge's X
  // axis, then translate by the hinge's own Y offset — see lidRotationX's
  // doc comment for the same rotation direction.
  const worldY = hingeY + localY * Math.cos(theta)
  const worldZ = localY * Math.sin(theta)

  return {
    width: screenWidth * UNIT,
    height: screenHeight * UNIT,
    offsetX: screenOffsetX * UNIT,
    offsetY: worldY,
    offsetZ: worldZ,
  }
}

/**
 * Pure camera-rig math: maps a `setCamera()` call plus a screen-plane layout
 * (see screenPlaneLayout()) onto a THREE-ready position/lookAt pair.
 *
 * - distance (default 1) multiplies `layout.distance`, the default framing
 *   distance for distance=1.
 * - targetU/targetV (default 0.5/0.5, 0..1) locate the aim point on the
 *   screen plane: (0,0) is the screen's top-left, (1,1) its bottom-right —
 *   both the camera position (in X/Y) and the lookAt point are the same
 *   point on the screen plane, so the camera looks straight at it head-on.
 * - driftX/driftY (default 0) nudge the camera POSITION only, in world
 *   units, for parallax — the lookAt point is unaffected.
 *
 * @param {{distance?: number, targetU?: number, targetV?: number, driftX?: number, driftY?: number}} cam
 * @param {{distance: number, width: number, height: number, offsetX: number, offsetY: number, offsetZ?: number}} layout
 * @returns {{position: [number, number, number], lookAt: [number, number, number]}}
 */
export function cameraLayout(cam, layout) {
  const { distance = 1, targetU = 0.5, targetV = 0.5, driftX = 0, driftY = 0 } = cam
  const { distance: baseDistance, width, height, offsetX = 0, offsetY = 0, offsetZ = 0 } = layout

  const x = offsetX + (targetU - 0.5) * width
  // V grows downward (0 = top) while world Y grows upward, so V maps onto Y
  // with a sign flip.
  const y = offsetY - (targetV - 0.5) * height
  const lookAt = [x, y, offsetZ]
  const position = [x + driftX, y + driftY, offsetZ + baseDistance * distance]
  return { position, lookAt }
}

// Framing safety margins (fractions of the analytic bound): `fit` is nudged
// out and `bleed` pulled in so an edge that is analytically flush lands a
// pixel or two clear of the frame under antialiasing and h264 chroma bleed.
// Calibrated against measured renders — see the lateral-fit report.
const FIT_MARGIN = 0.006
const BLEED_MARGIN = 0.006
// 1 - cos(45deg). Inset that turns a rounded rect of corner radius r into an
// inscribed axis-aligned rect (its corners land exactly on the corner arcs),
// so "the screen covers the frame" can't be satisfied by a corner arc that
// would actually show a black wedge in the frame's corner.
const ROUNDED_RECT_INSET = 1 - Math.SQRT1_2
// How far the pose may rotate off dead-frontal and still count as "frontal"
// for the `screenFit` exemption in constrainCameraDistance(). At a frontal
// pose the band of distances between `bleed` and `screenFit` shows nothing but
// screen plus the four corner wedges the screen's corner radius carves out; a
// tilt swings the metal side band toward one of those edges, which is the
// state the two-state snap exists to forbid. 1.5deg is comfortably above the
// reference look's residual micro-float at its ending (< 0.6deg, and faded to
// ~0 by t=1) and far below any authored tilt.
const FRONTAL_POSE_EPSILON_DEG = 1.5
// ...and how far it may then WANDER while already holding a screen-fit
// framing. Same reason the fit/bleed midpoint has hysteresis: the live HTML
// export idles on the reference look's ending under a +-3deg float, and a hard
// gate at 1.5deg would flip the framing four times a cycle. Holding instead
// costs a sliver of bezel along one edge — 4px of a 1080-wide frame at 3deg,
// 6px at 4deg — which reads as the device's own edge, where the flip reads as
// a 4% zoom pulse. Beyond this the classic two-state rule takes back over.
const FRONTAL_POSE_HOLD_DEG = 4

const _boundsVec = new THREE.Vector3()
const _boundsEuler = new THREE.Euler()

/**
 * The two legal camera distances for the reference cinematography rule: the
 * device is either FULLY inside the frame horizontally (exiting, if at all,
 * only through the top/bottom) or PAST full-bleed (the screen alone covering
 * the whole frame). Anything strictly between the two slices the metal side
 * band with the frame edge, which is the state this exists to forbid.
 *
 * Derived from the exact framing the renderer builds (see render()): a
 * PerspectiveCamera of CAMERA_FOV placed at `baseDistance * distance` in
 * front of the screen plane, with baseDistance = (worldH/2 / tan(fov/2)) *
 * 1.4 — i.e. distance 1 frames the device with a 40% margin. Writing
 * ky = tan(fov/2) * baseDistance (= 0.7 * worldH) and kx = ky * aspect, a
 * world point (X, Y, Z) is inside the frame horizontally iff
 *
 *   |X - cx| <= kx * distance + kx * (aimZ - Z) / baseDistance
 *
 * where (cx, cy, aimZ) is the aim point cameraLayout() puts the camera on.
 * Every bound below is that inequality solved for `distance`, which is
 * exact (and linear) rather than iterative.
 *
 * - `fit` uses the device body's full width (band included) — the unrotated
 *   box as a floor, widened by the posed box where the pose projects wider.
 *   See the inline comment for why it takes both.
 * - `bleed` uses the SCREEN plane's four corners under the *actual* pose
 *   (rotation tilts the plane away and genuinely loses coverage), inset for
 *   the screen's own corner radius, and requires coverage in BOTH axes.
 * - `screenFit` is the same corners WITHOUT that inset: the distance at which
 *   the screen's full rect is exactly inscribed in the frame, i.e. 100% of the
 *   screen is visible and nothing of it is cropped. It is the *ending* framing
 *   ("the full screen of the device is visible and not cropped"), and it sits
 *   between `bleed` and `fit` by construction — the un-inset rect is larger, so
 *   it needs more pull-back than `bleed`, and it is still only the screen, so
 *   it needs less than the whole body's `fit`.
 *
 * Camera drift (cameraLayout's driftX/driftY) is not modelled: the only look
 * that drifts sits at distance 1, far outside the forbidden zone.
 *
 * @param {object} args
 * @param {typeof DEVICES[keyof typeof DEVICES]|string} args.device
 * @param {'portrait'|'landscape'} [args.orientation]
 * @param {object} [args.pose] - a setPose() pose; only its rotation,
 *   translation and scale are read
 * @param {number} [args.viewportW] - the renderer's own box width. Under the
 *   default 'fit' pixelSizeMode the render rect is letterboxed into it
 *   preserving the device layout's aspect (fitPixelSize), so only the layout's
 *   aspect reaches the frame; under 'exact' the box IS the frame. Defaults to
 *   the layout.
 * @param {number} [args.viewportH]
 * @param {'fit'|'exact'} [args.pixelSizeMode] - must match the mode the
 *   renderer being aimed was created with (see resolvePixelSize), or the
 *   frame's true aspect and this closed form disagree and every horizontal
 *   term below (kx, and therefore fit/bleedU/uSpan) is wrong.
 * @returns {{fit: number, bleed: number, bleedU: number, bleedV: number, screenFit: number, poseTiltDeg: number, uSpan: number, vSpan: number}}
 *   `bleedU`/`bleedV` are the per-axis coverage limits (bleed = their min);
 *   `screenFit` is the max over corners AND axes of the same term on the
 *   un-inset rect — the max (not the min) because the goal there is the
 *   opposite one, every corner INSIDE the frame rather than outside it; at a
 *   frontal pose against a frame whose aspect matches the screen's, all eight
 *   of those terms coincide. `poseTiltDeg` is the pose's largest rotation
 *   magnitude, which is what gates that band's legality (see
 *   constrainCameraDistance).
 *   `uSpan`/`vSpan` convert a targetU/targetV offset into the distance it
 *   costs, so a caller can clamp the aim instead of the distance.
 */
export function distanceBounds({
  device,
  orientation = 'portrait',
  pose = null,
  viewportW = 0,
  viewportH = 0,
  pixelSizeMode = 'fit',
}) {
  const spec = typeof device === 'string' ? DEVICES[device] : device
  if (!spec) throw new UnsupportedDeviceError(typeof device === 'string' ? device : String(device))

  const layout = glLayout(spec, orientation)
  const worldW = layout.width * UNIT
  const worldH = layout.height * UNIT
  const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV) / 2)
  const baseDistance = (worldH / 2 / tanHalfFov) * 1.4
  const render = resolvePixelSize(
    layout,
    {
      width: viewportW > 0 ? viewportW : layout.width,
      height: viewportH > 0 ? viewportH : layout.height,
    },
    pixelSizeMode,
  )
  const ky = tanHalfFov * baseDistance
  const kx = ky * (render.width / render.height)

  const screen = screenPlaneLayout(spec, orientation)
  const p = { rotateX: 0, rotateY: 0, rotateZ: 0, translateX: 0, translateY: 0, translateZ: 0, scale: 1, ...(pose || {}) }
  const scale = p.scale || 1
  // Same mapping applyPose() uses (translateY negated into world Y).
  const tx = p.translateX * UNIT
  const ty = -p.translateY * UNIT
  const tz = p.translateZ * UNIT

  const euler = poseToEuler(p)
  _boundsEuler.set(euler.x, euler.y, euler.z)

  // fit: whichever is larger of two candidates for the widest thing the frame
  // can slice — the UNROTATED body box at its frontmost layer face, and the
  // same box under the actual pose. The unrotated one is the floor: a rotateY
  // narrows the silhouette, and letting the bound follow it down would both
  // wobble the distance as a look floats and leave nothing in hand at the
  // next angle. The posed one is what rotateX needs: it swings the far end of
  // the device's LONG axis toward the camera, where perspective magnifies it
  // several percent past the flat width — a 10deg tilt on a phone is ~5%,
  // which is exactly the band-slicing this rule exists to prevent.
  const zFront = layerBaseZ(spec, spec.layers.length - 1)
  // Back face of the (thickest) body slab — see buildFrameMesh's frontOffset.
  const zBack = layerBaseZ(spec, 1) + (BODY_THICKNESS * 0.9) / 2 - glBodyThickness(spec.name)
  const halfW = worldW / 2
  const halfH = worldH / 2
  let fitRaw = ((halfW * scale + Math.abs(tx - screen.offsetX)) / kx) + (zFront * scale + tz - screen.offsetZ) / baseDistance
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const z of [zBack, zFront]) {
        _boundsVec.set(sx * halfW, sy * halfH, z).multiplyScalar(scale).applyEuler(_boundsEuler)
        const need =
          Math.abs(_boundsVec.x + tx - screen.offsetX) / kx - (screen.offsetZ - (_boundsVec.z + tz)) / baseDistance
        if (need > fitRaw) fitRaw = need
      }
    }
  }
  const fit = fitRaw * (1 + FIT_MARGIN)

  // bleed: posed screen quad, inset for its corner radius, both axes.
  const inset = layout.screen.radius * UNIT * ROUNDED_RECT_INSET
  const halfScreenW = Math.max(0, screen.width / 2 - inset)
  const halfScreenH = Math.max(0, screen.height / 2 - inset)

  let bleedU = Infinity
  let bleedV = Infinity
  // screenFit: the same quad WITHOUT the corner inset, and taking the max
  // over corners and axes rather than the min — see the return doc.
  let screenFit = 0
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      _boundsVec.set(screen.offsetX + sx * halfScreenW, screen.offsetY + sy * halfScreenH, screen.offsetZ)
      _boundsVec.multiplyScalar(scale).applyEuler(_boundsEuler)
      const x = _boundsVec.x + tx
      const y = _boundsVec.y + ty
      const z = _boundsVec.z + tz
      const depthTerm = (screen.offsetZ - z) / baseDistance
      // Local sign classifies which frame edge this corner has to clear —
      // exact while |rotateY| and |rotateZ| stay under 90deg (every look).
      const horizontal = (sx < 0 ? screen.offsetX - x : x - screen.offsetX) / kx - depthTerm
      const vertical = (sy < 0 ? screen.offsetY - y : y - screen.offsetY) / ky - depthTerm
      if (horizontal < bleedU) bleedU = horizontal
      if (vertical < bleedV) bleedV = vertical

      // Same corner, full (un-inset) rect: the distance at which THIS corner
      // sits exactly on the frame edge. Pulling back to the largest of them
      // is what puts every corner inside the frame at once.
      _boundsVec.set(screen.offsetX + (sx * screen.width) / 2, screen.offsetY + (sy * screen.height) / 2, screen.offsetZ)
      _boundsVec.multiplyScalar(scale).applyEuler(_boundsEuler)
      const fx = _boundsVec.x + tx
      const fy = _boundsVec.y + ty
      const fz = _boundsVec.z + tz
      const fullDepth = (screen.offsetZ - fz) / baseDistance
      const fullH = (sx < 0 ? screen.offsetX - fx : fx - screen.offsetX) / kx - fullDepth
      const fullV = (sy < 0 ? screen.offsetY - fy : fy - screen.offsetY) / ky - fullDepth
      if (fullH > screenFit) screenFit = fullH
      if (fullV > screenFit) screenFit = fullV
    }
  }
  bleedU = Math.max(0, bleedU * (1 - BLEED_MARGIN))
  bleedV = Math.max(0, bleedV * (1 - BLEED_MARGIN))

  return {
    fit,
    bleed: Math.min(bleedU, bleedV),
    bleedU,
    bleedV,
    screenFit,
    poseTiltDeg: Math.max(Math.abs(p.rotateX), Math.abs(p.rotateY), Math.abs(p.rotateZ)),
    uSpan: screen.width / kx,
    vSpan: screen.height / ky,
  }
}

// How far (as a fraction of the fit-bleed gap) a held distance must clear the
// midpoint before constrainCameraDistance() lets it cross to the other side —
// see that function's `lastDistance` param. Without this, a distance parked
// near the midpoint flips sides on every tiny wobble of the bounds
// themselves (e.g. the reference look's pose float shifts `fit`/`bleed` a
// fraction of a percent per frame), strobing between whole-device and
// full-bleed framing.
const HYSTERESIS_MARGIN_FRACTION = 0.06

/**
 * Applies the lateral-fit rule to one look's camera: a distance in the
 * forbidden zone (between full-bleed and full lateral fit) snaps to whichever
 * bound is nearer, everything else passes through untouched.
 *
 * Both bounds are aim-aware, since panning is what makes a legal distance
 * illegal: an off-centre targetU costs `uSpan` distance units per unit of
 * offset, so `fit` grows with the pan (the camera pulls back rather than
 * losing the pan) while the coverage limit shrinks. When the snap lands on
 * the bleed side, targetU/targetV are clamped into the range that still
 * covers the frame at that distance — panning at full-bleed must not reveal
 * an edge.
 *
 * Frontal exemption. The forbidden zone's near end is `bleed` only because a
 * tilted device swings its metal side band toward the frame edge. At a
 * (near-)frontal pose — every rotation within FRONTAL_POSE_EPSILON_DEG, or
 * within FRONTAL_POSE_HOLD_DEG while `lastDistance` says a screen-fit framing
 * is already being held — there is no band anywhere near the frame: pulling
 * back from `bleed` as far as `screenFit` only trades the cropped few percent
 * of the screen for the four dark bezel wedges the corner radius carves out,
 * which is what a real phone filling your view looks like. So for a frontal
 * pose the legal near side runs from `bleed` all the way out to `screenFit`,
 * and a snap toward that side lands on `screenFit` rather than diving to
 * `bleed`. The exemption starts ABOVE `bleed` on purpose: a request deeper
 * than that is a plain full-bleed request that only its own pan pushed into
 * the zone, and it keeps the original clamp-the-aim treatment. Non-frontal
 * poses see the original two-state rule, bound for bound and hysteresis
 * included.
 *
 * @param {{distance?: number, targetU?: number, targetV?: number, driftX?: number, driftY?: number}} cam
 * @param {ReturnType<typeof distanceBounds>} bounds
 * @param {number} [lastDistance] - the distance this function RETURNED on the
 *   previous call in the same render session (the driver's job to remember —
 *   this function stays otherwise stateless). Used only to break ties near
 *   the midpoint: whichever side `lastDistance` sat on relative to the
 *   *current* midpoint must be cleared by a margin (HYSTERESIS_MARGIN_FRACTION
 *   of the fit-bleed gap) before a new request is allowed to cross to the
 *   other side. Omitted (first frame of a session, or a caller that doesn't
 *   track history) falls back to the plain nearer-side rule.
 * @returns {object} `cam` itself when already legal, else a constrained copy
 */
export function constrainCameraDistance(cam, bounds, lastDistance) {
  const distance = cam.distance ?? 1
  const targetU = cam.targetU ?? 0.5
  const targetV = cam.targetV ?? 0.5
  const offsetU = Math.abs(targetU - 0.5)
  const offsetV = Math.abs(targetV - 0.5)

  const fitHere = bounds.fit + offsetU * bounds.uSpan
  const coverHere = Math.min(bounds.bleedU - offsetU * bounds.uSpan, bounds.bleedV - offsetV * bounds.vSpan)
  if (distance >= fitHere) return cam

  // Frontal exemption (see the doc comment). Entered only from dead-on, then
  // held through a wobble up to FRONTAL_POSE_HOLD_DEG — `lastDistance` sitting
  // inside the band is what says a screen-fit framing is the one being held.
  // It applies only ABOVE the centred `bleed` bound: a request already deeper
  // than that is a genuine full-bleed request that only its own pan broke, and
  // keeps the original aim-clamp treatment below. Panning costs distance here
  // too, but with the opposite sign to `coverHere` — containing the whole
  // screen in a panned frame needs MORE pull-back, on whichever axis is panned.
  const holdingScreenFit = lastDistance != null && lastDistance > bounds.bleed && lastDistance <= bounds.screenFit
  const frontal =
    bounds.poseTiltDeg <= FRONTAL_POSE_EPSILON_DEG ||
    (holdingScreenFit && bounds.poseTiltDeg <= FRONTAL_POSE_HOLD_DEG)
  const exempt = frontal && bounds.screenFit > 0 && distance > bounds.bleed
  const screenFitHere = exempt
    ? bounds.screenFit + Math.max(offsetU * bounds.uSpan, offsetV * bounds.vSpan)
    : Infinity
  if (exempt && distance <= screenFitHere) return cam
  if (distance <= coverHere) return cam

  const nearHere = exempt ? screenFitHere : coverHere
  const midpoint = (fitHere + nearHere) / 2
  const margin = (fitHere - nearHere) * HYSTERESIS_MARGIN_FRACTION
  // No history: same tie-break as before hysteresis existed (nearer side
  // wins, threshold sits exactly on the midpoint).
  const wasFitSide = lastDistance == null ? distance >= midpoint : lastDistance >= midpoint
  const threshold = wasFitSide ? midpoint - margin : midpoint + margin

  if (distance >= threshold) {
    return { ...cam, distance: fitHere }
  }

  // Near side, frontal: land on the top of the exempt window, not the bottom
  // of it — diving all the way to `bleed` would crop the screen for nothing
  // and then pop back out as the lerp reached screenFit. No aim clamp: at
  // screen-fit the screen doesn't cover the frame, it exactly fills it.
  if (exempt) return { ...cam, distance: screenFitHere }

  // Bleed side: keep the distance if only the pan broke coverage, else pull
  // in to the centred bleed bound, then clamp the aim to what still covers.
  const snapped = Math.min(bounds.bleed, distance)
  const maxU = Math.max(0, (bounds.bleedU - snapped) / bounds.uSpan)
  const maxV = Math.max(0, (bounds.bleedV - snapped) / bounds.vSpan)
  return {
    ...cam,
    distance: snapped,
    targetU: 0.5 + Math.min(maxU, Math.max(-maxU, targetU - 0.5)),
    targetV: 0.5 + Math.min(maxV, Math.max(-maxV, targetV - 0.5)),
  }
}

/**
 * Contained mode (showcase `--contained`, for slide/column embeds): the
 * device must stay fully visible for the entire video — no full-bleed state
 * ever. Unlike constrainCameraDistance()'s two-state snap, this is a simple
 * floor: any requested distance under `fit` (offset for the pan, same
 * `fitHere` term as that function's fit-side branch) is pulled out to `fit`;
 * anything at or beyond fit passes through untouched. targetU/targetV are
 * left alone — the same fit-side pan behavior as constrainCameraDistance(),
 * which treats vertical framing (exiting top/bottom at fit) as the look's own
 * intent rather than something this constraint clamps.
 *
 * @param {{distance?: number, targetU?: number, targetV?: number, driftX?: number, driftY?: number}} cam
 * @param {ReturnType<typeof distanceBounds>} bounds
 * @returns {object} `cam` itself when already legal, else a copy floored to fit
 */
export function constrainCameraDistanceContained(cam, bounds) {
  const distance = cam.distance ?? 1
  const targetU = cam.targetU ?? 0.5
  const offsetU = Math.abs(targetU - 0.5)
  const fitHere = bounds.fit + offsetU * bounds.uSpan
  if (distance >= fitHere) return cam
  return { ...cam, distance: fitHere }
}

function createShadowTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = SHADOW_TEXTURE_SIZE
  canvas.height = SHADOW_TEXTURE_SIZE
  const ctx = canvas.getContext('2d')
  const r = SHADOW_TEXTURE_SIZE / 2
  const gradient = ctx.createRadialGradient(r, r, 0, r, r, r)
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.45)')
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, SHADOW_TEXTURE_SIZE, SHADOW_TEXTURE_SIZE)
  return new THREE.CanvasTexture(canvas)
}

/**
 * Drawing-buffer size for a renderer given an explicit `pixelSize` cap: the
 * device layout is scaled (up OR down — unlike media.js's fitSize, which
 * never upscales) to fill the cap while preserving the layout's aspect
 * ratio. This is what makes an offscreen export render at the *output*
 * resolution instead of at the device's nominal layout size, so a 2x export
 * carries genuinely more detail rather than more empty margin.
 *
 * @param {{width: number, height: number}} layout
 * @param {{width: number, height: number}} pixelSize
 * @returns {{width: number, height: number}}
 */
export function fitPixelSize(layout, pixelSize) {
  const scale = Math.min(pixelSize.width / layout.width, pixelSize.height / layout.height)
  return {
    width: Math.max(1, Math.round(layout.width * scale)),
    height: Math.max(1, Math.round(layout.height * scale)),
  }
}

/**
 * Drawing-buffer size for an explicit `pixelSize` under a given mode — the one
 * place the two interpretations of `pixelSize` live:
 *
 * - 'fit' (default): aspect-fit the device layout into the box (fitPixelSize).
 *   The buffer is narrower/shorter than the box on one axis, and the CALLER
 *   composites it into the real output frame (src/export/media.js blits onto a
 *   separately-sized 2D canvas; bin/showcase.mjs used to letterbox with an
 *   ffmpeg `pad`). Keeps media export's captureStill/captureFrames contract.
 * - 'exact': the buffer IS the box, verbatim (rounded to even dims, which
 *   yuv420p encoders require). The camera then composes against the true
 *   output frame, so "the screen covers the frame" means the real frame rather
 *   than an aspect-fit sub-rect of it — which is the only way a full-bleed
 *   beat can reach the output's own left/right edges.
 *
 * @param {{width: number, height: number}} layout
 * @param {{width: number, height: number}} pixelSize
 * @param {'fit'|'exact'} [mode]
 * @returns {{width: number, height: number}}
 */
export function resolvePixelSize(layout, pixelSize, mode = 'fit') {
  if (mode !== 'exact') return fitPixelSize(layout, pixelSize)
  return {
    width: Math.max(2, Math.round(pixelSize.width / 2) * 2),
    height: Math.max(2, Math.round(pixelSize.height / 2) * 2),
  }
}

/**
 * @param {HTMLElement} containerEl
 * @param {object} [options]
 * @param {{width: number, height: number}} [options.pixelSize] - when set,
 *   the canvas's drawing buffer is sized from this box at a pixel ratio of
 *   exactly 1, instead of being sized to the device layout at
 *   window.devicePixelRatio. Used by media export so output resolution is a
 *   function of the requested scale alone, never of the user's display.
 * @param {'fit'|'exact'} [options.pixelSizeMode] - how pixelSize is
 *   interpreted (see resolvePixelSize). 'fit' (the default) aspect-fits the
 *   device layout into the box and leaves the caller to composite/letterbox —
 *   camera framing is unaffected, same aspect either way. 'exact' makes the
 *   buffer the box verbatim, so the camera composes against the true output
 *   frame (wider than the device layout for a 9:16 phone showcase) — a caller
 *   using this must pass the same mode to distanceBounds().
 * @returns {{render(scene): Promise<void>, setPose(pose): void, setCamera(cam): void, setScreenSource(canvasEl): void, setScreenCorners(scale): void, updateScreen(): void, destroy(): void}}
 */
export function createGlRenderer(containerEl, { pixelSize = null, pixelSizeMode = 'fit' } = {}) {
  let renderer = null
  let pmremGenerator = null
  let envRenderTarget = null

  let scene = null
  let camera = null
  let deviceGroup = null
  let layerGroups = [] // {group, index, baseZ}
  let lidGroup = null
  let disposables = [] // geometries/materials/textures owned by the current build
  let buildGen = 0 // guards a stale async texture load from rendering onto a torn-down scene
  let cameraFrameLayout = null // {distance, width, height, offsetX, offsetY, offsetZ} — see screenPlaneLayout()/cameraLayout()

  // setScreenSource()/updateScreen() state: an external <canvas> replacing
  // the content-image texture path (see the doc comment on setScreenSource
  // below). screenMaterial/screenIsBrowserDevice are set fresh by each
  // render() build; externalCanvas persists across builds (a driver may call
  // setScreenSource() once and render() many times).
  let externalCanvas = null
  let screenMaterial = null
  let screenIsBrowserDevice = false
  let screenComposeDims = null // {width, height, dpr} — browser-device chrome recompose target
  let externalScreenTexture = null // the live CanvasTexture applied to screenMaterial, once built
  // setScreenCorners() state: the screen+glass meshes of the current build
  // ([{mesh, width, height, radius}] — see cornerMeshSpecs), the scale
  // currently applied, and the geometries this path owns (NOT in disposables:
  // it may replace them per frame, and pushing each replacement would grow
  // that array for the life of the build).
  let cornerMeshes = []
  let cornerScale = 1
  let cornerGeometries = []

  function ensureRenderer() {
    if (renderer) return
    // preserveDrawingBuffer so canvas.toDataURL()/toBlob() reads back the
    // last rendered frame reliably (used by Playwright to confirm the
    // animation is actually ticking, and useful for future screenshot
    // verification) — otherwise a WebGL context may clear its buffer after
    // compositing and reads become implementation-dependent.
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
    // An explicit pixelSize already *is* a drawing-buffer size, so it must
    // not be multiplied by the display's DPR on top (see resizeToLayout).
    renderer.setPixelRatio(pixelSize ? 1 : Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.setClearColor(0x000000, 0)
    containerEl.appendChild(renderer.domElement)

    pmremGenerator = new THREE.PMREMGenerator(renderer)
    envRenderTarget = pmremGenerator.fromScene(new RoomEnvironment(), 0.04)
  }

  function disposeBuild() {
    for (const disposable of disposables) disposable?.dispose?.()
    disposables = []
    // The external screen texture lives in its own single slot (never in
    // disposables — updateScreen() may replace it every frame, and pushing
    // each replacement would grow the array for the life of the build).
    externalScreenTexture?.dispose()
    externalScreenTexture = null
    // Same reasoning for the corner-radius geometries (see their declaration).
    for (const geometry of cornerGeometries) geometry.dispose()
    cornerGeometries = []
    cornerMeshes = []
    cornerScale = 1
  }

  function track(...items) {
    disposables.push(...items)
    return items[0]
  }

  function bodyMaterial(color) {
    return track(
      new THREE.MeshPhysicalMaterial({ color, metalness: 0.8, roughness: 0.35 })
    )
  }

  // Polished-metal material for a frame mesh's side (band) faces — see
  // FRAME_FINISHES/resolveFrameFinish. Kept separate from bodyMaterial()
  // (used for the front/back cap faces, which stay a fixed dark composite
  // color) so the two read as genuinely different materials, not just
  // different colors of the same finish.
  function bandMaterial(finish) {
    return track(
      new THREE.MeshPhysicalMaterial({ color: finish.color, metalness: finish.metalness, roughness: finish.roughness })
    )
  }

  // Extruded rounded-rect body instead of RoundedBoxGeometry: the corner
  // radius is a function of the body's own width/height only, never the
  // slab thickness, so it matches the device spec's cornerRadius
  // proportionally regardless of how thin the slab is.
  //
  // `frontOffset` (default: centered, i.e. thickness/2) is the local Z of
  // the extrusion's FRONT face after centering — exposed so a caller can
  // grow `thickness` (see glBodyThickness) while pinning the front face at
  // its original position, growing the slab backward only. This matters
  // for the "body" mesh: it sits directly behind the screen/glass layers at
  // a fixed gap (see layerBaseZ's doc comment), so a thickness increase
  // centered on Z would push its front face into the screen instead of
  // just making the visible side band thicker.
  //
  // `finish` (a FRAME_FINISHES entry), when given, is applied to the
  // extrusion's SIDE faces only via a second material — ExtrudeGeometry
  // already groups side-wall triangles under materialIndex 1 and cap
  // (front+back) triangles under materialIndex 0, so a plain [cap, band]
  // material array is all that's needed; no manual geometry.addGroup calls.
  //
  // `chamfer` (see glBandChamfer) turns the band's two 90deg edges into 45deg
  // facets via ExtrudeGeometry's own bevel — no separate rim mesh, because the
  // bevel triangles are already emitted into the SIDE group (materialIndex 1)
  // alongside the walls, so they inherit the band finish for free and there is
  // no seam to keep aligned. The bevel is paid for out of `thickness` rather
  // than added to it (depth = thickness - 2 * chamfer, and the extrusion's own
  // z range grows back by exactly the bevel on each end), so the slab still
  // spans [frontOffset - thickness, frontOffset] and the front-face pinning
  // above — which layerBaseZ's front-face ordering depends on — is unchanged.
  function buildFrameMesh(layout, color, thickness, { finish = null, frontOffset = thickness / 2, chamfer = 0 } = {}) {
    const shape = roundedRectShape(layout.body.width * UNIT, layout.body.height * UNIT, layout.body.radius * UNIT)
    const bevel = Math.max(0, Math.min(chamfer, thickness / 4))
    const geometry = track(
      new THREE.ExtrudeGeometry(shape, {
        depth: thickness - bevel * 2,
        bevelEnabled: bevel > 0,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelOffset: 0,
        bevelSegments: 1, // one flat 45deg facet — a hard highlight line, not a rounded pillow
        // 12 rather than 8: the chamfer turns each corner-arc segment into its
        // own facet, and at 8 the faceting is visible along the corners.
        curveSegments: 12,
      })
    )
    geometry.translate(0, 0, frontOffset - thickness + bevel)
    const material = finish ? [bodyMaterial(color), bandMaterial(finish)] : bodyMaterial(color)
    return new THREE.Mesh(geometry, material)
  }

  // Volume/power buttons standing proud of the side band (see sideButtonSpecs
  // for the placement math). Each is a chamfered pill extruded along +Z and
  // then turned to face out along +-X, with its root end left buried inside
  // the band so there is no seam where it meets the metal. They share one
  // polished-metal material with the band itself — the same hardware, per the
  // reference — and are returned as loose meshes for the caller to parent
  // alongside the body so explode carries them with it.
  function buildSideButtons(layout, deviceName, finish, band) {
    const specs = sideButtonSpecs(layout, deviceName, band)
    if (!specs.length) return []
    const material = bandMaterial(finish)
    return specs.map((spec) => {
      const bevel = Math.min(spec.protrusion * 0.4, spec.depth / 4)
      const shape = roundedRectShape(spec.depth, spec.length, spec.depth / 2)
      const geometry = track(
        new THREE.ExtrudeGeometry(shape, {
          depth: spec.protrusion - bevel,
          bevelEnabled: true,
          bevelThickness: bevel,
          bevelSize: bevel,
          bevelOffset: 0,
          bevelSegments: 1,
          curveSegments: 6,
        })
      )
      const mesh = new THREE.Mesh(geometry, material)
      // +90deg about Y sends the extrusion's local +Z to world +X (and -90deg
      // to -X), so the pill grows outward from the side face it sits on.
      mesh.rotation.y = (spec.side * Math.PI) / 2
      mesh.position.set(spec.x, spec.y, spec.z)
      return mesh
    })
  }

  // The build-time screen geometry (see the module-level buildScreenGeometry),
  // owned by this build's disposables. setScreenCorners() replaces it per
  // frame with geometry it owns itself.
  function screenGeometry(width, height, radius) {
    return track(buildScreenGeometry(width, height, radius))
  }

  // The screen material's passthrough color, for every scene: exactly white.
  // MeshBasicMaterial MULTIPLIES this into the (sRGB-decoded) texture sample,
  // so anything but white is a colour grade applied to the user's own
  // content. The showcase scene used to boost it to 1.15 for a "hotter"
  // screen; measured through the pipeline on a test card that turned 200 grey
  // into 211 and clipped everything above ~236 to pure white — ruinous on a
  // UI recording, which is mostly near-white. The screen reads bright against
  // the bezel on its own, because it is unlit passthrough while the metal
  // around it is a lit PBR surface.
  function screenPassthroughColor() {
    return new THREE.Color(0xffffff)
  }

  // Returns { mesh, ready } — `ready` resolves once the content image (if
  // any) has decoded and its texture has been applied and painted, so a
  // caller that needs a deterministic, fully-textured frame (media export —
  // see src/export/media.js) can await it instead of racing the async
  // TextureLoader callback. Resolves immediately when there's no image to
  // load. Never rejects (a failed load just leaves the fallback color).
  //
  // `screenWhite` is the material's passthrough color — see
  // screenPassthroughColor().
  function buildScreenMesh(layout, content, screenWhite) {
    const screenWidth = layout.screen.width * UNIT
    const screenHeight = layout.screen.height * UNIT
    const geometry = screenGeometry(screenWidth, screenHeight, (layout.screen.radius ?? 0) * UNIT)
    const hasImage = content.type === 'image' && !!content.src
    // MeshBasicMaterial *multiplies* map by color, so a black base color
    // renders any screenshot as pure black. White (or the showcase-boosted
    // variant) is the unlit passthrough for the texture; black stays the
    // no-content fallback (an off screen).
    const material = track(new THREE.MeshBasicMaterial({ color: hasImage ? screenWhite : 0x000000 }))
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(layout.screen.offsetX * UNIT, layout.screen.offsetY * UNIT, 0)

    let ready = Promise.resolve()
    if (hasImage) {
      const generationAtLoad = buildGen
      const screenAspect = screenWidth / screenHeight
      ready = new Promise((resolve) => {
        new THREE.TextureLoader().load(
          content.src,
          (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace
            // Cover-fit: an image whose aspect doesn't match the screen's
            // would otherwise stretch/squish to fill the plane (a plain
            // texture map always fills its geometry's 0..1 UV square). This
            // crops the overflow via UV repeat/offset instead, centered,
            // so content reaches the mask edge without distortion.
            const imageAspect = texture.image.width / texture.image.height
            if (imageAspect > screenAspect) {
              texture.repeat.set(screenAspect / imageAspect, 1)
              texture.offset.set((1 - screenAspect / imageAspect) / 2, 0)
            } else {
              texture.repeat.set(1, imageAspect / screenAspect)
              texture.offset.set(0, (1 - imageAspect / screenAspect) / 2)
            }
            track(texture)
            if (generationAtLoad === buildGen && renderer) {
              material.map = texture
              material.color.copy(screenWhite)
              material.needsUpdate = true
              renderer.render(scene, camera)
            }
            resolve()
          },
          undefined,
          () => resolve() // a failed load still resolves — the fallback color stays
        )
      })
    }

    return { mesh, ready }
  }

  // Browser device only: the screen texture is composed on an offscreen
  // canvas — a generic chrome bar (dots + URL pill) drawn above the content
  // image, per spec §2 — rather than the content image applied directly like
  // buildScreenMesh(). Reuses layout.screen (same bezel-inset rect every
  // other device's screen plane uses), so the composed canvas is sized to
  // exactly match the plane's own aspect ratio (no stretch/squish of the
  // dots into ellipses).
  // Returns { mesh, ready } — see buildScreenMesh's doc comment; same
  // readiness contract, just composing the chrome-bar texture instead of
  // applying the content image directly.
  function buildBrowserScreenMesh(layout, content, screenWhite) {
    const { width, height } = layout.screen
    const geometry = screenGeometry(width * UNIT, height * UNIT, (layout.screen.radius ?? 0) * UNIT)
    const material = track(new THREE.MeshBasicMaterial({ color: screenWhite }))
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(layout.screen.offsetX * UNIT, layout.screen.offsetY * UNIT, 0)

    const dpr = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO)
    const applyTexture = (image) => {
      const canvas = composeChromeTexture(image, { width, height, dpr })
      const texture = track(new THREE.CanvasTexture(canvas))
      texture.colorSpace = THREE.SRGBColorSpace
      material.map = texture
      material.needsUpdate = true
    }

    const hasImage = content.type === 'image' && !!content.src
    let ready = Promise.resolve()
    if (hasImage) {
      const generationAtLoad = buildGen
      ready = new Promise((resolve) => {
        const image = new Image()
        image.onload = () => {
          if (generationAtLoad === buildGen && renderer) {
            applyTexture(image)
            renderer.render(scene, camera)
          }
          resolve()
        }
        image.onerror = () => resolve() // a failed load leaves the plain chrome bar drawn below
        image.src = content.src
      })
    } else {
      applyTexture(null) // still draws the chrome bar over an empty screen
    }

    return { mesh, ready }
  }

  function buildGlassMesh(layout, glare) {
    const geometry = screenGeometry(layout.screen.width * UNIT, layout.screen.height * UNIT, (layout.screen.radius ?? 0) * UNIT)
    const material = track(
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: glare ? 0.18 : 0,
        roughness: 0.05,
        metalness: 0,
        clearcoat: 1,
      })
    )
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(layout.screen.offsetX * UNIT, layout.screen.offsetY * UNIT, 0)
    return mesh
  }

  function buildShadowPlane(layout) {
    const texture = track(createShadowTexture())
    const geometry = track(new THREE.PlaneGeometry(layout.width * UNIT * 1.6, layout.height * UNIT * 1.6))
    const material = track(new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }))
    const mesh = new THREE.Mesh(geometry, material)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.y = -(layout.height * UNIT) / 2 - 0.1
    return mesh
  }

  function createGlowTexture() {
    const canvas = document.createElement('canvas')
    canvas.width = SHADOW_TEXTURE_SIZE
    canvas.height = SHADOW_TEXTURE_SIZE
    const ctx = canvas.getContext('2d')
    const r = SHADOW_TEXTURE_SIZE / 2
    const gradient = ctx.createRadialGradient(r, r, 0, r, r, r)
    gradient.addColorStop(0, 'rgba(124, 156, 255, 0.55)')
    gradient.addColorStop(1, 'rgba(124, 156, 255, 0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, SHADOW_TEXTURE_SIZE, SHADOW_TEXTURE_SIZE)
    return new THREE.CanvasTexture(canvas)
  }

  // "Glow" approximation: a single additive-blended radial sprite behind the
  // device, added as a child of deviceGroup (not the top-level scene, unlike
  // buildShadowPlane) so it inherits the device's pose transform and reads
  // as a light bleed that moves/rotates with the device. A real bloom would
  // need a postprocessing pass (EffectComposer + UnrealBloomPass), which the
  // brief asks us not to add as a new dependency — this fakes the same
  // "halo" read with one blended plane, reusing the same
  // canvas-radial-gradient-texture technique as the contact shadow above.
  function buildGlowPlane(layout) {
    const texture = track(createGlowTexture())
    const geometry = track(new THREE.PlaneGeometry(layout.width * UNIT * 1.8, layout.height * UNIT * 1.8))
    const material = track(
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    )
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.z = -BODY_THICKNESS * 2 // behind the shell layer (z=0)
    return mesh
  }

  // Flat, layered build shared by phone/tablet/browser: shell/body/screen
  // stacked along Z like the CSS renderer's DOM layers.
  function buildFlatDevice(layout, sceneSpec, device) {
    const group = new THREE.Group()
    const finish = resolveFrameFinish(sceneSpec.style.frame)
    const band = {
      thickness: glBodyThickness(device.name),
      chamfer: glBandChamfer(device.name),
      // Pin the front cap face at its original (pre-multiplier) position —
      // see buildFrameMesh's doc comment — so a thicker band grows backward
      // only and never pushes into the screen/glass layers in front of it.
      frontOffset: (BODY_THICKNESS * 0.9) / 2,
    }
    const shell = buildFrameMesh(layout, 0x1c1c1e, BODY_THICKNESS)
    // The body mesh plus its side buttons ride in one group so the explode
    // animation (which moves whole layer groups) carries them together.
    const body = new THREE.Group()
    body.add(
      buildFrameMesh(layout, 0x2c2d30, band.thickness, { finish, frontOffset: band.frontOffset, chamfer: band.chamfer }),
      ...buildSideButtons(layout, device.name, finish, band)
    )
    const screenWhite = screenPassthroughColor()
    const screenBuild =
      device.name === 'browser'
        ? buildBrowserScreenMesh(layout, sceneSpec.content, screenWhite)
        : buildScreenMesh(layout, sceneSpec.content, screenWhite)
    const glass = buildGlassMesh(layout, sceneSpec.style.glare)

    const meshes = [shell, body, screenBuild.mesh, glass]
    const groups = meshes.map((mesh, index) => {
      const layerGroup = new THREE.Group()
      layerGroup.add(mesh)
      const baseZ = layerBaseZ(device, index)
      layerGroup.position.z = baseZ
      group.add(layerGroup)
      return { group: layerGroup, index, baseZ }
    })

    if (sceneSpec.style.glow) group.add(buildGlowPlane(layout))

    return {
      group,
      layerGroups: groups,
      lidGroup: null,
      ready: screenBuild.ready,
      screenMaterial: screenBuild.mesh.material,
      screenComposeDims: { width: layout.screen.width, height: layout.screen.height },
      cornerMeshes: cornerMeshSpecs([screenBuild.mesh, glass], layout.screen),
    }
  }

  // The meshes whose corner radius setScreenCorners() animates — the screen
  // and the glass in front of it, which share one rect (and must keep sharing
  // it, or the glass would sit proud of a squared-off screen at the corners).
  function cornerMeshSpecs(meshes, screenLayout) {
    const rect = {
      width: screenLayout.width * UNIT,
      height: screenLayout.height * UNIT,
      radius: (screenLayout.radius ?? 0) * UNIT,
    }
    return meshes.map((mesh) => ({ mesh, ...rect }))
  }

  // Laptop is two rigid parts: a base (shell + body) and a hinged lid
  // (screen + glass) that rotates about its bottom edge, matching the CSS
  // renderer's base/lid split.
  function buildLaptopDevice(layout, sceneSpec, device) {
    const group = new THREE.Group()

    const baseHeight = LAPTOP_BASE_HEIGHT
    const lidHeight = layout.height - baseHeight
    const baseLayout = {
      width: layout.width,
      height: baseHeight,
      body: { width: layout.width, height: baseHeight, radius: layout.body.radius },
    }
    const lidWidth = layout.width - device.bezel.left - device.bezel.right
    const lidScreenLayout = {
      width: layout.width,
      height: lidHeight,
      screen: {
        width: lidWidth,
        height: lidHeight - device.bezel.top - device.bezel.bottom,
        radius: device.screenRadius,
        offsetX: (device.bezel.left - device.bezel.right) / 2,
        offsetY: (device.bezel.bottom - device.bezel.top) / 2,
      },
    }

    // Each layer gets its own explode-animated wrapper group (baseZ set
    // below), nested under whichever rigid part it belongs to.
    function layerGroupFor(mesh, index) {
      const layerGroup = new THREE.Group()
      layerGroup.add(mesh)
      const baseZ = layerBaseZ(device, index)
      layerGroup.position.z = baseZ
      return { group: layerGroup, index, baseZ }
    }

    const baseGroup = new THREE.Group()
    const shell = buildFrameMesh(baseLayout, 0x1c1c1e, BODY_THICKNESS)
    const body = buildFrameMesh(baseLayout, 0x2c2d30, glBodyThickness(device.name), {
      finish: resolveFrameFinish(sceneSpec.style.frame),
      frontOffset: (BODY_THICKNESS * 0.9) / 2,
    })
    const shellLayer = layerGroupFor(shell, 0)
    const bodyLayer = layerGroupFor(body, 1)
    baseGroup.add(shellLayer.group, bodyLayer.group)
    baseGroup.position.y = -(layout.height * UNIT) / 2 + (baseHeight * UNIT) / 2

    const hingeY = -(layout.height * UNIT) / 2 + baseHeight * UNIT
    const lid = new THREE.Group()
    const screenBuild = buildScreenMesh(lidScreenLayout, sceneSpec.content, screenPassthroughColor())
    const screen = screenBuild.mesh
    const glass = buildGlassMesh(lidScreenLayout, sceneSpec.style.glare)
    // Position screen/glass relative to the lid's own local center, then
    // offset the whole lid group so its pivot (local origin) sits at the
    // hinge line — rotating `lid` therefore rotates about the hinge, not
    // the lid's visual center.
    const lidLocalCenterY = (lidHeight * UNIT) / 2
    screen.position.y += lidLocalCenterY
    glass.position.y += lidLocalCenterY
    const screenLayer = layerGroupFor(screen, 2)
    const glassLayer = layerGroupFor(glass, 3)
    lid.add(screenLayer.group, glassLayer.group)
    lid.position.y = hingeY

    const layerGroupSpecs = [shellLayer, bodyLayer, screenLayer, glassLayer]

    group.add(baseGroup, lid)

    if (sceneSpec.style.glow) group.add(buildGlowPlane(layout))

    return {
      group,
      layerGroups: layerGroupSpecs,
      lidGroup: lid,
      ready: screenBuild.ready,
      screenMaterial: screenBuild.mesh.material,
      screenComposeDims: { width: lidScreenLayout.screen.width, height: lidScreenLayout.screen.height },
      cornerMeshes: cornerMeshSpecs([screen, glass], lidScreenLayout.screen),
    }
  }

  function resizeToLayout(layout) {
    // updateStyle: false for the pixelSize path — the canvas is offscreen
    // and only its drawing buffer is ever read back, so its CSS box is
    // irrelevant and must not be forced to the (much larger) buffer size.
    const size = pixelSize ? resolvePixelSize(layout, pixelSize, pixelSizeMode) : { width: layout.width, height: layout.height }
    renderer.setSize(size.width, size.height, !pixelSize)
    camera.aspect = size.width / size.height
    camera.updateProjectionMatrix()
  }

  // scene.style.background per the spec's Renderer 2 section: paints the
  // renderer's own clear color, "transparent" meaning literally
  // alpha-transparent (so the page/container behind the canvas shows
  // through) rather than an opaque black.
  function applyBackground(background) {
    if (background === 'transparent') {
      renderer.setClearColor(0x000000, 0)
    } else {
      renderer.setClearColor(new THREE.Color(background), 1)
    }
  }

  // scene.style.scene === "showcase": pure black background, stronger
  // key/rim lighting so the metallic bezel catches highlights, contact shadow
  // kept as-is. Everything here is additive and gated on isShowcase so the
  // default scene (isShowcase === false) renders byte-for-byte as before —
  // no existing call path is touched.
  function addShowcaseLights(targetScene) {
    const key = new THREE.DirectionalLight(0xffffff, 3)
    key.position.set(1.1, 1.6, 1.8)
    targetScene.add(key)

    const rim = new THREE.DirectionalLight(0xaec6ff, 2)
    rim.position.set(-1.3, 0.5, -1.6)
    targetScene.add(rim)
  }

  function render(sceneSpec) {
    if (!DEVICES[sceneSpec.device]) {
      throw new UnsupportedDeviceError(sceneSpec.device)
    }

    const isShowcase = sceneSpec.style.scene === 'showcase'

    ensureRenderer()
    // Showcase default is the cinematic black void, but an explicit non-
    // transparent style.background (e.g. the CLI's --background) wins — a
    // branded backdrop with the same showcase lighting on the device.
    const showcaseBackground =
      sceneSpec.style.background && sceneSpec.style.background !== 'transparent'
        ? sceneSpec.style.background
        : '#000000'
    applyBackground(isShowcase ? showcaseBackground : sceneSpec.style.background)
    disposeBuild()
    buildGen += 1
    screenMaterial = null
    screenComposeDims = null
    externalScreenTexture = null

    const device = DEVICES[sceneSpec.device]
    const layout = glLayout(device, sceneSpec.orientation)

    scene = new THREE.Scene()
    scene.environment = envRenderTarget.texture
    if (isShowcase) addShowcaseLights(scene)

    camera = new THREE.PerspectiveCamera(CAMERA_FOV, layout.width / layout.height, 0.01, 100)
    const worldHeight = layout.height * UNIT
    const distance = (worldHeight / 2 / Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV) / 2)) * 1.4
    camera.position.set(0, 0, distance)
    camera.lookAt(0, 0, 0)
    cameraFrameLayout = { distance, ...screenPlaneLayout(device, sceneSpec.orientation) }

    const built =
      device.name === 'laptop'
        ? buildLaptopDevice(layout, sceneSpec, device)
        : buildFlatDevice(layout, sceneSpec, device)

    deviceGroup = built.group
    layerGroups = built.layerGroups
    lidGroup = built.lidGroup
    scene.add(deviceGroup)

    if (sceneSpec.style.shadow) {
      scene.add(buildShadowPlane(layout))
    }

    screenMaterial = built.screenMaterial
    cornerMeshes = built.cornerMeshes || []
    cornerScale = 1
    screenIsBrowserDevice = device.name === 'browser'
    screenComposeDims = { ...built.screenComposeDims, dpr: Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO) }

    resizeToLayout(layout)
    applyPose(sceneSpec.pose)

    // A setScreenSource() call from before this (re)build re-applies to the
    // freshly built screen material — see setScreenSource()'s doc comment.
    if (externalCanvas) applyExternalScreenSource()

    // Resolves once the content texture (if any) has decoded and painted —
    // media export (src/export/media.js) awaits this instead of racing the
    // async TextureLoader/Image callback for a deterministic, fully-textured
    // capture. Existing callers (Preview.jsx, runtime-gl-entry.js) call
    // render() without awaiting, which stays correct: the synchronous
    // fallback-color frame above is still painted immediately either way.
    return built.ready
  }

  function applyPose(pose) {
    if (!deviceGroup) return

    deviceGroup.position.set(pose.translateX * UNIT, -pose.translateY * UNIT, pose.translateZ * UNIT)
    const euler = poseToEuler(pose)
    deviceGroup.rotation.set(euler.x, euler.y, euler.z)
    deviceGroup.scale.setScalar(pose.scale)

    for (const layer of layerGroups) {
      layer.group.position.z = layer.baseZ + pose.explode * EXPLODE_Z_STEP * layer.index
    }

    if (lidGroup) {
      lidGroup.rotation.x = lidRotationX(pose.lidAngle)
    }

    renderer.render(scene, camera)
  }

  function setPose(pose) {
    applyPose(pose)
  }

  /**
   * Camera rig: composes `cam` with the current build's screen-plane layout
   * (see cameraLayout()) and applies the result to the live THREE.Camera —
   * callable per-frame, just like setPose(). A no-op before the first
   * render() or after destroy() (mirrors setPose's implicit
   * !deviceGroup guard).
   *
   * @param {{distance?: number, targetU?: number, targetV?: number, driftX?: number, driftY?: number}} cam
   */
  function setCamera(cam) {
    if (!camera || !cameraFrameLayout) return
    const { position, lookAt } = cameraLayout(cam, cameraFrameLayout)
    camera.position.set(...position)
    camera.lookAt(...lookAt)
    renderer.render(scene, camera)
  }

  // Applies externalCanvas to the current build's screen material, if both
  // exist yet. Browser device: recomposes the chrome-bar texture over the
  // live canvas each call (see setScreenSource's doc comment for why a
  // fresh compose here is acceptable) — the previous composed texture is
  // disposed immediately rather than left for the next disposeBuild(), since
  // updateScreen() may call this every frame. Other devices: wraps
  // externalCanvas directly in a single persistent CanvasTexture, created
  // once and then just marked needsUpdate by updateScreen() on subsequent
  // calls.
  function applyExternalScreenSource() {
    if (!screenMaterial || !externalCanvas) return
    const screenWhite = screenPassthroughColor()

    if (screenIsBrowserDevice) {
      const composed = composeChromeTexture(externalCanvas, screenComposeDims)
      if (externalScreenTexture) {
        // Same texture object, new pixels behind it: only the texture upload
        // is dirty. `material.needsUpdate` recompiles the shader program and
        // this path runs on every updateScreen() — the map object hasn't
        // changed, so only the first assignment below ever needs it.
        externalScreenTexture.image = composed
        externalScreenTexture.needsUpdate = true
        return
      }
      const texture = new THREE.CanvasTexture(composed)
      texture.colorSpace = THREE.SRGBColorSpace
      externalScreenTexture = texture // single slot, not track() — see disposeBuild()
      screenMaterial.map = texture
      screenMaterial.color.copy(screenWhite)
      screenMaterial.needsUpdate = true
      return
    }

    if (!externalScreenTexture) {
      const texture = new THREE.CanvasTexture(externalCanvas)
      texture.colorSpace = THREE.SRGBColorSpace
      externalScreenTexture = texture // single slot, not track() — see disposeBuild()
      screenMaterial.map = texture
      screenMaterial.color.copy(screenWhite)
      screenMaterial.needsUpdate = true
    }
  }

  /**
   * An external <canvas> becomes the screen's live texture, replacing the
   * content-image path — the DRIVER (the future showcase runtime, per
   * docs/superpowers/specs/2026-09-04-showcase-design.md §1) owns decoding
   * a video/animation onto `canvasEl` and calls updateScreen() per frame.
   * The editor never calls this.
   *
   * Safe to call before the first render() (just remembers canvasEl for the
   * next build) and safe to call again with a new canvas (replaces the live
   * texture on the next applyExternalScreenSource()).
   *
   * Browser device: the chrome bar (composeChromeTexture — same one the
   * static-image path uses) is recomposed OVER canvasEl's live content on
   * every updateScreen() call, rather than rendering canvasEl full-bleed.
   * A 2D canvas draw + drawImage is cheap next to the WebGL frame it sits
   * beside, and keeping the chrome bar means the browser device looks the
   * same whether its content is a static image or a live canvas — the
   * simpler full-bleed alternative would make the two paths visually
   * inconsistent for no real savings.
   *
   * Passing null detaches the live source (its texture is disposed);
   * call render(scene) afterwards to restore the content-image path —
   * until then the screen keeps the last uploaded frame.
   *
   * @param {HTMLCanvasElement|null} canvasEl
   */
  function setScreenSource(canvasEl) {
    externalCanvas = canvasEl || null
    externalScreenTexture?.dispose()
    externalScreenTexture = null // force (re)creation against the new canvas
    if (screenMaterial) applyExternalScreenSource()
  }

  /**
   * Per-frame screen corner radius: 1 = the device's authored radius, 0 =
   * square. The showcase's reference look drives this to 0 for its ending
   * (see src/showcase/looks.js's referenceKeyframes), where the screen fills
   * the output frame and a rounded corner would leave a wedge of backdrop in
   * each frame corner — the final frames must be 100% content.
   *
   * Rebuilds the screen (and glass) geometry, which is cheap for the ~20
   * frames an ending transition spans; an unchanged scale is a no-op, so a
   * look that never touches it costs nothing. A no-op before the first
   * render() or after destroy().
   *
   * @param {number} scale - 0..1 (clamped; a non-finite value means 1)
   */
  function setScreenCorners(scale) {
    const next = Math.min(1, Math.max(0, Number.isFinite(scale) ? scale : 1))
    if (!cornerMeshes.length || next === cornerScale) return
    cornerScale = next
    const stale = cornerGeometries
    cornerGeometries = cornerMeshes.map(({ mesh, width, height, radius }) => {
      const geometry = buildScreenGeometry(width, height, radius, next)
      mesh.geometry = geometry
      return geometry
    })
    for (const geometry of stale) geometry.dispose()
    if (renderer && scene && camera) renderer.render(scene, camera)
  }

  /**
   * Marks the external screen texture dirty and renders one frame — call
   * after drawing a new frame onto the canvas passed to setScreenSource().
   * Safe no-op before setScreenSource()/render() or after destroy().
   */
  function updateScreen() {
    if (!renderer || !scene || !camera || !externalCanvas || !screenMaterial) return
    if (screenIsBrowserDevice || !externalScreenTexture) {
      applyExternalScreenSource()
    } else {
      externalScreenTexture.needsUpdate = true
    }
    renderer.render(scene, camera)
  }

  function destroy() {
    disposeBuild()
    buildGen += 1
    envRenderTarget?.dispose()
    pmremGenerator?.dispose()
    if (renderer) {
      renderer.dispose()
      if (renderer.domElement.parentNode === containerEl) {
        containerEl.removeChild(renderer.domElement)
      }
    }
    renderer = null
    pmremGenerator = null
    envRenderTarget = null
    scene = null
    camera = null
    deviceGroup = null
    layerGroups = []
    lidGroup = null
    cameraFrameLayout = null
    screenMaterial = null
    screenComposeDims = null
    externalScreenTexture = null
  }

  return { render, setPose, setCamera, setScreenSource, setScreenCorners, updateScreen, destroy }
}
