// Composes the WebGL browser device's screen texture: a generic, unbranded
// chrome bar (traffic dots + URL pill) drawn above the content image,
// per docs/superpowers/specs/2026-09-01-mockupanimate-v2-design.md §2. Must
// not import React — this module also runs inside exported standalone HTML
// files (see glRenderer.js's own note on the same constraint).

// Proportions mirror the CSS renderer's .ma-browser-chrome (src/render/css/
// device.css): a 36px bar on a 520px-tall device. Expressed as ratios of the
// bar's own height so chromeLayout stays a pure function of {width, height}.
const BAR_HEIGHT_RATIO = 36 / 520
const PADDING_RATIO = 12 / 36
const GAP_RATIO = 12 / 36
const DOT_GAP_RATIO = 6 / 36
const DOT_DIAMETER_RATIO = 10 / 36
const PILL_HEIGHT_RATIO = 20 / 36

const BAR_COLOR = '#e2e2e4'
const DOT_COLOR = '#b8b8bc'
const PILL_COLOR = '#ffffff'

/**
 * Pure layout math for the browser chrome bar — no canvas involved, so it's
 * directly unit-testable. The bar height is proportional to the overall
 * `height`; three dots sit left-aligned in the bar, followed by a URL pill
 * that fills the remaining width (both fully inside the bar's vertical
 * extent).
 *
 * @param {number} width
 * @param {number} height
 * @returns {{barHeight: number, dots: {x: number, y: number, r: number}[], pill: {x: number, y: number, w: number, h: number}}}
 */
export function chromeLayout(width, height) {
  const barHeight = height * BAR_HEIGHT_RATIO
  const padding = barHeight * PADDING_RATIO
  const gap = barHeight * GAP_RATIO
  const dotGap = barHeight * DOT_GAP_RATIO
  const dotDiameter = barHeight * DOT_DIAMETER_RATIO
  const dotRadius = dotDiameter / 2
  const barCenterY = barHeight / 2

  const dots = []
  let cx = padding + dotRadius
  for (let i = 0; i < 3; i += 1) {
    dots.push({ x: cx, y: barCenterY, r: dotRadius })
    cx += dotDiameter + dotGap
  }
  const dotsBlockRight = padding + 3 * dotDiameter + 2 * dotGap

  const pillHeight = barHeight * PILL_HEIGHT_RATIO
  const pillX = dotsBlockRight + gap
  const pillY = (barHeight - pillHeight) / 2
  const pillWidth = Math.max(0, width - padding - pillX)

  return {
    barHeight,
    dots,
    pill: { x: pillX, y: pillY, w: pillWidth, h: pillHeight },
  }
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
 * Composes the browser device's full screen texture on an offscreen canvas:
 * the content image, cover-fit into the area below the chrome bar, with the
 * bar (dots + URL pill) drawn on top.
 *
 * @param {CanvasImageSource|null} image - decoded content image, or null for
 *   an empty/no-content screen (still draws the chrome bar).
 * @param {{width: number, height: number, dpr?: number}} dims
 * @returns {HTMLCanvasElement}
 */
export function composeChromeTexture(image, { width, height, dpr = 1 }) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  const ctx = canvas.getContext('2d')
  ctx.scale(dpr, dpr)

  const layout = chromeLayout(width, height)
  const contentY = layout.barHeight
  const contentHeight = height - layout.barHeight

  if (image && image.width && image.height) {
    // Cover-fit: scale up to fill the content rect, center, clip overflow.
    const scale = Math.max(width / image.width, contentHeight / image.height)
    const drawWidth = image.width * scale
    const drawHeight = image.height * scale
    const dx = (width - drawWidth) / 2
    const dy = contentY + (contentHeight - drawHeight) / 2
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, contentY, width, contentHeight)
    ctx.clip()
    ctx.drawImage(image, dx, dy, drawWidth, drawHeight)
    ctx.restore()
  } else {
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, contentY, width, contentHeight)
  }

  // Chrome bar: generic/unbranded — plain gray dots, no traffic-light colors.
  ctx.fillStyle = BAR_COLOR
  ctx.fillRect(0, 0, width, layout.barHeight)

  ctx.fillStyle = DOT_COLOR
  for (const dot of layout.dots) {
    ctx.beginPath()
    ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.fillStyle = PILL_COLOR
  drawRoundedRect(ctx, layout.pill.x, layout.pill.y, layout.pill.w, layout.pill.h, layout.pill.h / 2)
  ctx.fill()

  return canvas
}
