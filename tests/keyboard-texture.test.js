// keyboardLayout is pure geometry math (no canvas), unit-tested directly.
// composeKeyboardTexture needs a 2D canvas context (jsdom doesn't implement
// one) and is exercised end-to-end instead by manually rendering the laptop
// device (see bin/showcase.mjs --device laptop).
import { describe, it, expect } from 'vitest'
import { keyboardLayout } from '../src/render/webgl/keyboardTexture.js'

describe('keyboardLayout', () => {
  it('returns a non-empty key grid plus one trackpad rect', () => {
    const { keys, trackpad } = keyboardLayout(820, 110)
    expect(keys.length).toBeGreaterThan(0)
    expect(trackpad.w).toBeGreaterThan(0)
    expect(trackpad.h).toBeGreaterThan(0)
  })

  it('every key sits inside the canvas bounds', () => {
    const width = 820
    const height = 110
    const { keys } = keyboardLayout(width, height)
    for (const key of keys) {
      expect(key.x).toBeGreaterThanOrEqual(0)
      expect(key.y).toBeGreaterThanOrEqual(0)
      expect(key.x + key.w).toBeLessThanOrEqual(width)
      expect(key.y + key.h).toBeLessThanOrEqual(height)
      expect(key.w).toBeGreaterThan(0)
      expect(key.h).toBeGreaterThan(0)
    }
  })

  it('the trackpad sits centered horizontally, below every key row', () => {
    const width = 820
    const height = 110
    const { keys, trackpad } = keyboardLayout(width, height)
    const maxKeyBottom = Math.max(...keys.map((key) => key.y + key.h))
    expect(trackpad.y).toBeGreaterThanOrEqual(maxKeyBottom)
    expect(trackpad.x + trackpad.w / 2).toBeCloseTo(width / 2, 5)
    expect(trackpad.y + trackpad.h).toBeLessThanOrEqual(height)
  })

  it("the last row's widths are uneven (a spacebar-like block), unlike the others", () => {
    const { keys } = keyboardLayout(820, 110)
    const rows = [...new Set(keys.map((key) => key.y))].sort((a, b) => a - b)
    const lastRowKeys = keys.filter((key) => key.y === rows[rows.length - 1])
    const widths = new Set(lastRowKeys.map((key) => Math.round(key.w)))
    expect(widths.size).toBeGreaterThan(1)

    const otherRowKeys = keys.filter((key) => key.y === rows[0])
    const otherWidths = new Set(otherRowKeys.map((key) => Math.round(key.w)))
    expect(otherWidths.size).toBe(1)
  })

  it('scales proportionally with height for a shallower/deeper deck', () => {
    const shallow = keyboardLayout(820, 55)
    const deep = keyboardLayout(820, 110)
    expect(shallow.trackpad.h).toBeCloseTo(deep.trackpad.h / 2)
    expect(shallow.keys[0].h).toBeCloseTo(deep.keys[0].h / 2)
  })
})
