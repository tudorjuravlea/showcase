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

// Deck surface (the palm-rest area the keys sit in): a soft diagonal
// gradient instead of a flat fill, so it reads as a curved brushed-metal
// panel catching light unevenly rather than a flat painted plate.
const DECK_SURFACE_TOP = '#3a3b40'
const DECK_SURFACE_BOTTOM = '#222327'
// Recessed well immediately around each key: deliberately darker than the
// old flat background so the key visibly sits IN a cutout rather than on a
// same-tone plate.
const WELL_COLOR = '#0e0f11'
const WELL_INSET_RATIO = 0.16 // how far the well extends past the key on each side, as a fraction of the key's own (smaller) dimension
// Each key's own fill is a subtle top-to-bottom gradient (lighter top edge,
// darker base) rather than a flat color, so it reads as a sculpted cap
// catching a highlight instead of a painted rectangle.
const KEY_COLOR_TOP = '#3d3e44'
const KEY_COLOR_BOTTOM = '#28292d'
const TRACKPAD_FILL = 'rgba(255, 255, 255, 0.05)'
const TRACKPAD_STROKE = 'rgba(255, 255, 255, 0.35)'

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

  // Deck surface first: a soft diagonal gradient (see DECK_SURFACE_TOP/
  // BOTTOM) rather than a flat fill, so the palm rest around the keys reads
  // as curved brushed metal.
  const surfaceGradient = ctx.createLinearGradient(0, 0, width, height)
  surfaceGradient.addColorStop(0, DECK_SURFACE_TOP)
  surfaceGradient.addColorStop(1, DECK_SURFACE_BOTTOM)
  ctx.fillStyle = surfaceGradient
  ctx.fillRect(0, 0, width, height)

  const { keys, trackpad } = keyboardLayout(width, height)

  for (const key of keys) {
    // A darker recessed well behind each key, slightly larger than the key
    // itself, so the key visibly sits in a cutout rather than floating on
    // the same-tone surface.
    const wellPad = Math.min(key.w, key.h) * WELL_INSET_RATIO
    ctx.fillStyle = WELL_COLOR
    drawRoundedRect(
      ctx,
      key.x - wellPad,
      key.y - wellPad,
      key.w + wellPad * 2,
      key.h + wellPad * 2,
      (key.h + wellPad * 2) * 0.3
    )
    ctx.fill()

    // The key itself: a subtle top-to-bottom highlight (see KEY_COLOR_TOP/
    // BOTTOM) so it reads as a sculpted cap, not a flat painted rectangle.
    const keyGradient = ctx.createLinearGradient(key.x, key.y, key.x, key.y + key.h)
    keyGradient.addColorStop(0, KEY_COLOR_TOP)
    keyGradient.addColorStop(1, KEY_COLOR_BOTTOM)
    ctx.fillStyle = keyGradient
    drawRoundedRect(ctx, key.x, key.y, key.w, key.h, key.h * 0.28)
    ctx.fill()
  }

  drawRoundedRect(ctx, trackpad.x, trackpad.y, trackpad.w, trackpad.h, trackpad.h * 0.12)
  ctx.fillStyle = TRACKPAD_FILL
  ctx.fill()
  ctx.strokeStyle = TRACKPAD_STROKE
  // Hairline: a fixed, thin stroke rather than one that scales with the
  // deck's own height. At the deck's real render size (a few dozen px tall)
  // the old height-scaled width read as a thick painted border, not a hairline.
  ctx.lineWidth = 1
  ctx.stroke()

  return canvas
}
