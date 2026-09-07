import { describe, it, expect } from 'vitest'
import { defaultScene, mergeScene, validateScene } from '../src/core/scene.js'

describe('defaultScene', () => {
  it('matches the spec JSON shape', () => {
    const scene = defaultScene()

    expect(scene).toEqual({
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
        // WebGL-only device frame finish (glRenderer.js's FRAME_FINISHES);
        // the CSS renderer ignores it — see src/core/scene.js.
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
    })
  })
})

describe('mergeScene', () => {
  it('deep-merges a pose patch without mutating the input scene', () => {
    const scene = defaultScene()
    const originalPoseSnapshot = { ...scene.pose }

    const merged = mergeScene(scene, { pose: { rotateY: -25, explode: 0.5 } })

    // input untouched
    expect(scene.pose).toEqual(originalPoseSnapshot)

    // result has the patched fields plus untouched siblings preserved
    expect(merged.pose).toEqual({
      ...originalPoseSnapshot,
      rotateY: -25,
      explode: 0.5,
    })

    // other top-level sections are preserved
    expect(merged.device).toBe(scene.device)
    expect(merged.style).toEqual(scene.style)

    // result is a new object, not the same reference
    expect(merged).not.toBe(scene)
    expect(merged.pose).not.toBe(scene.pose)
  })

  it('deep-merges nested content without mutating the input', () => {
    const scene = defaultScene()

    const merged = mergeScene(scene, { content: { src: 'data:image/png;base64,AAA' } })

    expect(scene.content.src).toBe('')
    expect(merged.content).toEqual({ type: 'image', src: 'data:image/png;base64,AAA' })
  })
})

describe('validateScene', () => {
  it('accepts the default scene', () => {
    const result = validateScene(defaultScene())
    expect(result).toEqual({ ok: true, errors: [] })
  })

  it('rejects an unknown device', () => {
    const scene = mergeScene(defaultScene(), { device: 'toaster' })

    const result = validateScene(scene)

    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.toLowerCase().includes('device'))).toBe(true)
  })

  it('rejects explode outside 0..1', () => {
    const tooHigh = mergeScene(defaultScene(), { pose: { explode: 1.5 } })
    const tooLow = mergeScene(defaultScene(), { pose: { explode: -0.1 } })

    expect(validateScene(tooHigh).ok).toBe(false)
    expect(validateScene(tooLow).ok).toBe(false)
    expect(validateScene(tooHigh).errors.some((e) => e.toLowerCase().includes('explode'))).toBe(true)
  })
})
