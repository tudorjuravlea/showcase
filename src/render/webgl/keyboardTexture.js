// Composes the WebGL laptop's keyboard-deck texture: a procedural grid of
// rounded-rect keys (the bottom row's widths deliberately varied, spacebar-
// like, for bottom-row realism) plus a centered trackpad rectangle below
// them, drawn on an offscreen canvas. Generic/unbranded: no key legends, no
// device-specific proportions, matching the "no Apple trade dress"
// constraint (see src/render/webgl/glRenderer.js's buildDeckTexture, the only
// caller). Must not import React: this module also runs inside exported
// standalone HTML files (see glRenderer.js's own note on the same
// constraint).

const ROW_COUNT = 4
const KEYS_PER_ROW = 14
const MARGIN_RATIO = 0.06 // outer margin, fraction of height
const ROW_GAP_RATIO = 0.16 // gap between key rows, fraction of row pitch
const KEY_GAP_RATIO = 0.16 // gap between keys within a row, fraction of key pitch
const TRACKPAD_HEIGHT_RATIO = 0.32 // fraction of height given to the trackpad band
const TRACKPAD_WIDTH_RATIO = 0.3 // fraction of width

const WELL_COLOR = '#1b1c1e'
const KEY_COLOR = '#333438'
const TRACKPAD_FILL = 'rgba(255, 255, 255, 0.05)'
const TRACKPAD_STROKE = 'rgba(255, 255, 255, 0.4)'

/**
 * Pure layout for the keyboard deck, in the same {width, height} space the
 * canvas is composed at (width = device width, height = deck depth, see
 * glRenderer.js's GL_LAPTOP_DECK_DEPTH). Row 0 is nearest the hinge (back);
 * the last row is nearest the viewer (front), followed by the trackpad. The
 * last row is deliberately a few wide keys (a spacebar-like block flanked by
 * narrower ones) rather than an even KEYS_PER_ROW grid, for bottom-row
 * realism.
 *
 * @param {number} width
 * @param {number} height
 * @returns {{keys: {x: number, y: number, w: number, h: number}[], trackpad: {x: number, y: number, w: number, h: number}}}
 */
export function keyboardLayout(width, height) {
  const margin = height * MARGIN_RATIO
  const trackpadHeight = height * TRACKPAD_HEIGHT_RATIO
  const keysAreaTop = margin
  const keysAreaHeight = Math.max(0, height - margin * 2 - trackpadHeight)
  const rowPitch = keysAreaHeight / ROW_COUNT
  const rowHeight = rowPitch * (1 - ROW_GAP_RATIO)

  const keys = []
  for (let row = 0; row < ROW_COUNT; row += 1) {
    const y = keysAreaTop + row * rowPitch + (rowPitch - rowHeight) / 2
    if (row === ROW_COUNT - 1) {
      // Spacebar-like bottom row: a few narrow keys, a wide center block, a
      // few narrow keys, deliberately uneven widths.
      const segments = [1, 1, 1, 5, 1, 1, 1]
      const totalUnits = segments.reduce((sum, units) => sum + units, 0)
      const pitch = width / totalUnits
      let x = 0
      for (const units of segments) {
        const keyPitch = pitch * units
        const keyWidth = keyPitch * (1 - KEY_GAP_RATIO)
        keys.push({ x: x + (keyPitch - keyWidth) / 2, y, w: keyWidth, h: rowHeight })
        x += keyPitch
      }
    } else {
      const pitch = width / KEYS_PER_ROW
      const keyWidth = pitch * (1 - KEY_GAP_RATIO)
      for (let col = 0; col < KEYS_PER_ROW; col += 1) {
        keys.push({ x: col * pitch + (pitch - keyWidth) / 2, y, w: keyWidth, h: rowHeight })
      }
    }
  }

  const trackpadWidth = width * TRACKPAD_WIDTH_RATIO
  const trackpad = {
    x: (width - trackpadWidth) / 2,
    y: height - margin - trackpadHeight,
    w: trackpadWidth,
    h: trackpadHeight,
  }

  return { keys, trackpad }
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

/**
 * Composes the laptop deck's full keyboard-deck texture on an offscreen
 * canvas: a dark well background, the procedural key grid, and a centered
 * trackpad outline.
 *
 * @param {number} width
 * @param {number} height
 * @param {number} [dpr]
 * @returns {HTMLCanvasElement}
 */
export function composeKeyboardTexture(width, height, dpr = 1) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  const ctx = canvas.getContext('2d')
  ctx.scale(dpr, dpr)

  ctx.fillStyle = WELL_COLOR
  ctx.fillRect(0, 0, width, height)

  const { keys, trackpad } = keyboardLayout(width, height)

  ctx.fillStyle = KEY_COLOR
  for (const key of keys) {
    drawRoundedRect(ctx, key.x, key.y, key.w, key.h, key.h * 0.28)
    ctx.fill()
  }

  drawRoundedRect(ctx, trackpad.x, trackpad.y, trackpad.w, trackpad.h, trackpad.h * 0.12)
  ctx.fillStyle = TRACKPAD_FILL
  ctx.fill()
  ctx.strokeStyle = TRACKPAD_STROKE
  ctx.lineWidth = Math.max(1, height * 0.012)
  ctx.stroke()

  return canvas
}
