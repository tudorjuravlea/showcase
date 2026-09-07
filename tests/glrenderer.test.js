// @vitest-environment jsdom
//
// glLayout is pure geometry-spec math — no WebGL context needed, so it's
// unit-tested directly. createGlRenderer needs a real WebGL context (only
// available in a real browser), so it's covered by Playwright (see
// e2e/editor.spec.js, e2e/export.spec.js, and e2e/matrix.spec.js) — except
// the unknown-device rejection below, which is checked before any WebGL
// context is created and so is safe to assert here too.
import { describe, it, expect } from 'vitest'
import { DEVICES } from '../src/core/devices.js'
import { defaultScene, mergeScene } from '../src/core/scene.js'
import {
  cameraLayout,
  constrainCameraDistance,
  constrainCameraDistanceContained,
  createGlRenderer,
  distanceBounds,
  DEFAULT_FRAME_FINISH,
  fitPixelSize,
  FRAME_FINISHES,
  glBandChamfer,
  glBezelScale,
  glBodyThickness,
  glLayout,
  sideButtonSpecs,
  layerBaseZ,
  lidRotationX,
  lidTiltCompensationDeg,
  laptopDeckPitchDeg,
  poseToEuler,
  remapShapeUVs,
  screenCornerRadius,
  buildScreenGeometry,
  resolveFrameFinish,
  resolvePixelSize,
  screenAspect,
  screenPlaneLayout,
  UnsupportedDeviceError,
} from '../src/render/webgl/glRenderer.js'
import * as layout from '../src/render/webgl/layout.js'
import * as THREE from 'three'

const DEG = Math.PI / 180

// glLayout/glBezelScale/screenAspect now live in the THREE-free
// src/render/webgl/layout.js (so bin/showcase.mjs can import them from Node)
// and are re-exported by glRenderer.js. Pin that the re-export is the same
// function, not a copy — this file, and every other importer, still goes
// through glRenderer.js.
describe('layout.js re-exports', () => {
  it('glRenderer re-exports the layout module verbatim', () => {
    expect(glLayout).toBe(layout.glLayout)
    expect(glBezelScale).toBe(layout.glBezelScale)
    expect(screenAspect).toBe(layout.screenAspect)
  })

  it('screenAspect is glLayout\'s screen rect ratio, by name or by spec', () => {
    const screen = glLayout(DEVICES.phone, 'portrait').screen
    expect(screenAspect('phone', 'portrait')).toBeCloseTo(screen.width / screen.height, 12)
    expect(screenAspect(DEVICES.phone, 'portrait')).toBe(screenAspect('phone', 'portrait'))
  })

  it('screenAspect rejects an unknown device', () => {
    expect(() => screenAspect('toaster', 'portrait')).toThrow(/toaster/)
  })
})

describe('glLayout', () => {
  it('returns overall dims matching deviceDims (portrait)', () => {
    const layout = glLayout(DEVICES.phone, 'portrait')
    expect(layout.width).toBe(DEVICES.phone.width)
    expect(layout.height).toBe(DEVICES.phone.height)
  })

  it('swaps overall dims in landscape for an orientable device', () => {
    const layout = glLayout(DEVICES.phone, 'landscape')
    expect(layout.width).toBe(DEVICES.phone.height)
    expect(layout.height).toBe(DEVICES.phone.width)
  })

  it('does not swap dims for laptop regardless of orientation', () => {
    const layout = glLayout(DEVICES.laptop, 'landscape')
    expect(layout.width).toBe(DEVICES.laptop.width)
    expect(layout.height).toBe(DEVICES.laptop.height)
  })

  it('body dims match the device outer dims and corner radius', () => {
    const layout = glLayout(DEVICES.tablet, 'portrait')
    expect(layout.body).toEqual({
      width: DEVICES.tablet.width,
      height: DEVICES.tablet.height,
      radius: DEVICES.tablet.cornerRadius,
    })
  })

  // GL-only bezel tightening (glBezelScale) shrinks phone's inset below the
  // raw DEVICES bezel — see that export's own doc comment for why (the
  // thicker GL body makes the untouched DEVICES bezel read as an oversized
  // margin next to the reference hardware's thin, uniform bezel).
  it('screen dims are inset from the body by the device bezel, scaled by glBezelScale for GL geometry', () => {
    const layout = glLayout(DEVICES.phone, 'portrait')
    const { bezel } = DEVICES.phone
    const scale = glBezelScale('phone')
    expect(scale).toBeLessThan(1) // this device's inset is genuinely tightened, not left as-is
    expect(layout.screen.width).toBeCloseTo(DEVICES.phone.width - bezel.left * scale - bezel.right * scale)
    expect(layout.screen.height).toBeCloseTo(DEVICES.phone.height - bezel.top * scale - bezel.bottom * scale)
    expect(layout.screen.radius).toBe(DEVICES.phone.screenRadius)
  })

  it('screen offset is centered (zero) when the bezel is symmetric', () => {
    // phone bezel: left === right (8), top === bottom (14)
    const layout = glLayout(DEVICES.phone, 'portrait')
    expect(layout.screen.offsetX).toBe(0)
    expect(layout.screen.offsetY).toBe(0)
  })

  it('screen offset shifts toward the thinner bezel when the bezel is asymmetric', () => {
    // laptop bezel: top 20, bottom 14 -> screen shifts down (negative Y, away
    // from the wider top bezel), left === right so offsetX stays 0.
    const layout = glLayout(DEVICES.laptop, 'portrait')
    const { bezel } = DEVICES.laptop
    expect(layout.screen.offsetX).toBe(0)
    expect(layout.screen.offsetY).toBe((bezel.bottom - bezel.top) / 2)
    expect(layout.screen.offsetY).toBeLessThan(0)
  })
})

describe('layerBaseZ', () => {
  // Scene units: the device specs are px-ish and glRenderer scales them by
  // UNIT = 0.01, so layer depths 0/4/8/12 land at 0/0.04/0.08/0.12.
  it('mirrors the CSS renderer layer depths, scaled into scene units', () => {
    expect([0, 1, 2, 3].map((i) => layerBaseZ(DEVICES.phone, i))).toEqual([0, 0.04, 0.08, 0.12])
  })

  it('puts the screen plane in front of the body slab\'s front face (C2: no occlusion at explode=0)', () => {
    // buildFrameMesh extrudes the body with thickness BODY_THICKNESS * 0.9 =
    // 0.054, centered on its own Z, so its front face is half a thickness
    // ahead of its layer Z.
    const bodyFrontFace = layerBaseZ(DEVICES.phone, 1) + (0.06 * 0.9) / 2
    const screenZ = layerBaseZ(DEVICES.phone, 2)
    expect(screenZ).toBeGreaterThan(bodyFrontFace)
    // ...and the glass sits ahead of the screen in turn.
    expect(layerBaseZ(DEVICES.phone, 3)).toBeGreaterThan(screenZ)
  })

  it('is strictly increasing back -> front for every device', () => {
    for (const device of Object.values(DEVICES)) {
      const zs = device.layers.map((_, i) => layerBaseZ(device, i))
      for (let i = 1; i < zs.length; i += 1) {
        expect(zs[i]).toBeGreaterThan(zs[i - 1])
      }
    }
  })
})

describe('poseToEuler', () => {
  // CSS 3D has Y pointing down the screen; THREE has Y up. So a positive CSS
  // rotateX (top edge tips AWAY from the viewer) is a NEGATIVE THREE
  // rotation.x, and likewise for Z. rotateY is the same sign in both.
  it('negates rotateX so +30deg tips the top edge away from the viewer in both renderers', () => {
    expect(poseToEuler({ rotateX: 30, rotateY: 0, rotateZ: 0 }).x).toBeCloseTo(-30 * DEG)
  })

  it('negates rotateZ so +30deg turns clockwise on screen in both renderers', () => {
    expect(poseToEuler({ rotateX: 0, rotateY: 0, rotateZ: 30 }).z).toBeCloseTo(-30 * DEG)
  })

  it('keeps rotateY unchanged (both systems rotate +Z toward +X)', () => {
    expect(poseToEuler({ rotateX: 0, rotateY: 30, rotateZ: 0 }).y).toBeCloseTo(30 * DEG)
  })

  it('maps the identity pose to zero rotation', () => {
    const euler = poseToEuler({ rotateX: 0, rotateY: 0, rotateZ: 0 })
    expect(euler.x).toBeCloseTo(0)
    expect(euler.y).toBeCloseTo(0)
    expect(euler.z).toBeCloseTo(0)
  })
})

describe('lidRotationX', () => {
  it('is zero when the lid is vertical (90deg), matching the CSS rotateX(lidAngle - 90)', () => {
    expect(lidRotationX(90)).toBeCloseTo(0)
  })

  it('tips the lid top AWAY from the viewer at the default 110deg, like the CSS renderer', () => {
    // The lid group's local Y is positive (up, THREE's Y-up convention)
    // where the CSS layout's is negative (Y-down), so this is the exact
    // negation of the CSS renderer's rotateX(lidAngle - 90) = +20deg —
    // the same flip poseToEuler applies. See tests/cssrenderer.test.js for
    // the parity assertion across the whole lidAngle range.
    expect(lidRotationX(DEVICES.laptop.lidAngle)).toBeCloseTo(-20 * DEG)
    expect(lidRotationX(110)).toBeLessThan(0)
  })

  it('tips the lid top TOWARD the viewer below 90deg (folding down to the base)', () => {
    expect(lidRotationX(0)).toBeCloseTo(90 * DEG)
  })
})

describe('lidTiltCompensationDeg', () => {
  it('is zero when the lid is vertical (90deg), nothing to cancel', () => {
    expect(lidTiltCompensationDeg(90)).toBe(0)
  })

  it('exactly cancels lidRotationX at the default 110deg lid angle', () => {
    // applyPose()/distanceBounds() add this (in degrees, poseToEuler's own
    // sign convention) to the device group's rotation on top of lidRotationX
    // (in radians, THREE's own convention): net zero tilt means the two, in
    // a shared unit, sum to zero.
    const lidAngle = DEVICES.laptop.lidAngle
    expect(lidTiltCompensationDeg(lidAngle) * DEG + lidRotationX(lidAngle)).toBeCloseTo(0)
  })

  it('is a pure function of lidAngle alone, unaffected by pose rotation', () => {
    expect(lidTiltCompensationDeg(110)).toBe(20)
    expect(lidTiltCompensationDeg(130)).toBe(40)
  })
})

// The laptop-only hero pitch, see glRenderer.js's own doc comment for why it
// has to fade to exactly 0 at a dead-frontal pose (rotateX 0, rotateY 0): the
// reference look's ending settles there, and any residual tilt would break
// the exact screen-fit ending.
describe('laptopDeckPitchDeg', () => {
  it('is exactly zero at a dead-frontal pose', () => {
    expect(laptopDeckPitchDeg(0, 0)).toBe(0)
  })

  it('is positive once the pose tilts away from frontal', () => {
    expect(laptopDeckPitchDeg(4, 0)).toBeGreaterThan(0)
    expect(laptopDeckPitchDeg(0, -10)).toBeGreaterThan(0)
  })

  it('saturates at a fixed magnitude for a large tilt, unbounded further growth', () => {
    const atRamp = laptopDeckPitchDeg(6, 0)
    const wellPast = laptopDeckPitchDeg(30, 0)
    expect(wellPast).toBeCloseTo(atRamp)
  })

  it('is continuous: no jump between a tiny tilt and exactly zero', () => {
    const tiny = laptopDeckPitchDeg(0.01, 0)
    expect(tiny).toBeGreaterThan(0)
    expect(tiny).toBeLessThan(0.1)
  })

  it('takes the larger tilt magnitude of rotateX/rotateY', () => {
    expect(laptopDeckPitchDeg(1, -5)).toBe(laptopDeckPitchDeg(5, 0))
  })
})

describe('createGlRenderer', () => {
  it('throws UnsupportedDeviceError for a genuinely unknown device string, without creating a WebGL context', () => {
    const container = document.createElement('div')
    const renderer = createGlRenderer(container)
    const scene = mergeScene(defaultScene(), { device: 'not-a-real-device', renderer: 'webgl' })

    expect(() => renderer.render(scene)).toThrow(UnsupportedDeviceError)
    // No WebGL canvas should have been created for a device we reject.
    expect(container.querySelector('canvas')).toBeNull()
  })

  it('matches the {render, setPose, setCamera, setScreenSource, updateScreen, destroy} contract shape', () => {
    const renderer = createGlRenderer(document.createElement('div'))
    expect(typeof renderer.render).toBe('function')
    expect(typeof renderer.setPose).toBe('function')
    expect(typeof renderer.setCamera).toBe('function')
    expect(typeof renderer.setScreenSource).toBe('function')
    expect(typeof renderer.updateScreen).toBe('function')
    expect(typeof renderer.destroy).toBe('function')
  })

  // setCamera/setScreenSource/updateScreen must tolerate being called before
  // the first render() (no WebGL context, no built scene yet) and after
  // destroy() — neither path should ever reach a WebGL call in that state,
  // so this is safe to assert under jsdom (no real WebGL context available;
  // see this file's header comment).
  it('setCamera and updateScreen are safe no-ops before any render()', () => {
    const renderer = createGlRenderer(document.createElement('div'))
    expect(() => renderer.setCamera({ distance: 0.5, targetU: 0.2 })).not.toThrow()
    expect(() => renderer.updateScreen()).not.toThrow()
  })

  it('setScreenSource does not throw when called before any render()', () => {
    const renderer = createGlRenderer(document.createElement('div'))
    const canvas = document.createElement('canvas')
    expect(() => renderer.setScreenSource(canvas)).not.toThrow()
  })

  it('updateScreen is a safe no-op after destroy()', () => {
    const renderer = createGlRenderer(document.createElement('div'))
    const canvas = document.createElement('canvas')
    renderer.setScreenSource(canvas)
    renderer.destroy()
    expect(() => renderer.updateScreen()).not.toThrow()
  })

  // The live screen texture is held in a single slot outside the build's
  // disposables array (updateScreen may replace it every exported frame, so
  // pushing each replacement would grow the array for the life of a build).
  // jsdom can't create a WebGL build, so the growth guarantee is structural;
  // what IS observable here: swapping and detaching sources never throws.
  it('setScreenSource tolerates repeated swaps and a null detach', () => {
    const renderer = createGlRenderer(document.createElement('div'))
    for (let i = 0; i < 3; i += 1) {
      expect(() => renderer.setScreenSource(document.createElement('canvas'))).not.toThrow()
    }
    expect(() => renderer.setScreenSource(null)).not.toThrow()
    expect(() => renderer.updateScreen()).not.toThrow()
  })
})

// cameraLayout is the pure math behind setCamera() — see glRenderer.js's doc
// comment on the export. layout is a screenPlaneLayout()-shaped object;
// these tests use a synthetic one so the math is exercised independently of
// any real device's numbers.
describe('cameraLayout', () => {
  const layout = { distance: 10, width: 4, height: 2, offsetX: 0, offsetY: 0, offsetZ: 0 }

  it('defaults to the base distance, centered on the screen plane', () => {
    const { position, lookAt } = cameraLayout({}, layout)
    expect(position).toEqual([0, 0, 10])
    expect(lookAt).toEqual([0, 0, 0])
  })

  it('distance multiplies the base framing distance (0.35 = close-up, 2 = pulled back)', () => {
    expect(cameraLayout({ distance: 0.35 }, layout).position[2]).toBeCloseTo(3.5)
    expect(cameraLayout({ distance: 2 }, layout).position[2]).toBeCloseTo(20)
  })

  it('targetU 0 vs 1 moves both lookAt and position across the full screen width', () => {
    const left = cameraLayout({ targetU: 0 }, layout)
    const right = cameraLayout({ targetU: 1 }, layout)
    expect(right.lookAt[0] - left.lookAt[0]).toBeCloseTo(layout.width)
    expect(right.position[0] - left.position[0]).toBeCloseTo(layout.width)
  })

  it('targetV 0 (top) sits above targetV 1 (bottom) by the full screen height', () => {
    const top = cameraLayout({ targetV: 0 }, layout)
    const bottom = cameraLayout({ targetV: 1 }, layout)
    expect(top.lookAt[1]).toBeGreaterThan(bottom.lookAt[1]) // top = +Y, world up
    expect(top.lookAt[1] - bottom.lookAt[1]).toBeCloseTo(layout.height)
  })

  it('drift offsets the camera position only — lookAt is unaffected', () => {
    const base = cameraLayout({}, layout)
    const drifted = cameraLayout({ driftX: 0.2, driftY: -0.1 }, layout)
    expect(drifted.lookAt).toEqual(base.lookAt)
    expect(drifted.position[0] - base.position[0]).toBeCloseTo(0.2)
    expect(drifted.position[1] - base.position[1]).toBeCloseTo(-0.1)
    expect(drifted.position[2]).toBeCloseTo(base.position[2])
  })

  it('anchors both position and lookAt at a nonzero screen-plane offset', () => {
    const offsetLayout = { distance: 5, width: 2, height: 1, offsetX: 0.3, offsetY: -0.2, offsetZ: 0.05 }
    const { position, lookAt } = cameraLayout({}, offsetLayout)
    expect(lookAt).toEqual([0.3, -0.2, 0.05])
    expect(position).toEqual([0.3, -0.2, 5.05])
  })
})

// screenPlaneLayout feeds cameraLayout()'s `layout` argument from a real
// device spec — see its doc comment in glRenderer.js.
describe('screenPlaneLayout', () => {
  it('is flat (offsetZ 0) and screen-centered for a symmetric-bezel device (phone)', () => {
    const layout = screenPlaneLayout(DEVICES.phone, 'portrait')
    expect(layout.offsetX).toBe(0)
    expect(layout.offsetY).toBe(0)
    expect(layout.offsetZ).toBe(0)
    // UNIT = 0.01 (glRenderer.js) — matches glLayout's screen rect scaled down.
    const glScreen = glLayout(DEVICES.phone, 'portrait').screen
    expect(layout.width).toBeCloseTo(glScreen.width * 0.01)
    expect(layout.height).toBeCloseTo(glScreen.height * 0.01)
  })

  it('tips the laptop screen away from the camera (negative Z) at its default lidAngle', () => {
    const layout = screenPlaneLayout(DEVICES.laptop, 'landscape')
    expect(layout.offsetZ).toBeLessThan(0)
  })
})

// Regression cover for the v2 final review's C2: media export used to size
// the offscreen canvas to the device's nominal layout and blit it 1:1 onto
// an ever-larger output canvas, so 2x/3x stills were the same render with
// more empty margin (and their resolution depended on the exporting
// machine's devicePixelRatio). fitPixelSize is what lets the offscreen
// renderer rasterise at the export's own resolution instead.
describe('fitPixelSize', () => {
  it('scales a portrait layout UP to fill the cap, preserving aspect ratio', () => {
    const size = fitPixelSize({ width: 300, height: 650 }, { width: 1056, height: 792 })
    expect(size.height).toBe(792) // height-bound
    expect(size.width / size.height).toBeCloseTo(300 / 650, 2)
    expect(size.width).toBeGreaterThan(300) // genuinely upscaled, not clamped at 1x
  })

  it('doubles the drawing buffer when the cap doubles — the 1x vs 2x export invariant', () => {
    const layout = { width: 300, height: 650 }
    const at1x = fitPixelSize(layout, { width: 1056, height: 792 })
    const at2x = fitPixelSize(layout, { width: 2112, height: 1584 })
    expect(at2x.width / at1x.width).toBeCloseTo(2, 1)
    expect(at2x.height / at1x.height).toBeCloseTo(2, 1)
  })

  it('scales down when the cap is smaller than the layout (gif/mp4 preview sizes)', () => {
    const size = fitPixelSize({ width: 300, height: 650 }, { width: 282, height: 211 })
    expect(size.height).toBe(211)
    expect(size.width).toBe(97)
  })
})

// The showcase pipeline's exact-frame mode (see resolvePixelSize's doc
// comment): the drawing buffer IS the requested output frame, so the camera
// composes against the real 1080-wide frame instead of an aspect-fit 886-wide
// sub-rect that ffmpeg then pads with two background pillars.
describe('resolvePixelSize', () => {
  const PHONE = { width: 300, height: 650 }

  it("'exact' gives the requested output dims verbatim for a phone in 1080x1920", () => {
    expect(resolvePixelSize(PHONE, { width: 1080, height: 1920 }, 'exact')).toEqual({ width: 1080, height: 1920 })
  })

  it("'exact' rounds to even dims (yuv420p) and never returns 0", () => {
    expect(resolvePixelSize(PHONE, { width: 1081, height: 1919 }, 'exact')).toEqual({ width: 1082, height: 1920 })
    expect(resolvePixelSize(PHONE, { width: 0, height: 0 }, 'exact')).toEqual({ width: 2, height: 2 })
  })

  it("defaults to 'fit' — media.js's captureStill/captureFrames contract is untouched", () => {
    const box = { width: 1080, height: 1920 }
    expect(resolvePixelSize(PHONE, box)).toEqual(fitPixelSize(PHONE, box))
    expect(resolvePixelSize(PHONE, box, 'fit')).toEqual(fitPixelSize(PHONE, box))
    // ...and that fit really is the narrower, letterboxed buffer this fix removes.
    expect(fitPixelSize(PHONE, box).width).toBeLessThan(1080)
  })
})

// Frame finish lookup/validation for scene.style.frame — see FRAME_FINISHES'
// doc comment. gold is the default, matching the reference recording.
describe('resolveFrameFinish', () => {
  it('resolves each known finish name to its own FRAME_FINISHES entry', () => {
    for (const name of Object.keys(FRAME_FINISHES)) {
      expect(resolveFrameFinish(name)).toBe(FRAME_FINISHES[name])
    }
  })

  it('falls back to the default gold finish for an unknown name', () => {
    expect(resolveFrameFinish('rose-gold')).toBe(FRAME_FINISHES[DEFAULT_FRAME_FINISH])
  })

  it('falls back to the default gold finish when no name is given', () => {
    expect(resolveFrameFinish(undefined)).toBe(FRAME_FINISHES.gold)
  })

  it('every finish is a plausible polished metal (metalness/roughness in spec range)', () => {
    for (const finish of Object.values(FRAME_FINISHES)) {
      expect(finish.metalness).toBeGreaterThanOrEqual(0.9)
      expect(finish.metalness).toBeLessThanOrEqual(1)
      expect(finish.roughness).toBeGreaterThanOrEqual(0.2)
      expect(finish.roughness).toBeLessThanOrEqual(0.3)
    }
  })
})

// GL-side thickness/inset derivation — see each export's own doc comment in
// glRenderer.js for why these exist (a thicker, flat metal-reading body
// band, and a bezel tightened to match).
describe('glBodyThickness', () => {
  it('phone is ~5.6x the original 0.9*BODY_THICKNESS body depth', () => {
    expect(glBodyThickness('phone')).toBeCloseTo(0.06 * 0.9 * 5.6)
  })

  // The reason for that number: a real phone's side band is ~11% of its
  // width, which is what puts a 5-7%-of-width band on screen at a 20-30deg
  // tilt (the reference mockups' look). The phone body is 3.0 scene units
  // wide.
  it('puts the phone band at roughly a real phone\'s share of the body width', () => {
    const share = glBodyThickness('phone') / (DEVICES.phone.width * 0.01)
    expect(share).toBeGreaterThan(0.09)
    expect(share).toBeLessThan(0.13)
  })

  it('tablet and browser grow by the same 5.6x as phone', () => {
    const phone = glBodyThickness('phone')
    const tablet = glBodyThickness('tablet')
    const browser = glBodyThickness('browser')
    expect(tablet).toBeCloseTo(phone)
    expect(browser).toBeCloseTo(phone)
  })

  it('laptop is untouched (out of scope for this pass)', () => {
    expect(glBodyThickness('laptop')).toBeCloseTo(0.06 * 0.9)
  })

  it('an unlisted device name falls back to the untouched depth', () => {
    expect(glBodyThickness('not-a-device')).toBeCloseTo(0.06 * 0.9)
  })
})

// The chamfer lines that make the band's thickness read under light, and the
// constraint that keeps them from eating the bezel — see glBandChamfer.
describe('glBandChamfer', () => {
  it('is a narrow fraction of the band, leaving most of it flat', () => {
    const flat = glBodyThickness('phone') - glBandChamfer('phone') * 2
    expect(glBandChamfer('phone')).toBeGreaterThan(0)
    expect(flat / glBodyThickness('phone')).toBeGreaterThan(0.7)
  })

  it('stays inside the GL bezel margin, so the front cap keeps its dark ring', () => {
    // The chamfer insets the front cap by exactly its own depth per side; the
    // screen plane floating in front of it is inset by the GL-scaled bezel. If
    // the chamfer were the wider of the two, the screen would overhang the cap.
    for (const name of ['phone', 'tablet']) {
      const device = DEVICES[name]
      const bezel = Math.min(device.bezel.left, device.bezel.right, device.bezel.top, device.bezel.bottom)
      expect(glBandChamfer(name)).toBeLessThan(bezel * glBezelScale(name) * 0.01)
    }
  })

  it('is zero for a device whose body was never thickened (laptop keeps its sharp extrusion)', () => {
    expect(glBandChamfer('laptop')).toBe(0)
    expect(glBandChamfer('not-a-device')).toBe(0)
  })
})

// Side buttons — placement only (the meshes themselves need a WebGL context;
// see e2e/matrix.spec.js for the render-side coverage).
describe('sideButtonSpecs', () => {
  const bandFor = (name) => ({
    thickness: glBodyThickness(name),
    chamfer: glBandChamfer(name),
    frontOffset: (0.06 * 0.9) / 2,
  })
  const specsFor = (name, orientation = 'portrait') =>
    sideButtonSpecs(glLayout(DEVICES[name], orientation), name, bandFor(name))

  it('gives the phone one power button and two volume pills', () => {
    const specs = specsFor('phone')
    expect(specs.map((s) => s.id)).toEqual(['power', 'volume-up', 'volume-down'])
    const power = specs.find((s) => s.id === 'power')
    const volume = specs.filter((s) => s.id !== 'power')
    // Power is the longer one, and the two volume pills share a side opposite it.
    expect(power.length).toBeGreaterThan(volume[0].length)
    expect(volume.every((s) => s.side === -power.side)).toBe(true)
    expect(volume[0].length).toBeCloseTo(volume[1].length)
  })

  it('puts every button on a side face, in the upper half of the body', () => {
    const layoutSpec = glLayout(DEVICES.phone, 'portrait')
    const halfWidth = (layoutSpec.body.width * 0.01) / 2
    for (const spec of specsFor('phone')) {
      expect(Math.abs(spec.x)).toBeCloseTo(halfWidth)
      expect(spec.y).toBeGreaterThan(0)
      // ...and clear of the corner arc, where the side face curves away.
      expect(spec.y + spec.length / 2).toBeLessThan((layoutSpec.body.height * 0.01) / 2 - DEVICES.phone.cornerRadius * 0.01)
    }
  })

  it('keeps each button inside the flat part of the band (never clipping a chamfer)', () => {
    const band = bandFor('phone')
    const flatFront = band.frontOffset - band.chamfer
    const flatBack = band.frontOffset - band.thickness + band.chamfer
    for (const spec of specsFor('phone')) {
      expect(spec.z + spec.depth / 2).toBeLessThanOrEqual(flatFront)
      expect(spec.z - spec.depth / 2).toBeGreaterThanOrEqual(flatBack)
      // Proud of the band, but only slightly.
      expect(spec.protrusion).toBeGreaterThan(0)
      expect(spec.protrusion).toBeLessThan(band.thickness / 4)
    }
  })

  it('is empty for devices without hardware buttons (browser, laptop)', () => {
    expect(specsFor('browser')).toEqual([])
    expect(specsFor('laptop')).toEqual([])
  })

  it('follows the body dims, so a tablet gets proportionally placed buttons', () => {
    const specs = specsFor('tablet')
    const tabletHeight = glLayout(DEVICES.tablet, 'portrait').body.height * 0.01
    expect(specs).toHaveLength(3)
    for (const spec of specs) expect(spec.y / tabletHeight).toBeLessThan(0.5)
  })
})

describe('glBezelScale', () => {
  it('phone and tablet are tightened below 1', () => {
    expect(glBezelScale('phone')).toBeLessThan(1)
    expect(glBezelScale('tablet')).toBeLessThan(1)
  })

  it('laptop and browser are untouched (scale 1)', () => {
    expect(glBezelScale('laptop')).toBe(1)
    expect(glBezelScale('browser')).toBe(1)
  })
})

// remapShapeUVs is the fix for ShapeGeometry's shape-space UVs (see its own
// doc comment) — tested against a plain square Shape so the math is
// verified independently of roundedRectShape's corner curves.
describe('remapShapeUVs', () => {
  function squareShapeGeometry(size) {
    const half = size / 2
    const shape = new THREE.Shape()
    shape.moveTo(-half, -half)
    shape.lineTo(half, -half)
    shape.lineTo(half, half)
    shape.lineTo(-half, half)
    shape.closePath()
    return new THREE.ShapeGeometry(shape)
  }

  it('maps the shape-space bounding box corners to the 0..1 UV corners', () => {
    const geometry = squareShapeGeometry(2) // spans [-1, 1] on both axes
    remapShapeUVs(geometry, 2, 2)
    const uv = geometry.attributes.uv
    const uMin = Math.min(...Array.from({ length: uv.count }, (_, i) => uv.getX(i)))
    const uMax = Math.max(...Array.from({ length: uv.count }, (_, i) => uv.getX(i)))
    const vMin = Math.min(...Array.from({ length: uv.count }, (_, i) => uv.getY(i)))
    const vMax = Math.max(...Array.from({ length: uv.count }, (_, i) => uv.getY(i)))
    expect(uMin).toBeCloseTo(0)
    expect(uMax).toBeCloseTo(1)
    expect(vMin).toBeCloseTo(0)
    expect(vMax).toBeCloseTo(1)
  })

  it('keeps v growing up (top of the shape -> v=1), matching PlaneGeometry\'s convention', () => {
    const geometry = squareShapeGeometry(2)
    remapShapeUVs(geometry, 2, 2)
    const position = geometry.attributes.position
    const uv = geometry.attributes.uv
    for (let i = 0; i < position.count; i += 1) {
      const y = position.getY(i)
      const v = uv.getY(i)
      if (y > 0) expect(v).toBeCloseTo(1)
      if (y < 0) expect(v).toBeCloseTo(0)
    }
  })

  it('returns the same geometry instance (chainable)', () => {
    const geometry = squareShapeGeometry(2)
    expect(remapShapeUVs(geometry, 2, 2)).toBe(geometry)
  })
})

// The screen's corner radius is animated per frame by setScreenCorners (the
// showcase ending squares it off so the final frames hold no backdrop in their
// corners). setScreenCorners itself needs a WebGL context, but the geometry it
// rebuilds is pure — that half is checked here.
describe('screenCornerRadius / buildScreenGeometry', () => {
  it('scales the authored radius, 1 = as authored and 0 = square', () => {
    expect(screenCornerRadius(0.3, 3, 6, 1)).toBeCloseTo(0.3, 12)
    expect(screenCornerRadius(0.3, 3, 6, 0.5)).toBeCloseTo(0.15, 12)
    expect(screenCornerRadius(0.3, 3, 6, 0)).toBe(0)
    expect(screenCornerRadius(0.3, 3, 6)).toBeCloseTo(0.3, 12) // scale defaults to 1
  })

  it('clamps to half the shorter side, and clamps the scale itself to 0..1', () => {
    expect(screenCornerRadius(10, 3, 6, 1)).toBe(1.5)
    expect(screenCornerRadius(0.3, 3, 6, 4)).toBeCloseTo(0.3, 12)
    expect(screenCornerRadius(0.3, 3, 6, -1)).toBe(0)
    expect(screenCornerRadius(-0.3, 3, 6, 1)).toBe(0)
  })

  it('builds a rounded ShapeGeometry at scale 1 and a plain rectangle at scale 0', () => {
    const rounded = buildScreenGeometry(3, 6, 0.3, 1)
    const square = buildScreenGeometry(3, 6, 0.3, 0)
    expect(rounded.attributes.position.count).toBeGreaterThan(square.attributes.position.count)
    expect(square.attributes.position.count).toBe(4) // PlaneGeometry
    // A square screen reaches its own bounding box; a rounded one cannot.
    const extent = (geometry, axis) =>
      Math.max(...Array.from({ length: geometry.attributes.position.count }, (_, i) => Math.abs(geometry.attributes.position[axis](i))))
    expect(extent(square, 'getX')).toBeCloseTo(1.5, 10)
    expect(extent(square, 'getY')).toBeCloseTo(3, 10)
    // Both are UV-mapped over the full 0..1 square, so the content doesn't
    // shift or rescale when the corners change mid-animation.
    for (const geometry of [rounded, square]) {
      const uv = geometry.attributes.uv
      const us = Array.from({ length: uv.count }, (_, i) => uv.getX(i))
      const vs = Array.from({ length: uv.count }, (_, i) => uv.getY(i))
      expect(Math.min(...us)).toBeCloseTo(0, 6)
      expect(Math.max(...us)).toBeCloseTo(1, 6)
      expect(Math.min(...vs)).toBeCloseTo(0, 6)
      expect(Math.max(...vs)).toBeCloseTo(1, 6)
    }
  })

  it('is a plain rectangle for a device with no corner radius at all', () => {
    expect(buildScreenGeometry(4, 2, 0, 1).attributes.position.count).toBe(4)
  })
})

// distanceBounds is analytic (see its doc comment); these tests re-derive the
// same framing with an actual THREE.PerspectiveCamera built exactly the way
// createGlRenderer's render() builds it, and check where the device's own
// geometry lands in NDC — |x| = 1 being the frame edge. That keeps the closed
// form honest against the renderer it claims to model.
const UNIT_SCALE = 0.01
const INSET = 1 - Math.SQRT1_2

function frameCamera(deviceName, orientation, cam, aspect) {
  const device = DEVICES[deviceName]
  const layout = glLayout(device, orientation)
  // Default aspect = the device layout's own, i.e. the aspect-fit ('fit')
  // pixelSize path. Pass an explicit aspect to model an 'exact'-mode buffer
  // (the showcase runtime's, e.g. 1080/1920), where the frame is genuinely
  // wider than the device.
  const camera = new THREE.PerspectiveCamera(30, aspect ?? layout.width / layout.height, 0.01, 100)
  const baseDistance = ((layout.height * UNIT_SCALE) / 2 / Math.tan(15 * DEG)) * 1.4
  const { position, lookAt } = cameraLayout(cam, { distance: baseDistance, ...screenPlaneLayout(device, orientation) })
  camera.position.set(...position)
  camera.lookAt(...lookAt)
  camera.updateMatrixWorld()
  return camera
}

// Mirrors applyPose()'s pivot-preserving rotation for a laptop (see
// lidTiltCompensationDeg's doc comment): rotates `point` around the screen's
// own center (cameraFrameLayout's anchor, i.e. screenPlaneLayout itself)
// instead of the origin, so it lands where the actual render puts it (the
// same rotation applies to every deviceGroup child, body included, not just
// the screen). A no-op for every other device (no lidAngle).
function posedPoint(deviceName, orientation, point) {
  const spec = DEVICES[deviceName]
  if (spec.lidAngle == null) return point
  const screen = screenPlaneLayout(spec, orientation)
  const devEuler = new THREE.Euler(lidTiltCompensationDeg(spec.lidAngle) * DEG, 0, 0)
  const pivot = new THREE.Vector3(screen.offsetX, screen.offsetY, screen.offsetZ)
  const rotatedPivot = pivot.clone().applyEuler(devEuler)
  return point.applyEuler(devEuler).add(pivot).sub(rotatedPivot)
}

// NDC x of the device body's own side edge, at the frontmost layer's Z (the
// widest thing the frame can slice).
function bodyEdgeNdcX(deviceName, orientation, cam, aspect) {
  const device = DEVICES[deviceName]
  const layout = glLayout(device, orientation)
  const point = posedPoint(
    deviceName,
    orientation,
    new THREE.Vector3((layout.width * UNIT_SCALE) / 2, 0, layerBaseZ(device, device.layers.length - 1)),
  )
  return point.project(frameCamera(deviceName, orientation, cam, aspect)).x
}

// NDC of the screen plane's corner-radius-inset corner — the point that has
// to sit outside the frame for the screen to cover it.
function screenCornerNdc(deviceName, orientation, cam, aspect) {
  const device = DEVICES[deviceName]
  const layout = glLayout(device, orientation)
  const screen = screenPlaneLayout(device, orientation)
  const inset = layout.screen.radius * UNIT_SCALE * INSET
  const point = new THREE.Vector3(
    screen.offsetX + screen.width / 2 - inset,
    screen.offsetY + screen.height / 2 - inset,
    screen.offsetZ
  )
  return point.project(frameCamera(deviceName, orientation, cam, aspect))
}

describe('distanceBounds', () => {
  const view = { viewportW: 1080, viewportH: 1920 }
  const CASES = [
    ['phone', 'portrait'],
    ['phone', 'landscape'],
    ['tablet', 'portrait'],
    ['tablet', 'landscape'],
    ['browser', 'portrait'],
    ['laptop', 'portrait'],
  ]

  it('puts a portrait phone\'s fit below the default framing distance', () => {
    const bounds = distanceBounds({ device: 'phone', orientation: 'portrait', ...view })
    expect(bounds.fit).toBeLessThan(1)
    expect(bounds.fit).toBeGreaterThan(0.7) // distance 1 frames with a 40% margin
  })

  it.each(CASES)('%s/%s: the screen is smaller than the body, so bleed < fit', (device, orientation) => {
    const bounds = distanceBounds({ device, orientation, ...view })
    expect(bounds.bleed).toBeGreaterThan(0)
    expect(bounds.bleed).toBeLessThan(bounds.fit)
    expect(bounds.bleed).toBe(Math.min(bounds.bleedU, bounds.bleedV))
  })

  it.each(CASES)('%s/%s: at fit the body edge is just inside the frame', (device, orientation) => {
    const { fit } = distanceBounds({ device, orientation, ...view })
    const ndc = bodyEdgeNdcX(device, orientation, { distance: fit })
    expect(ndc).toBeLessThanOrEqual(1)
    // Laptop excepted: its lid-tilt compensation (lidTiltCompensationDeg) is
    // baked into the device's own rotation even at this "unposed" pose, and
    // per the fit loop's own doc comment ("posed... swings the far end of
    // the device's LONG axis toward the camera") that moves fit's binding
    // corner off this flat mid-height edge: the widest point is now a lid
    // corner the compensating tilt swung toward the camera, same mechanic as
    // any other device's rotateX, just always-on for this one.
    if (device !== 'laptop') expect(ndc).toBeGreaterThan(0.98) // flush, not merely somewhere inside
  })

  it.each(CASES)('%s/%s: just under fit the body edge is outside the frame', (device, orientation) => {
    const { fit } = distanceBounds({ device, orientation, ...view })
    const ndc = bodyEdgeNdcX(device, orientation, { distance: fit * 0.97 })
    if (device !== 'laptop') expect(ndc).toBeGreaterThan(1) // see the previous test's laptop note
  })

  it.each(CASES)('%s/%s: at bleed the screen covers both frame axes', (device, orientation) => {
    const { bleed } = distanceBounds({ device, orientation, ...view })
    const ndc = screenCornerNdc(device, orientation, { distance: bleed })
    expect(ndc.x).toBeGreaterThanOrEqual(1)
    expect(ndc.y).toBeGreaterThanOrEqual(1)
    expect(Math.min(ndc.x, ndc.y)).toBeLessThan(1.05) // flush, not miles past
  })

  it.each(CASES)('%s/%s: just over bleed the screen stops covering', (device, orientation) => {
    const { bleed } = distanceBounds({ device, orientation, ...view })
    const ndc = screenCornerNdc(device, orientation, { distance: bleed * 1.04 })
    expect(Math.min(ndc.x, ndc.y)).toBeLessThan(1)
  })

  // rotateX swings the far end of the long axis toward the camera, where
  // perspective magnifies it past the flat width — the bound has to follow,
  // or the close-up beats slice the band (they did, measurably, before this).
  it('widens fit under a rotateX tilt', () => {
    const flat = distanceBounds({ device: 'phone', orientation: 'portrait', ...view })
    const tilted = distanceBounds({ device: 'phone', orientation: 'portrait', pose: { rotateX: 10 }, ...view })
    expect(tilted.fit).toBeGreaterThan(flat.fit * 1.02)

    // ...and at that widened distance the tilted body's near corner really is
    // inside the frame, where at the flat bound it is not.
    const layout = glLayout(DEVICES.phone, 'portrait')
    const euler = poseToEuler({ rotateX: 10, rotateY: 0, rotateZ: 0 })
    const corner = () =>
      new THREE.Vector3((layout.width * UNIT_SCALE) / 2, (-layout.height * UNIT_SCALE) / 2, layerBaseZ(DEVICES.phone, 3)).applyEuler(
        new THREE.Euler(euler.x, euler.y, euler.z)
      )
    expect(corner().project(frameCamera('phone', 'portrait', { distance: tilted.fit })).x).toBeLessThanOrEqual(1)
    expect(corner().project(frameCamera('phone', 'portrait', { distance: flat.fit })).x).toBeGreaterThan(1)
  })

  it('tightens bleed under rotation but leaves fit alone', () => {
    const flat = distanceBounds({ device: 'phone', orientation: 'portrait', ...view })
    const turned = distanceBounds({ device: 'phone', orientation: 'portrait', pose: { rotateY: 24 }, ...view })
    expect(turned.bleed).toBeLessThan(flat.bleed)
    // "Alone" to 4dp, not to machine precision: since the body band gained
    // real depth (glBodyThickness), a rotateY swings the slab's BACK corners
    // marginally wider than the unrotated silhouette, so fit does move — by
    // 0.005% at 24deg, which is a hundredth of the FIT_MARGIN safety nudge.
    // The point of the assertion is that fit is driven by the unrotated
    // width floor, not by the turn.
    expect(turned.fit).toBeCloseTo(flat.fit, 4)
    expect(turned.fit).toBeGreaterThanOrEqual(flat.fit)
  })

  it('accounts for a lateral translate in fit', () => {
    const centred = distanceBounds({ device: 'phone', orientation: 'portrait', ...view })
    const shoved = distanceBounds({ device: 'phone', orientation: 'portrait', pose: { translateX: 60 }, ...view })
    expect(shoved.fit).toBeGreaterThan(centred.fit)
    expect(bodyEdgeNdcX('phone', 'portrait', { distance: shoved.fit })).toBeLessThanOrEqual(1)
  })

  it('is independent of the output box, which only letterboxes the render rect', () => {
    const small = distanceBounds({ device: 'phone', orientation: 'portrait', viewportW: 540, viewportH: 960 })
    const big = distanceBounds({ device: 'phone', orientation: 'portrait', viewportW: 2160, viewportH: 3840 })
    expect(small.fit).toBeCloseTo(big.fit, 4)
    expect(small.bleed).toBeCloseTo(big.bleed, 4)
  })

  it('rejects an unknown device', () => {
    expect(() => distanceBounds({ device: 'toaster' })).toThrow(UnsupportedDeviceError)
  })

  // The showcase pipeline renders at pixelSizeMode 'exact' — the buffer IS the
  // output frame, whatever its aspect. These cases use a 16:9 1080x1920 frame,
  // which is wider than a phone layout, to pin the horizontal terms: every
  // horizontal bound has to be computed against the real frame, or 'bleed'
  // means "covers an 886-wide sub-rect" and the output keeps two background
  // pillars. (The showcase's own frame is now screen-aspect — see the
  // screen-aspect block below — but exact mode must be right for any aspect.)
  describe('pixelSizeMode: exact', () => {
    const exact = { viewportW: 1080, viewportH: 1920, pixelSizeMode: 'exact' }
    const EXACT_ASPECT = 1080 / 1920

    it('needs a closer camera than fit mode on both bounds — the frame is wider', () => {
      const fitMode = distanceBounds({ device: 'phone', orientation: 'portrait', ...view })
      const exactMode = distanceBounds({ device: 'phone', orientation: 'portrait', ...exact })
      expect(exactMode.fit).toBeLessThan(fitMode.fit)
      expect(exactMode.bleedU).toBeLessThan(fitMode.bleedU)
      // Vertical is untouched: the FOV is vertical, so only horizontal room grew.
      expect(exactMode.bleedV).toBeCloseTo(fitMode.bleedV, 10)
      expect(exactMode.vSpan).toBeCloseTo(fitMode.vSpan, 10)
      // ...and uSpan (the horizontal aim cost) follows the real frame, not the layout.
      expect(exactMode.uSpan).toBeLessThan(fitMode.uSpan)
    })

    it.each(CASES)('%s/%s: at bleed the screen covers the true 1080x1920 frame', (device, orientation) => {
      const { bleed } = distanceBounds({ device, orientation, ...exact })
      const ndc = screenCornerNdc(device, orientation, { distance: bleed }, EXACT_ASPECT)
      expect(ndc.x).toBeGreaterThanOrEqual(1)
      expect(ndc.y).toBeGreaterThanOrEqual(1)
      expect(Math.min(ndc.x, ndc.y)).toBeLessThan(1.05) // flush, not miles past
    })

    it.each(CASES)('%s/%s: at fit the body edge is flush with the true frame', (device, orientation) => {
      const { fit } = distanceBounds({ device, orientation, ...exact })
      const ndc = bodyEdgeNdcX(device, orientation, { distance: fit }, EXACT_ASPECT)
      expect(ndc).toBeLessThanOrEqual(1)
      // Laptop excepted, see the same-named test above.
      if (device !== 'laptop') expect(ndc).toBeGreaterThan(0.98)
    })

    // The defect this whole change exists to fix, in closed form: the fit-mode
    // bleed bound leaves the wider frame's left/right edges uncovered.
    it('the fit-mode bleed bound does NOT cover the exact frame (regression)', () => {
      const fitMode = distanceBounds({ device: 'phone', orientation: 'portrait', ...view })
      const ndc = screenCornerNdc('phone', 'portrait', { distance: fitMode.bleed }, EXACT_ASPECT)
      expect(ndc.x).toBeLessThan(1) // the background pillars, analytically
    })
  })

  // The showcase's real frame: --size on the short axis, the other axis from
  // the SCREEN's aspect (bin/showcase.mjs's outputDimensions). This is what
  // lets the reference look's ending sit exactly ON `bleed` with no overshoot.
  describe('screen-aspect frame (the showcase output frame)', () => {
    // Same derivation as outputDimensions, kept local so this file doesn't
    // import the CLI.
    const frameFor = (device, orientation, shortSide = 1080) => {
      const aspect = screenAspect(device, orientation)
      const even = (v) => Math.max(2, Math.round(v / 2) * 2)
      return orientation === 'portrait'
        ? { viewportW: even(shortSide), viewportH: even(shortSide / aspect), pixelSizeMode: 'exact' }
        : { viewportW: even(shortSide * aspect), viewportH: even(shortSide), pixelSizeMode: 'exact' }
    }

    it.each(CASES)('%s/%s: fit is still comfortably wider than bleed', (device, orientation) => {
      const b = distanceBounds({ device, orientation, ...frameFor(device, orientation) })
      expect(b.bleed).toBeGreaterThan(0)
      expect(b.bleed).toBeLessThan(b.fit)
      expect(b.bleed).toBe(Math.min(b.bleedU, b.bleedV))
    })

    // A laptop's screen quad isn't flat pre-pose like every other device's
    // (see glRenderer's screenPlaneLayout doc comment on tiltRad): a point at
    // Y-offset `deltaY` from the screen's own center sits `deltaY` further
    // around the lid's own fixed tilt too. Identity (deltaY untouched, Z
    // unchanged) for every other device, whose tiltRad is 0.
    const tiltedPoint = (spec, orientation, x, deltaY) => {
      const screen = screenPlaneLayout(spec, orientation)
      return new THREE.Vector3(
        x,
        screen.offsetY + deltaY * Math.cos(screen.tiltRad),
        screen.offsetZ + deltaY * Math.sin(screen.tiltRad),
      )
    }

    // The property the aspect match buys: at `bleed` the same fraction of the
    // screen is in frame horizontally and vertically, instead of one axis
    // being cropped much harder than the other to cover the other axis.
    // Measured at the true screen edge midpoints (not the corner-inset
    // corners, whose absolute inset is a different fraction of each axis).
    // posedPoint (module scope, see bodyEdgeNdcX above) applies the same
    // laptop pivot rotation applyPose() does, so this lands where the actual
    // render puts it.
    const edgeNdc = (device, orientation, cam, aspect) => {
      const spec = DEVICES[device]
      const screen = screenPlaneLayout(spec, orientation)
      const camera = frameCamera(device, orientation, cam, aspect)
      const right = posedPoint(device, orientation, tiltedPoint(spec, orientation, screen.offsetX + screen.width / 2, 0))
      const bottom = posedPoint(device, orientation, tiltedPoint(spec, orientation, screen.offsetX, -screen.height / 2))
      return { x: right.project(camera).x, y: Math.abs(bottom.project(camera).y) }
    }

    it.each(CASES)('%s/%s: at bleed the screen is cropped equally on both axes', (device, orientation) => {
      const frame = frameFor(device, orientation)
      const b = distanceBounds({ device, orientation, ...frame })
      const aspect = frame.viewportW / frame.viewportH
      const ndc = edgeNdc(device, orientation, { distance: b.bleed }, aspect)
      // Both past the frame edge (the screen covers it) by the same small margin.
      expect(ndc.x).toBeGreaterThan(1)
      expect(ndc.y).toBeGreaterThan(1)
      expect(ndc.x).toBeLessThan(1.09) // ~93% of the screen in frame
      expect(Math.abs(ndc.x / ndc.y - 1)).toBeLessThan(0.005)
    })

    it('phone portrait: the values looks.js DEFAULT_BOUNDS mirrors', () => {
      const b = distanceBounds({ device: 'phone', orientation: 'portrait', ...frameFor('phone', 'portrait') })
      expect(b.fit).toBeCloseTo(0.7294, 4)
      expect(b.screenFit).toBeCloseTo(0.7007, 4)
      expect(b.bleed).toBeCloseTo(0.6547, 4)
    })

    // screenFit is the ending framing: the whole screen in frame, uncropped.
    it.each(CASES)('%s/%s: screenFit sits between bleed and fit', (device, orientation) => {
      const b = distanceBounds({ device, orientation, ...frameFor(device, orientation) })
      expect(b.screenFit).toBeGreaterThan(b.bleed)
      expect(b.screenFit).toBeLessThan(b.fit)
    })

    it.each(CASES)('%s/%s: at screenFit the WHOLE screen is in frame, flush', (device, orientation) => {
      const frame = frameFor(device, orientation)
      const b = distanceBounds({ device, orientation, ...frame })
      const aspect = frame.viewportW / frame.viewportH
      // The true screen edge midpoints (not the corner-inset corners): at
      // screenFit neither may be past the frame edge — that would be a crop —
      // and at least one must be flush against it.
      const ndc = edgeNdc(device, orientation, { distance: b.screenFit }, aspect)
      expect(ndc.x).toBeLessThanOrEqual(1 + 1e-9)
      expect(ndc.y).toBeLessThanOrEqual(1 + 1e-9)
      expect(Math.max(ndc.x, ndc.y)).toBeGreaterThan(1 - 1e-9)
      // ...and with the frame aspect matched to the screen's, BOTH axes land
      // flush at once, including laptop: with its lid-tilt cancelled (see
      // lidTiltCompensationDeg) its screen is coplanar with the frame just
      // like every other device's.
      expect(Math.abs(ndc.x / ndc.y - 1)).toBeLessThan(0.002)
    })

    it('phone portrait: screenFit is the per-axis max of the FULL rect, no margin', () => {
      const frame = frameFor('phone', 'portrait')
      const b = distanceBounds({ device: 'phone', orientation: 'portrait', ...frame })
      const screen = screenPlaneLayout(DEVICES.phone, 'portrait')
      const aspect = frame.viewportW / frame.viewportH
      // Closed form, independent of distanceBounds' own loop. The FOV cancels
      // out of the camera the renderer builds: half the frame's height at the
      // screen plane is tan(fov/2) * baseDistance = tan(fov/2) *
      // (worldH/2/tan(fov/2)) * 1.4, i.e. 0.7 * worldH whatever the FOV is.
      const worldH = glLayout(DEVICES.phone, 'portrait').height * 0.01
      const ky = 0.7 * worldH
      const kx = ky * aspect
      expect(b.screenFit).toBeCloseTo(Math.max(screen.width / 2 / kx, screen.height / 2 / ky), 9)
      // Strictly larger than bleed, which is the same rect minus the corner
      // inset and minus BLEED_MARGIN.
      expect(b.screenFit / b.bleed).toBeGreaterThan(1.05)
    })
  })

  it('reports the pose tilt as the largest rotation magnitude', () => {
    const at = (pose) => distanceBounds({ device: 'phone', orientation: 'portrait', pose }).poseTiltDeg
    expect(at(null)).toBe(0)
    expect(at({ rotateX: 1, rotateY: -4, rotateZ: 2 })).toBe(4)
    expect(at({ rotateZ: -7 })).toBe(7)
  })
})

describe('constrainCameraDistance', () => {
  // Tilted well past FRONTAL_POSE_EPSILON_DEG on purpose: the two-state snap
  // below is the rule for a device that is showing its metal side band. The
  // near-frontal case, where the band is nowhere near the frame and the zone
  // between bleed and screenFit opens up, is its own describe further down.
  const bounds = distanceBounds({ device: 'phone', orientation: 'portrait', viewportW: 1080, viewportH: 1920, pose: { rotateX: 8 } })

  it('leaves a distance at or beyond fit untouched', () => {
    const cam = { distance: 1, targetU: 0.5, targetV: 0.5 }
    expect(constrainCameraDistance(cam, bounds)).toBe(cam)
    expect(constrainCameraDistance({ ...cam, distance: bounds.fit }, bounds).distance).toBe(bounds.fit)
  })

  it('leaves a distance at or under bleed untouched', () => {
    const cam = { distance: 0.3, targetU: 0.5, targetV: 0.5 }
    expect(constrainCameraDistance(cam, bounds)).toBe(cam)
  })

  it('snaps a distance in the forbidden zone up to fit when fit is nearer', () => {
    const near = bounds.fit - (bounds.fit - bounds.bleed) * 0.2
    const out = constrainCameraDistance({ distance: near, targetU: 0.5, targetV: 0.5 }, bounds)
    expect(out.distance).toBeCloseTo(bounds.fit, 10)
  })

  it('snaps a distance in the forbidden zone down to bleed when bleed is nearer', () => {
    const near = bounds.bleed + (bounds.fit - bounds.bleed) * 0.2
    const out = constrainCameraDistance({ distance: near, targetU: 0.5, targetV: 0.5 }, bounds)
    expect(out.distance).toBeCloseTo(bounds.bleed, 10)
  })

  it('never leaves a snapped camera inside the forbidden zone', () => {
    for (let d = 0.2; d <= 1.2; d += 0.01) {
      const out = constrainCameraDistance({ distance: d, targetU: 0.5, targetV: 0.5 }, bounds)
      expect(out.distance >= bounds.fit - 1e-9 || out.distance <= bounds.bleed + 1e-9).toBe(true)
    }
  })

  it('pulls back rather than dropping the pan when snapping to fit', () => {
    const out = constrainCameraDistance({ distance: 0.7, targetU: 0.25, targetV: 0.5 }, bounds)
    expect(out.targetU).toBe(0.25)
    expect(out.distance).toBeCloseTo(bounds.fit + 0.25 * bounds.uSpan, 10)
    expect(bodyEdgeNdcX('phone', 'portrait', out)).toBeLessThanOrEqual(1)
  })

  // A pan is what turns a legal distance illegal: at 0.45 the screen covers
  // the frame head-on, but aiming at 0.72 down the screen slides its top edge
  // into view. The distance is already past bleed, so only the aim gives.
  it('clamps targetV at bleed so panning can\'t reveal an edge', () => {
    const out = constrainCameraDistance({ distance: 0.45, targetU: 0.5, targetV: 0.72 }, bounds)
    expect(out.distance).toBeLessThanOrEqual(bounds.bleed)
    expect(out.targetV).toBeLessThan(0.72)
    expect(out.targetV).toBeCloseTo(0.5 + (bounds.bleedV - out.distance) / bounds.vSpan, 10)
    const ndc = screenCornerNdc('phone', 'portrait', out)
    expect(ndc.y).toBeGreaterThanOrEqual(1)
  })

  it('clamps targetU at bleed too — a lateral pan is exactly the failure mode', () => {
    const out = constrainCameraDistance({ distance: 0.45, targetU: 0.05, targetV: 0.5 }, bounds)
    expect(out.targetU).toBeGreaterThan(0.05)
    expect(screenCornerNdc('phone', 'portrait', out).x).toBeGreaterThanOrEqual(1)
  })

  it('pulls back to fit instead when the pan is too deep to cover from', () => {
    // targetV 0.95 can't be covered from any distance worth having, so the
    // midpoint rule picks the other legal state: whole device in frame.
    const out = constrainCameraDistance({ distance: 0.45, targetU: 0.5, targetV: 0.95 }, bounds)
    expect(out.distance).toBeCloseTo(bounds.fit, 10)
    expect(out.targetV).toBe(0.95) // vertical framing is free at fit — exiting top/bottom is legal
  })

  it('reads missing camera fields as the cameraLayout defaults', () => {
    expect(constrainCameraDistance({}, bounds)).toEqual({})
  })

  // Reproduces the reviewer's probe: a held distance parked near the
  // fit/bleed midpoint, with the pose float wobbling the bounds themselves
  // (±0.8deg rotateX) every frame. Without hysteresis this strobes between
  // whole-device and full-bleed framing on nearly every wobble crossing;
  // passing back the previously RETURNED distance as `lastDistance` should
  // require the wobble to clear the midpoint by a margin before flipping.
  describe('hysteresis against a wobbling midpoint (lastDistance param)', () => {
    // A tilt the wobble stays entirely inside, so every frame of the probe is
    // non-frontal and sees the plain two-state rule (a wobble straddling
    // frontality would be testing the exemption, not the hysteresis).
    const TILT = 8
    const midpointAt = (rotateX) => {
      const b = distanceBounds({ device: 'phone', orientation: 'portrait', viewportW: 1080, viewportH: 1920, pose: { rotateX } })
      return (b.fit + b.bleed) / 2
    }
    // Sits between the resting midpoint and the midpoint at the wobble's
    // half-amplitude — exactly the sort of value the wobble sweeps past
    // repeatedly, not just once at the extremes.
    const held = midpointAt(TILT + 0.4)

    function runProbe({ withHysteresis }) {
      let lastDistance
      let lastSide = null
      let flips = 0
      for (let i = 0; i < 240; i++) {
        const wobble = Math.sin(i * 0.3) * 0.8 // deg
        const frameBounds = distanceBounds({
          device: 'phone',
          orientation: 'portrait',
          viewportW: 1080,
          viewportH: 1920,
          pose: { rotateX: TILT + wobble },
        })
        const out = constrainCameraDistance({ distance: held, targetU: 0.5, targetV: 0.5 }, frameBounds, withHysteresis ? lastDistance : undefined)
        lastDistance = out.distance
        const side = out.distance >= frameBounds.fit ? 'fit' : 'bleed'
        if (lastSide !== null && side !== lastSide) flips++
        lastSide = side
      }
      return flips
    }

    it('strobes repeatedly without hysteresis (baseline reproduces the defect)', () => {
      expect(runProbe({ withHysteresis: false })).toBeGreaterThan(10)
    })

    it('flips at most once across 240 frames when fed back its own lastDistance', () => {
      expect(runProbe({ withHysteresis: true })).toBeLessThanOrEqual(1)
    })
  })

  // The ending framing: at a near-frontal pose the band between bleed and
  // screenFit shows nothing but screen and the four bezel corner wedges, so
  // it is legal — that is what lets the reference look hold on the WHOLE
  // screen instead of a ~93% crop of it.
  describe('frontal exemption (screenFit)', () => {
    const view = { viewportW: 1080, viewportH: 1920 }
    const frontal = distanceBounds({ device: 'phone', orientation: 'portrait', ...view })
    const tilted = distanceBounds({ device: 'phone', orientation: 'portrait', ...view, pose: { rotateX: 8 } })

    it('passes a frontal camera at exactly screenFit straight through', () => {
      const cam = { distance: frontal.screenFit, targetU: 0.5, targetV: 0.5 }
      expect(constrainCameraDistance(cam, frontal)).toBe(cam)
    })

    it('passes anything between bleed and screenFit through as well', () => {
      for (const p of [0.01, 0.25, 0.5, 0.75, 0.99]) {
        const d = frontal.bleed + (frontal.screenFit - frontal.bleed) * p
        expect(constrainCameraDistance({ distance: d, targetU: 0.5, targetV: 0.5 }, frontal).distance).toBe(d)
      }
    })

    it('snaps the same distance as before when the pose is tilted', () => {
      const d = tilted.bleed + (tilted.screenFit - tilted.bleed) * 0.5
      expect(d).toBeGreaterThan(tilted.bleed) // the exempt band, if it applied
      const out = constrainCameraDistance({ distance: d, targetU: 0.5, targetV: 0.5 }, tilted)
      expect(out.distance).toBeCloseTo(tilted.bleed, 10)
      expect(out.distance).not.toBeCloseTo(d, 4)
    })

    it('snaps the near side onto screenFit, not down to bleed, when frontal', () => {
      // Just inside the forbidden zone's near half — the state the reference
      // look's ending lerp passes through on its way in.
      const d = frontal.screenFit + (frontal.fit - frontal.screenFit) * 0.1
      const out = constrainCameraDistance({ distance: d, targetU: 0.5, targetV: 0.5 }, frontal)
      expect(out.distance).toBeCloseTo(frontal.screenFit, 10)
    })

    it('still snaps out to fit from the far half of the zone', () => {
      const d = frontal.fit - (frontal.fit - frontal.screenFit) * 0.1
      const out = constrainCameraDistance({ distance: d, targetU: 0.5, targetV: 0.5 }, frontal)
      expect(out.distance).toBeCloseTo(frontal.fit, 10)
    })

    it('leaves the pan clamp alone for a genuinely deep frontal request', () => {
      // Deeper than the centred bleed bound, broken only by its own pan: the
      // exemption must not swallow this case, or panning at full-bleed would
      // reveal an edge again (the regression the clamp exists for).
      const out = constrainCameraDistance({ distance: 0.45, targetU: 0.5, targetV: 0.72 }, frontal)
      expect(out.distance).toBeLessThanOrEqual(frontal.bleed)
      expect(out.targetV).toBeLessThan(0.72)
      expect(screenCornerNdc('phone', 'portrait', out).y).toBeGreaterThanOrEqual(1)
    })

    // The live --html export idles on the reference look's ending under a
    // +-3deg float; a hard gate at FRONTAL_POSE_EPSILON_DEG would flip the
    // framing four times a cycle, so a held screen-fit framing survives a
    // wobble out to FRONTAL_POSE_HOLD_DEG.
    it('holds a screen-fit framing through a small float, then lets go', () => {
      const held = frontal.screenFit
      const at = (rotateY, lastDistance) =>
        constrainCameraDistance(
          { distance: held, targetU: 0.5, targetV: 0.5 },
          distanceBounds({ device: 'phone', orientation: 'portrait', ...view, pose: { rotateY } }),
          lastDistance,
        ).distance
      for (const deg of [0, 1.5, 2.5, 3, 3.9]) {
        expect(at(deg, held), `${deg}deg while holding`).toBeCloseTo(held, 10)
        expect(at(-deg, held), `${-deg}deg while holding`).toBeCloseTo(held, 10)
      }
      // Past the hold, and at the same tilt WITHOUT a held screen-fit framing,
      // the classic two-state rule applies again.
      expect(at(6, held)).not.toBeCloseTo(held, 4)
      expect(at(3, undefined)).not.toBeCloseTo(held, 4)
      expect(at(3, frontal.fit)).not.toBeCloseTo(held, 4)
    })

    it('pays for a pan with pull-back on the screenFit side', () => {
      const out = constrainCameraDistance({ distance: frontal.screenFit + 0.01, targetU: 0.5, targetV: 0.62 }, frontal)
      expect(out.distance).toBeGreaterThan(frontal.screenFit)
      expect(out.targetV).toBe(0.62) // aim kept; the distance gives instead
    })
  })
})

describe('constrainCameraDistanceContained', () => {
  const bounds = distanceBounds({ device: 'phone', orientation: 'portrait', viewportW: 1080, viewportH: 1920 })

  it('leaves a distance at or beyond fit untouched', () => {
    const cam = { distance: 1, targetU: 0.5, targetV: 0.5 }
    expect(constrainCameraDistanceContained(cam, bounds)).toBe(cam)
    expect(constrainCameraDistanceContained({ ...cam, distance: bounds.fit }, bounds).distance).toBe(bounds.fit)
  })

  it('floors a bleed-ish distance up to fit instead of snapping down to bleed', () => {
    const cam = { distance: bounds.bleed, targetU: 0.5, targetV: 0.5 }
    const out = constrainCameraDistanceContained(cam, bounds)
    expect(out.distance).toBeCloseTo(bounds.fit, 10)
  })

  it('floors any distance in the old forbidden zone up to fit, never down to bleed', () => {
    for (let d = 0.2; d <= 1.2; d += 0.01) {
      const out = constrainCameraDistanceContained({ distance: d, targetU: 0.5, targetV: 0.5 }, bounds)
      expect(out.distance).toBeGreaterThanOrEqual(bounds.fit - 1e-9)
    }
  })

  it('grows the floor with the pan, same as the fit-side term above', () => {
    const out = constrainCameraDistanceContained({ distance: 0.7, targetU: 0.25, targetV: 0.5 }, bounds)
    expect(out.targetU).toBe(0.25)
    expect(out.distance).toBeCloseTo(bounds.fit + 0.25 * bounds.uSpan, 10)
  })

  it('leaves targetV untouched at fit — vertical framing is the look\'s own intent', () => {
    const out = constrainCameraDistanceContained({ distance: 0.3, targetU: 0.5, targetV: 0.95 }, bounds)
    expect(out.targetV).toBe(0.95)
  })

  it('reads missing camera fields as the cameraLayout defaults', () => {
    expect(constrainCameraDistanceContained({}, bounds)).toEqual({})
  })
})
