// @vitest-environment jsdom
//
// createCssRenderer manipulates plain DOM (createElement/style), so unlike
// createGlRenderer it needs no real browser/WebGL context and is safe to
// unit-test directly under jsdom. Covers the style effects added for the
// new StylePanel (see src/app/panels/StylePanel.jsx): glare/glow layer
// presence and the background color painted on the renderer's root.
import { describe, it, expect } from 'vitest'
import { createCssRenderer } from '../src/render/css/cssRenderer.js'
import { lidRotationX } from '../src/render/webgl/glRenderer.js'
import { defaultScene, mergeScene } from '../src/core/scene.js'

describe('createCssRenderer style effects', () => {
  it('adds a glare overlay inside .ma-glass when style.glare is true, omits it when false', () => {
    const container = document.createElement('div')
    const renderer = createCssRenderer(container)

    renderer.render(mergeScene(defaultScene(), { style: { glare: true } }))
    expect(container.querySelector('.ma-glass .ma-glare')).not.toBeNull()

    renderer.render(mergeScene(defaultScene(), { style: { glare: false } }))
    expect(container.querySelector('.ma-glass .ma-glare')).toBeNull()
  })

  it('adds a glow halo inside .ma-device when style.glow is true, omits it when false', () => {
    const container = document.createElement('div')
    const renderer = createCssRenderer(container)

    renderer.render(mergeScene(defaultScene(), { style: { glow: true } }))
    expect(container.querySelector('.ma-device > .ma-glow-halo')).not.toBeNull()

    renderer.render(mergeScene(defaultScene(), { style: { glow: false } }))
    expect(container.querySelector('.ma-device > .ma-glow-halo')).toBeNull()
  })

  it('paints style.background on the container, and clears it for "transparent"', () => {
    const container = document.createElement('div')
    const renderer = createCssRenderer(container)

    renderer.render(mergeScene(defaultScene(), { style: { background: '#123456' } }))
    expect(container.style.backgroundColor).toBe('rgb(18, 52, 86)')

    renderer.render(mergeScene(defaultScene(), { style: { background: 'transparent' } }))
    expect(container.style.backgroundColor).toBe('')
  })

  it('destroy() clears any painted background so a later renderer on the same container starts clean', () => {
    const container = document.createElement('div')
    const renderer = createCssRenderer(container)

    renderer.render(mergeScene(defaultScene(), { style: { background: '#ff0000' } }))
    expect(container.style.backgroundColor).toBe('rgb(255, 0, 0)')

    renderer.destroy()
    expect(container.style.backgroundColor).toBe('')
  })
})

// Regression cover for the v2 final review's C1: the CSS lid folded the
// opposite way from the WebGL renderer and from the spec (lidAngle 110 read
// as a ~20deg *forward* tilt instead of the spec's back tilt). CSS Y points
// down and THREE's points up, so the two hinge rotations must be exact
// negations of each other — the same relationship poseToEuler() encodes for
// rotateX/rotateZ. A sign flip on either side breaks this test.
describe('createCssRenderer laptop lid hinge', () => {
  const DEG = Math.PI / 180

  function lidRotationDeg(lidAngle) {
    const container = document.createElement('div')
    const renderer = createCssRenderer(container)
    renderer.render(mergeScene(defaultScene(), { device: 'laptop', pose: { lidAngle } }))
    const transform = container.querySelector('.ma-lid').style.transform
    return Number(transform.match(/rotateX\((-?[\d.]+)deg\)/)[1])
  }

  it('is upright (0deg) at lidAngle 90 and tilts the top back (+20deg) at the default 110', () => {
    expect(lidRotationDeg(90)).toBe(0)
    // CSS rotateX(+20) carries the lid's top edge (negative local Y) to
    // negative Z — away from the viewer.
    expect(lidRotationDeg(110)).toBe(20)
    expect(lidRotationDeg(130)).toBe(40)
  })

  it('folds the lid forward onto the base at lidAngle 0 (closed)', () => {
    expect(lidRotationDeg(0)).toBe(-90)
  })

  it('is the exact negation of the WebGL renderer lidRotationX at every lid angle', () => {
    for (const lidAngle of [0, 45, 90, 110, 130]) {
      expect(lidRotationDeg(lidAngle) * DEG).toBeCloseTo(-lidRotationX(lidAngle), 10)
    }
  })
})
