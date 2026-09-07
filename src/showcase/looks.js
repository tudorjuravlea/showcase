// Showcase choreography — pure, no DOM. See
// docs/superpowers/specs/2026-09-04-showcase-design.md §2 ("Choreography").
// Every look is a function of (t, ctx) -> {pose, camera, screen?}: `t` is 0..1
// progress across the showcase's output duration, `pose` is a full
// glRenderer setPose() pose, `camera` is a full glRenderer setCamera() rig,
// and the optional `screen` carries per-frame screen state (currently just
// `cornerScale` for glRenderer's setScreenCorners()).
// Must not import React or touch the DOM — src/showcase/runtime.js is the
// only caller, and this module is also unit-tested directly (tests/looks.test.js).

import { EASINGS } from '../core/timeline.js'

// All pose/camera magnitudes below share the existing app's scale
// conventions (src/core/presets.js's FLOAT_TRANSLATE_AMPLITUDE=10,
// HOVER_TILT_MAX_DEG=15) and glRenderer's own cam.distance convention
// (1 = default framing, 0.35 ~= close-up — see setCamera's doc comment).
// Tuned by eye against e2e/fixtures/showcase-sample.mp4 (see
// .superpowers/sdd/2026-09-04-showcase/screenshots/t2-*.png) — nudge these
// rather than the shot logic below if a look needs to read differently.
const HERO_ROTATE_X = -6
const HERO_ROTATE_Y = 24
const DEFAULT_LID_ANGLE = 110
const HERO_DISTANCE = 1

const FLOAT_ROTATE_Y_AMPLITUDE = 4
const FLOAT_ROTATE_X_AMPLITUDE = 2
const FLOAT_TRANSLATE_Y_AMPLITUDE = 8

const PUSH_IN_START_DISTANCE = 1.3
const PUSH_IN_FRACTION = 0.4 // fraction of the look's duration spent settling in

const CLOSE_UP_START_DISTANCE = 0.35
const CLOSE_UP_START_U = 0.2
const CLOSE_UP_START_V = 0.25

const ORBIT_ROTATE_Y_AMPLITUDE = 35
const ORBIT_ROTATE_X_AMPLITUDE = 6
const ORBIT_DRIFT_AMPLITUDE = 0.15

const FLAT_ROTATE_X = -78
const FLAT_START_DISTANCE = 1.15

const RISE_START_TRANSLATE_Y = 320
const RISE_START_DISTANCE = 0.7
const RISE_START_ROTATE_Y_FRACTION = 0.3

const ACTION_ZOOM_DEFAULT = 0.4

// reference: replicates the reference recording's own choreography,
// frame-by-frame keyframed against the source clip (see
// docs/superpowers/specs/2026-09-04-showcase-design.md; keyframes were
// nudged by comparing re-rendered frames against the source). targetU stays 0.5 throughout — the source never pans
// horizontally, only zooms and tilts. Deliberately NOT loop-closed: unlike
// every other look, the clip ends zoomed all the way in on the screen — the
// whole of it, edge to edge — rather than pulling back to a hero frame.
//
// `distance` is either a plain number or one of the symbolic framing bounds
// resolved per device/aspect at runtime (see resolveDistance): the reference
// obeys a strict rule — the device is either fully inside the frame
// horizontally (exiting only top/bottom) or past full-bleed — and its close-up
// beats sit exactly ON that boundary, which is a different number for every
// device. Naming the bound rather than a number is what keeps those beats
// framed like the source instead of slicing the metal band.
const REFERENCE_BASE_KEYFRAMES = [
  { t: 0.0, rotateY: -14, rotateX: 4, distance: 0.95, targetV: 0.45 },
  { t: 0.14, rotateY: -10, rotateX: 6, distance: 0.9, targetV: 0.5 },
  // Close-up beats: device edge-to-edge, framed vertically by targetV alone
  // (the reference's own close-ups keep BOTH side edges visible).
  { t: 0.22, rotateY: -8, rotateX: 10, distance: 'fit', targetV: 0.72 },
  { t: 0.36, rotateY: -4, rotateX: 10, distance: 'fit', targetV: 0.7 },
  { t: 0.48, rotateY: 6, rotateX: 14, distance: 'fit', factor: 1.09, targetV: 0.35 },
  { t: 0.62, rotateY: -3, rotateX: 3, distance: 1.05, targetV: 0.5 },
  { t: 0.76, rotateY: -2, rotateX: 1, distance: 'fit', targetV: 0.5 },
]

// --- The ending: hold, square the corners, then SNAP in --------------------
//
// The ending framing is EXACTLY screen-fit. The output frame's aspect equals
// the device SCREEN's aspect (see bin/showcase.mjs's outputDimensions /
// src/render/webgl/layout.js's screenAspect), so at `screenFit` the screen's
// full rect is inscribed in the frame on both axes at once: 100% of the screen
// is visible and uncropped and the metal band stays outside the frame
// entirely. `bleed` (an older ending) is defined on the screen's INSCRIBED
// rect, so it cropped a uniform ~6.5% off every side.
//
// How it gets there is the point of everything below. `fit` -> `screenFit` is
// only a ~4% change in distance, and constrainCameraDistance forbids every
// distance strictly between them (the two-state lateral-fit rule), so that
// last step can only ever be a CUT — it cannot be eased through. Left as a
// long ease (it used to run t 0.76 -> 0.88, i.e. 4.7s on a 39s clip) the
// visible result was a slow drift pinned at `fit` and then an unexplained
// one-frame jump wherever the interpolation happened to cross the rule's
// midpoint. Instead:
//
//   1. hold the pre-ending framing (`fit`) for as long as it takes to settle
//      dead-frontal (rotation to exactly 0, micro-float faded out),
//   2. square the screen's corners over one snap-span while still held,
//   3. PUNCH in — a fast ease-out past the ending framing into the legal
//      frontal band below `screenFit` (the cut to screenFit happens inside
//      this move, buried under it), then
//   4. settle back out onto `screenFit` and hold there.
//
// The snap's span is derived from ctx.duration so its REAL time is the same
// (~0.6s) whatever the clip length — a fraction-of-the-timeline span would be
// 4.7s on a 39s clip and 0.5s on a 4s one.
const REFERENCE_ENDING_T = 0.88 // the snap lands here; [it, 1] is a dead hold
const REFERENCE_SNAP_SECONDS = 0.6
// Fraction-of-timeline floor/ceiling for that real-time span. The ceiling also
// keeps the whole ending (corner-square span + snap span) clear of the t=0.76
// close-up beat; the floor only guards against a degenerate zero-length span.
const REFERENCE_SNAP_MIN_SPAN = 0.004
const REFERENCE_SNAP_MAX_SPAN = 0.06
// Earliest the corner-squaring (and so the frontal settle before it) may
// start, whatever the snap span works out to. On a short clip the span hits
// its ceiling and `snapStart - span` would land on the t=0.76 beat itself,
// collapsing the rotation's ease-to-frontal into a zero-length segment.
const REFERENCE_CORNER_START_FLOOR = 0.8
// How much of the snap is the punch-in; the rest is the settle back out.
const REFERENCE_SNAP_PUNCH_FRACTION = 0.35
// How far past `screenFit` the punch goes, as a fraction of it. Legal ground:
// at a frontal pose everything in (bleed, screenFit] passes
// constrainCameraDistance untouched (bleed is ~6.6% below screenFit for a
// phone, so 1.5% is comfortably inside). The corners are still ROUNDED during
// the punch (Tudor: they disappear AFTER the snap lands, not before), so the
// over-fill briefly shows smaller corner wedges — intended.
const REFERENCE_SNAP_OVERSHOOT = 0.015
// The corner melt runs AFTER the snap has landed and held for a beat: a short
// hold at screenFit with the rounded corners visible, then the mask squares
// off over the melt span — the device reads as "snapping in", THEN dissolving
// into pure content. Real-time seconds, clamped like the snap span.
const REFERENCE_CORNER_HOLD_SECONDS = 0.15
const REFERENCE_CORNER_MELT_SECONDS = 0.35
const REFERENCE_CORNER_MELT_LAST_T = 0.96 // melt completes before the final hold — and, on short clips, before the LAST RENDERED FRAME (a 4s/12fps clip's final frame sits at t~0.98; a later cap left corners never fully square there)

/**
 * The snap's span as a fraction of the timeline, so that it lasts
 * REFERENCE_SNAP_SECONDS of real time on a clip of `duration` seconds.
 * @param {number} [duration] - seconds
 * @returns {number}
 */
export function referenceSnapSpan(duration) {
  if (!(duration > 0)) return REFERENCE_SNAP_MAX_SPAN
  return Math.min(REFERENCE_SNAP_MAX_SPAN, Math.max(REFERENCE_SNAP_MIN_SPAN, REFERENCE_SNAP_SECONDS / duration))
}

/**
 * Where the ending's frontal settle + corner-squaring begins: one snap span
 * before the snap, floored (see REFERENCE_CORNER_START_FLOOR).
 * @param {number} [duration] - seconds
 * @returns {number}
 */
export function referenceCornerStart(duration) {
  const span = referenceSnapSpan(duration)
  return Math.max(REFERENCE_CORNER_START_FLOOR, REFERENCE_ENDING_T - 2 * span)
}

/**
 * [meltStart, meltEnd] — where the post-snap corner melt runs (timeline t).
 * Starts a short real-time hold after the snap lands at REFERENCE_ENDING_T,
 * ends a real-time melt later, clamped so it completes before the final hold.
 * @param {number} [duration] - seconds
 * @returns {{meltStart: number, meltEnd: number}}
 */
export function referenceCornerMelt(duration) {
  const seconds = duration > 0 ? duration : 10
  const holdSpan = Math.min(0.04, REFERENCE_CORNER_HOLD_SECONDS / seconds)
  const meltSpan = Math.min(0.08, Math.max(0.008, REFERENCE_CORNER_MELT_SECONDS / seconds))
  const meltStart = Math.min(REFERENCE_ENDING_T + holdSpan, REFERENCE_CORNER_MELT_LAST_T - meltSpan)
  return { meltStart, meltEnd: meltStart + meltSpan }
}

/**
 * The reference look's keyframes for a clip of `duration` seconds — the fixed
 * beats above plus the duration-dependent ending (see the block comment).
 * `cornerScale` (1 = the screen's authored corner radius, 0 = square) rides
 * along as a third channel next to pose and camera.
 * @param {number} [duration] - seconds
 * @returns {object[]}
 */
export function referenceKeyframes(duration) {
  const span = referenceSnapSpan(duration)
  const snapStart = REFERENCE_ENDING_T - span
  const cornerStart = referenceCornerStart(duration)
  const melt = referenceCornerMelt(duration)
  const frontal = { rotateY: 0, rotateX: 0, targetV: 0.5 }
  return [
    ...REFERENCE_BASE_KEYFRAMES,
    // Settled dead-frontal and still at `fit`: screenFit is only a legal
    // distance while the pose is within FRONTAL_POSE_EPSILON_DEG (see
    // constrainCameraDistance's frontal exemption), so the rotation has to be
    // 0 — and the micro-float faded out — BEFORE the snap, not during it.
    { t: cornerStart, ...frontal, distance: 'fit', cornerScale: 1 },
    // The snap runs with the corners still ROUNDED (Tudor's spec: the corners
    // disappear after the screen snaps into place, not before) — the landed
    // frame briefly shows the corner roundings, like a real phone filling
    // your view, before the melt below squares them off.
    { t: snapStart, ...frontal, distance: 'fit', cornerScale: 1 },
    // The punch, on a fast ease-out.
    { t: snapStart + span * REFERENCE_SNAP_PUNCH_FRACTION, ...frontal, distance: 'screen-fit', factor: 1 - REFERENCE_SNAP_OVERSHOOT, cornerScale: 1, ease: 'snap' },
    // ...and the settle onto the bound itself (plain ease-in-out: the punch's
    // ease-out already arrives with ~zero velocity, so the reversal is smooth).
    { t: REFERENCE_ENDING_T, ...frontal, distance: 'screen-fit', factor: 1, cornerScale: 1 },
    // Landed and held for a beat — THEN the rounded mask melts to square and
    // the frame becomes pure rectangular content for the rest of the hold.
    { t: melt.meltStart, ...frontal, distance: 'screen-fit', factor: 1, cornerScale: 1 },
    { t: melt.meltEnd, ...frontal, distance: 'screen-fit', factor: 1, cornerScale: 0 },
    { t: 1.0, ...frontal, distance: 'screen-fit', factor: 1, cornerScale: 0 },
  ]
}

// Sitting exactly ON a framing bound leaves nothing in hand: the bound is a
// function of the pose (src/showcase/runtime.js recomputes it every frame), so
// the micro-float below would keep shifting the screen — coverage still holds,
// but the ending visibly swims instead of holding still. Worse, a residual
// tilt past FRONTAL_POSE_EPSILON_DEG would make the ending distance illegal
// outright. So the float fades out over the whole run-in to the ending — from
// the last wide beat to `cornerStart` — leaving the pose dead-on for the snap
// itself and for everything after it. Starting at the WIDE beat rather than
// the t=0.76 one keeps the fade window comfortably long even on a short clip,
// where the snap span hits its ceiling and cornerStart its floor.
const REFERENCE_FLOAT_FADE_START = 0.62
// Fast ease-out (ease-out-quint) for the punch: ~83% of the move is spent in
// the first half of it, which is what makes the snap read as decisive rather
// than as a glide. EASINGS' own 'ease-out' is quadratic — too soft here — and
// its 'spring' overshoots on its own, which would fight the authored one.
const snapEase = (p) => 1 - (1 - p) ** 5
// Framing bounds used when a caller drives looks without them (unit tests,
// any non-showcase consumer) — the phone-portrait values distanceBounds()
// resolves, so symbolic keyframes still produce sane framing standalone.
// These are the pixelSizeMode 'exact' values for the showcase pipeline's own
// frame, which is now the SCREEN-aspect one (1080x2352 for a phone portrait,
// see bin/showcase.mjs's outputDimensions) rather than the old 16:9-derived
// 1080x1920 — a narrower frame needs less pull-back, so the bounds rose from
// 0.5967/0.5345 back to roughly the pre-'exact' numbers.
const DEFAULT_BOUNDS = { fit: 0.7294, screenFit: 0.7007, bleed: 0.6547 }
// Micro-float overlay strength for the reference look — kept subtle so the
// dwell beats stay alive without fighting the deliberate keyframed moves.
const REFERENCE_FLOAT_SCALE = 0.3

// auto-action's between-segments pull-back beat (spec: "pull back + rotate slightly en route to
// next"). A gap counts as "meaningful" once it exceeds this fraction of the total duration —
// touching/adjacent segments (gap <= threshold, including gap 0) keep the direct pan instead.
const ACTION_PULLBACK_GAP_FRACTION = 0.08
const ACTION_PULLBACK_DISTANCE = 0.85
const ACTION_PULLBACK_ROTATE_Y = 10 // alternates sign per transition

// Reserved head/tail of the timeline that no segment stop may enter, so the
// video always opens wide and eases in (rather than cutting straight to a
// close-up when a segment starts at t0=0) and always pulls back to the hero
// ending (rather than freezing on a close-up when a segment runs to the very
// end). Segment stop times are clamped into [LEAD_IN, 1 - TAIL].
const ACTION_LEAD_IN_FRACTION = 0.08
const ACTION_TAIL_FRACTION = 0.12
// Two stops sharing a time make a zero-length, undefined-direction span;
// nudging later collisions forward by this much keeps every span positive
// while staying far below one output frame at any sane fps/duration.
const ACTION_STOP_EPSILON = 1e-4

// a*(1-p) + b*p rather than a + (b-a)*p so lerp(a, b, 1) is exactly b — see
// src/core/presets.js's own lerp for the same reasoning (exactness matters
// for the closure/keyframe assertions in tests/looks.test.js).
function lerp(a, b, p) {
  return a * (1 - p) + b * p
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value))
}

// Resolves a keyframe's `distance` — a plain number, or one of the symbolic
// 'fit' / 'screen-fit' / 'bleed' framing bounds (optionally scaled by the
// keyframe's `factor`) from ctx.bounds, i.e.
// src/render/webgl/glRenderer.js's distanceBounds().
function resolveDistance(keyframe, bounds) {
  if (typeof keyframe.distance === 'number') return keyframe.distance
  const resolved = bounds || DEFAULT_BOUNDS
  let bound
  if (keyframe.distance === 'bleed') bound = resolved.bleed
  else if (keyframe.distance === 'screen-fit') bound = resolved.screenFit
  else bound = resolved.fit
  return bound * (keyframe.factor ?? 1)
}

// Keeps an auto-action segment stop out of the reserved lead-in/tail beats.
function clampInner(time) {
  return Math.min(1 - ACTION_TAIL_FRACTION, Math.max(ACTION_LEAD_IN_FRACTION, time))
}

// Keeps an auto-action segment's dwell distance out of the lateral-fit
// forbidden zone (see resolveDistance's doc comment / constrainCameraDistance
// in glRenderer.js). Activity zooms are free reals chosen by whatever fed
// ctx.activity — nothing stops one landing right at the fit/bleed midpoint,
// where the driver's own hysteresis only slows a flip down rather than
// ruling it out (the reference look's authored keyframes avoid the zone by
// construction; auto-action's don't). Snapping here means a held dwell never
// sits near the midpoint in the first place. No-op without ctx.bounds (unit
// tests driving looks directly, or any caller that doesn't have bounds yet).
function clampZoomToBounds(zoom, bounds) {
  if (!bounds) return zoom
  if (zoom >= bounds.fit || zoom <= bounds.bleed) return zoom
  const midpoint = (bounds.fit + bounds.bleed) / 2
  return zoom >= midpoint ? bounds.fit : bounds.bleed
}

function basePose(overrides = {}) {
  return {
    rotateX: 0,
    rotateY: 0,
    rotateZ: 0,
    translateX: 0,
    translateY: 0,
    translateZ: 0,
    scale: 1,
    explode: 0,
    lidAngle: DEFAULT_LID_ANGLE,
    ...overrides,
  }
}

function baseCamera(overrides = {}) {
  return { distance: 1, targetU: 0.5, targetV: 0.5, driftX: 0, driftY: 0, ...overrides }
}

// hero-drift: 3/4 tilt, slow float + slight rotation, gentle push-in then
// settle. Default look for image content; also the auto-action fallback.
function heroDrift(t) {
  const settle = EASINGS['ease-out'](clamp01(t / PUSH_IN_FRACTION))
  const distance = lerp(PUSH_IN_START_DISTANCE, HERO_DISTANCE, settle)

  const floatPhase = t * Math.PI * 2
  const floatRotateY = Math.sin(floatPhase) * FLOAT_ROTATE_Y_AMPLITUDE
  const floatRotateX = Math.cos(floatPhase) * FLOAT_ROTATE_X_AMPLITUDE
  const floatTranslateY = Math.sin(floatPhase * 0.8 + 1) * FLOAT_TRANSLATE_Y_AMPLITUDE

  return {
    pose: basePose({
      rotateX: HERO_ROTATE_X + floatRotateX,
      rotateY: HERO_ROTATE_Y + floatRotateY,
      translateY: floatTranslateY,
    }),
    camera: baseCamera({ distance }),
  }
}

// close-up-pan: start tight on a screen corner, slow pull-back + pan to full
// hero framing.
function closeUpPan(t) {
  const ease = EASINGS['ease-in-out'](t)
  const distance = lerp(CLOSE_UP_START_DISTANCE, HERO_DISTANCE, ease)
  const targetU = lerp(CLOSE_UP_START_U, 0.5, ease)
  const targetV = lerp(CLOSE_UP_START_V, 0.5, ease)

  const floatPhase = t * Math.PI * 2
  return {
    pose: basePose({
      rotateX: HERO_ROTATE_X + Math.cos(floatPhase) * (FLOAT_ROTATE_X_AMPLITUDE * 0.5),
      rotateY: HERO_ROTATE_Y + Math.sin(floatPhase) * (FLOAT_ROTATE_Y_AMPLITUDE * 0.5),
    }),
    camera: baseCamera({ distance, targetU, targetV }),
  }
}

// orbit-loop: seamless slow orbit. Built entirely from a single t*2*PI
// trig phase so frame(0) and frame(1) land on the same sin/cos values —
// loopable by construction, not by special-casing the endpoints.
function orbitLoop(t) {
  const angle = t * Math.PI * 2
  return {
    pose: basePose({
      rotateX: HERO_ROTATE_X + Math.sin(angle) * ORBIT_ROTATE_X_AMPLITUDE,
      rotateY: Math.sin(angle) * ORBIT_ROTATE_Y_AMPLITUDE,
    }),
    camera: baseCamera({
      distance: HERO_DISTANCE,
      driftX: Math.cos(angle) * ORBIT_DRIFT_AMPLITUDE,
      driftY: Math.sin(angle) * ORBIT_DRIFT_AMPLITUDE * 0.4,
    }),
  }
}

// flat-lay-rise: flat under an overhead camera, rises/tilts to hero angle.
// "Overhead" is played by tilting the device itself near-flat (rotateX close
// to -90) rather than moving the camera, matching how every other look
// stages its shot through pose + cam.distance/targetU/V alone.
function flatLayRise(t) {
  const ease = EASINGS['ease-in-out'](t)
  const rotateX = lerp(FLAT_ROTATE_X, HERO_ROTATE_X, ease)
  const rotateY = lerp(0, HERO_ROTATE_Y, ease)
  const distance = lerp(FLAT_START_DISTANCE, HERO_DISTANCE, ease)

  return {
    pose: basePose({ rotateX, rotateY }),
    camera: baseCamera({ distance }),
  }
}

// hero-rise: device enters from bottom of frame, camera zooms out, settles
// to hero. translateY is positive (moves the device down/off-frame — see
// glRenderer's applyPose, which negates translateY into world Y) and large
// at t=0, easing to 0 by t=1.
function heroRise(t) {
  const ease = EASINGS['ease-out'](t)
  const translateY = lerp(RISE_START_TRANSLATE_Y, 0, ease)
  const distance = lerp(RISE_START_DISTANCE, HERO_DISTANCE, ease)
  const rotateY = lerp(HERO_ROTATE_Y * RISE_START_ROTATE_Y_FRACTION, HERO_ROTATE_Y, ease)

  return {
    pose: basePose({ rotateX: HERO_ROTATE_X, rotateY, translateY }),
    camera: baseCamera({ distance }),
  }
}

// auto-action: consumes ctx.activity (segments of on-screen action,
// [{t0,t1,u,v,zoom}] in ctx.duration seconds) — camera eases to each
// segment's (u,v,zoom), dwells across [t0,t1], eases toward the next
// segment (or back to full hero after the last one). Falls back to
// hero-drift when there's no activity to react to.
function autoAction(t, ctx) {
  const activity = ctx?.activity
  if (!activity || activity.length === 0) {
    return heroDrift(t, ctx)
  }

  const duration = ctx.duration > 0 ? ctx.duration : 1
  const sorted = [...activity].sort((a, b) => a.t0 - b.t0)

  const stops = [{ time: 0, targetU: 0.5, targetV: 0.5, distance: HERO_DISTANCE, rotateYNudge: 0 }]
  let pullbackCount = 0
  for (let i = 0; i < sorted.length; i++) {
    const segment = sorted[i]
    const rawZoom = typeof segment.zoom === 'number' ? segment.zoom : ACTION_ZOOM_DEFAULT
    const zoom = clampZoomToBounds(rawZoom, ctx?.bounds)
    const target = { targetU: segment.u, targetV: segment.v, distance: zoom, rotateYNudge: 0 }
    stops.push({ time: clampInner(segment.t0 / duration), ...target })
    stops.push({ time: clampInner(segment.t1 / duration), ...target })

    // Between two activity segments with a meaningful gap, pull back to a wider framing with a
    // slight device rotation (spec's reference-video beat) rather than panning straight across
    // while staying zoomed in. Adjacent/touching segments (gap <= threshold) keep the direct pan.
    const next = sorted[i + 1]
    if (next && next.t0 - segment.t1 > duration * ACTION_PULLBACK_GAP_FRACTION) {
      const sign = pullbackCount % 2 === 0 ? 1 : -1
      stops.push({
        time: clampInner((segment.t1 + next.t0) / 2 / duration),
        targetU: 0.5,
        targetV: 0.5,
        distance: ACTION_PULLBACK_DISTANCE,
        rotateYNudge: sign * ACTION_PULLBACK_ROTATE_Y,
      })
      pullbackCount++
    }
  }
  stops.push({ time: 1, targetU: 0.5, targetV: 0.5, distance: HERO_DISTANCE, rotateYNudge: 0 })
  stops.sort((a, b) => a.time - b.time)
  // Separate colliding stops. The two hero stops (index 0 at time 0, last at
  // time 1) are already out of reach of the clamped segment stops, so only the
  // interior ones can collide and only they get nudged.
  for (let i = 1; i < stops.length - 1; i++) {
    if (stops[i].time <= stops[i - 1].time) stops[i].time = stops[i - 1].time + ACTION_STOP_EPSILON
  }

  let camFrame = stops[stops.length - 1]
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]
    const b = stops[i + 1]
    if (t >= a.time && t <= b.time) {
      const span = b.time - a.time
      const p = span > 0 ? EASINGS['ease-in-out']((t - a.time) / span) : 1
      camFrame = {
        targetU: lerp(a.targetU, b.targetU, p),
        targetV: lerp(a.targetV, b.targetV, p),
        distance: lerp(a.distance, b.distance, p),
        rotateYNudge: lerp(a.rotateYNudge, b.rotateYNudge, p),
      }
      break
    }
  }

  const floatPhase = t * Math.PI * 2
  return {
    pose: basePose({
      rotateX: HERO_ROTATE_X + Math.cos(floatPhase) * (FLOAT_ROTATE_X_AMPLITUDE * 0.4),
      rotateY: HERO_ROTATE_Y + Math.sin(floatPhase) * (FLOAT_ROTATE_Y_AMPLITUDE * 0.4) + camFrame.rotateYNudge,
    }),
    camera: baseCamera({ targetU: camFrame.targetU, targetV: camFrame.targetV, distance: camFrame.distance }),
  }
}

// reference: interpolates REFERENCE_KEYFRAMES with ease-in-out, overlaying
// the same micro-float used elsewhere (scaled down — see
// REFERENCE_FLOAT_SCALE) so dwell beats stay alive.
function reference(t, ctx) {
  const clamped = clamp01(t)
  const keyframes = referenceKeyframes(ctx?.duration)
  let a = keyframes[0]
  let b = keyframes[keyframes.length - 1]
  for (let i = 0; i < keyframes.length - 1; i++) {
    if (clamped >= keyframes[i].t && clamped <= keyframes[i + 1].t) {
      a = keyframes[i]
      b = keyframes[i + 1]
      break
    }
  }
  const span = b.t - a.t
  // The segment's easing is named by the keyframe it ENDS on ('snap' = the
  // punch-in), defaulting to the ease-in-out every authored beat uses.
  const ease = b.ease === 'snap' ? snapEase : EASINGS['ease-in-out']
  const p = span > 0 ? ease((clamped - a.t) / span) : 1

  // Symbolic bounds resolve to numbers first, so a keyframe pair can mix a
  // literal distance with a bound and still interpolate linearly.
  const distance = lerp(resolveDistance(a, ctx?.bounds), resolveDistance(b, ctx?.bounds), p)
  // Screen-space wobble scales ~1/distance under perspective, so a fixed
  // float amplitude reads ~3x larger at the full-bleed ending than at the
  // wide open (0.95). Scaling by distance keeps the perceived drift constant.
  // On top of that it fades to zero before the snap — see
  // REFERENCE_FLOAT_FADE_START. ease-in-out flattens at both ends, so the
  // fade neither jerks when it starts nor leaves a residue when it lands.
  const floatPhase = t * Math.PI * 2
  const fadeEnd = referenceCornerStart(ctx?.duration)
  const fadeSpan = Math.max(1e-6, fadeEnd - REFERENCE_FLOAT_FADE_START)
  const fade = 1 - EASINGS['ease-in-out'](clamp01((clamped - REFERENCE_FLOAT_FADE_START) / fadeSpan))
  const floatScale = REFERENCE_FLOAT_SCALE * distance * fade
  const floatRotateY = Math.sin(floatPhase) * FLOAT_ROTATE_Y_AMPLITUDE * floatScale
  const floatRotateX = Math.cos(floatPhase) * FLOAT_ROTATE_X_AMPLITUDE * floatScale

  return {
    pose: basePose({
      rotateX: lerp(a.rotateX, b.rotateX, p) + floatRotateX,
      rotateY: lerp(a.rotateY, b.rotateY, p) + floatRotateY,
    }),
    camera: baseCamera({
      distance,
      targetV: lerp(a.targetV, b.targetV, p),
    }),
    // Third channel (see referenceKeyframes): the screen's corner radius,
    // squared off across the hold that precedes the snap so the final frames
    // are 100% content, corners included.
    screen: { cornerScale: clamp01(lerp(a.cornerScale ?? 1, b.cornerScale ?? 1, p)) },
  }
}

export const LOOKS = {
  'hero-drift': heroDrift,
  'close-up-pan': closeUpPan,
  'orbit-loop': orbitLoop,
  'flat-lay-rise': flatLayRise,
  'hero-rise': heroRise,
  'auto-action': autoAction,
  reference,
}

/**
 * @param {keyof typeof LOOKS} name
 * @param {number} t - 0..1 progress across the showcase's output duration
 * @param {{duration?: number, activity?: {t0: number, t1: number, u: number, v: number, zoom?: number}[], bounds?: {fit: number, bleed: number}}} [ctx]
 *   `bounds` (see distanceBounds()) resolves symbolic keyframe distances;
 *   omitted, DEFAULT_BOUNDS stands in. `duration` (seconds) also sets the
 *   reference look's snap span, so its ending is equally fast on any clip.
 * @returns {{pose: object, camera: object, screen?: {cornerScale: number}}}
 *   `screen` is optional — only the reference look drives it (see
 *   referenceKeyframes); a look that omits it leaves the screen's corner
 *   radius alone (cornerScale 1).
 */
export function lookFrame(name, t, ctx = {}) {
  const look = LOOKS[name] || LOOKS['hero-drift']
  return look(t, ctx)
}
