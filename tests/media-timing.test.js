// Pure timing/geometry helpers for media export (see src/export/media.js).
// No DOM/WebGL involved — safe to unit-test directly. The GL-dependent parts
// of media.js (captureStill/captureAnimation) need a real WebGL context and
// are covered by e2e/media-export.spec.js instead.
import { describe, it, expect } from 'vitest'
import { frameTimes, fitSize } from '../src/export/media.js'

describe('frameTimes', () => {
  it('2000ms @ 30fps produces 61 frames including both endpoints', () => {
    const times = frameTimes(2000, 30)
    expect(times).toHaveLength(61)
    expect(times[0]).toBe(0)
    expect(times[times.length - 1]).toBe(1)
  })

  it('is evenly spaced', () => {
    const times = frameTimes(1000, 10)
    for (let i = 1; i < times.length; i++) {
      expect(times[i] - times[i - 1]).toBeCloseTo(times[1] - times[0], 10)
    }
  })

  it('a zero duration still returns a single frame at t=0', () => {
    expect(frameTimes(0, 30)).toEqual([0])
  })

  it('a short duration/fps combo still includes both endpoints', () => {
    const times = frameTimes(300, 30) // 10 frames per the brief's MP4 example
    expect(times).toHaveLength(10)
    expect(times[0]).toBe(0)
    expect(times[times.length - 1]).toBe(1)
  })
})

describe('fitSize', () => {
  it('preserves aspect ratio when downscaling', () => {
    const { w, h } = fitSize(1200, 900, 600, 600)
    expect(w / h).toBeCloseTo(1200 / 900, 5)
    expect(w).toBeLessThanOrEqual(600)
    expect(h).toBeLessThanOrEqual(600)
  })

  it('never upscales beyond the source size', () => {
    const { w, h } = fitSize(300, 200, 1920, 1080)
    expect(w).toBe(300)
    expect(h).toBe(200)
  })

  it('constrains on whichever dimension is tighter', () => {
    // 1200x900 (4:3) fit into 1280x720 (16:9): height is the binding
    // constraint (900 -> 720 is a bigger shrink than 1200 -> 1280, which
    // isn't a shrink at all).
    const { w, h } = fitSize(1200, 900, 1280, 720)
    expect(h).toBe(720)
    expect(w).toBe(960)
  })

  it('returns the exact box when the aspect ratios already match', () => {
    expect(fitSize(1200, 900, 320, 240)).toEqual({ w: 320, h: 240 })
  })
})
