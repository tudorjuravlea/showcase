// @vitest-environment jsdom
//
// coverCropBox is the pure "cover, crop overflow, center" math behind the
// showcase runtime's content fit (src/showcase/runtime.js's drawMediaFrame)
// — no video/canvas/DOM involved, so it's unit-tested directly. The rest of
// runtime.js needs a real <video>/WebGL context and is covered end-to-end
// instead (e2e/showcase.spec.js).
import { describe, it, expect } from 'vitest'
import { coverCropBox } from '../src/showcase/runtime.js'

describe('coverCropBox', () => {
  it('crops width when the source is wider than the target aspect (landscape source, portrait target)', () => {
    const box = coverCropBox(1920, 1080, 9 / 16)
    expect(box.height).toBe(1080) // full source height kept
    expect(box.width).toBe(Math.round(1080 * (9 / 16)))
    expect(box.width).toBeLessThan(1920) // width is the cropped axis
  })

  it('crops height when the source is taller than the target aspect (portrait source, landscape target)', () => {
    const box = coverCropBox(1080, 1920, 16 / 9)
    expect(box.width).toBe(1080) // full source width kept
    expect(box.height).toBe(Math.round(1080 / (16 / 9)))
    expect(box.height).toBeLessThan(1920) // height is the cropped axis
  })

  it('is a no-op crop (full source) when the source already matches the target aspect', () => {
    const box = coverCropBox(1170, 2532, 1170 / 2532)
    expect(box.width).toBe(1170)
    expect(box.height).toBe(2532)
    expect(box.x).toBe(0)
    expect(box.y).toBe(0)
  })

  it('centers the crop window within the source', () => {
    const box = coverCropBox(1920, 1080, 9 / 16)
    expect(box.x).toBeCloseTo((1920 - box.width) / 2)
    expect(box.y).toBe(0)
  })

  it('never upscales — the crop box always fits within the source dimensions', () => {
    const box = coverCropBox(1920, 1080, 9 / 16)
    expect(box.width).toBeLessThanOrEqual(1920)
    expect(box.height).toBeLessThanOrEqual(1080)
  })

  it('the resulting box aspect matches the requested target aspect', () => {
    const targetAspect = 0.4622
    const box = coverCropBox(1170, 2532, targetAspect)
    expect(box.width / box.height).toBeCloseTo(targetAspect, 2)
  })
})
