// chromeLayout is pure geometry math (no canvas) — unit-tested directly.
// composeChromeTexture needs a 2D canvas context (jsdom doesn't implement
// one) and is exercised end-to-end instead by e2e/matrix.spec.js's browser x
// webgl pixel-truth assertions.
import { describe, it, expect } from 'vitest'
import { chromeLayout } from '../src/render/webgl/chromeTexture.js'

describe('chromeLayout', () => {
  it('bar height is proportional to the overall height, independent of width', () => {
    const narrow = chromeLayout(400, 520)
    const wide = chromeLayout(1600, 520)
    expect(narrow.barHeight).toBeCloseTo(wide.barHeight)
    expect(narrow.barHeight).toBeGreaterThan(0)

    const taller = chromeLayout(800, 1040)
    expect(taller.barHeight).toBeCloseTo(chromeLayout(800, 520).barHeight * 2)
  })

  it('returns exactly three dots', () => {
    const { dots } = chromeLayout(800, 520)
    expect(dots).toHaveLength(3)
  })

  it('dots sit inside the bar, left to right, non-overlapping', () => {
    const { barHeight, dots } = chromeLayout(800, 520)
    for (const dot of dots) {
      expect(dot.r).toBeGreaterThan(0)
      expect(dot.y - dot.r).toBeGreaterThanOrEqual(0)
      expect(dot.y + dot.r).toBeLessThanOrEqual(barHeight)
    }
    expect(dots[1].x).toBeGreaterThan(dots[0].x)
    expect(dots[2].x).toBeGreaterThan(dots[1].x)
    // Non-overlapping: consecutive centers are farther apart than the sum of
    // their radii.
    expect(dots[1].x - dots[0].x).toBeGreaterThan(dots[0].r + dots[1].r)
    expect(dots[2].x - dots[1].x).toBeGreaterThan(dots[1].r + dots[2].r)
  })

  it('pill sits fully inside the bar, to the right of the dots', () => {
    const { barHeight, dots, pill } = chromeLayout(800, 520)
    expect(pill.y).toBeGreaterThanOrEqual(0)
    expect(pill.y + pill.h).toBeLessThanOrEqual(barHeight)
    expect(pill.x).toBeGreaterThan(dots[2].x + dots[2].r)
    expect(pill.w).toBeGreaterThan(0)
    expect(pill.x + pill.w).toBeLessThanOrEqual(800)
  })

  it('scales proportionally with the bar height for a taller/shorter device', () => {
    const small = chromeLayout(800, 260) // half height
    const big = chromeLayout(800, 520)
    expect(small.barHeight).toBeCloseTo(big.barHeight / 2)
    expect(small.pill.h).toBeCloseTo(big.pill.h / 2)
    expect(small.dots[0].r).toBeCloseTo(big.dots[0].r / 2)
  })
})
