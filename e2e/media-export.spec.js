// Media export (PNG/JPG/WebP/GIF/MP4/WebM) via the Export panel — see
// src/export/media.js and src/app/panels/ExportPanel.jsx. Needs a real
// WebGL context (offscreen renderer) and, for MP4, real WebCodecs video
// encoding — both only available in a real browser, hence Playwright rather
// than Vitest (see tests/media-timing.test.js for the pure frameTimes/
// fitSize coverage).
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PNG = path.join(__dirname, 'fixtures', 'red-dot.png')

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff])

function pngDimensions(buffer) {
  // IHDR is always the first chunk: 8-byte signature, 4-byte chunk length,
  // 4-byte "IHDR" type, then 4-byte width + 4-byte height (big-endian).
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

// Each animated frame gets its own Graphic Control Extension (introducer
// 0x21, label 0xF9) ahead of its image data — a reliable per-frame marker,
// confirmed against gifenc's actual output (one GCE per writeFrame() call).
function countGifGraphicControlBlocks(buffer) {
  let count = 0
  for (let i = 0; i < buffer.length - 1; i++) {
    if (buffer[i] === 0x21 && buffer[i + 1] === 0xf9) count++
  }
  return count
}

// Width, in pixels, of the opaque device silhouette inside an exported PNG.
// Decoded in the browser (Image + 2D canvas) rather than in Node so no PNG
// decoder dependency is needed. The scene background defaults to
// transparent and the only fully opaque thing in the frame is the device
// itself — the ground shadow tops out at alpha 0.45 (see glRenderer's
// createShadowTexture), well under the 200 threshold.
async function opaqueDeviceWidth(page, buffer) {
  return page.evaluate(async (base64) => {
    const img = new Image()
    img.src = `data:image/png;base64,${base64}`
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(img, 0, 0)
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    let min = canvas.width
    let max = -1
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        if (data[(y * canvas.width + x) * 4 + 3] > 200) {
          if (x < min) min = x
          if (x > max) max = x
        }
      }
    }
    return max < min ? 0 : max - min + 1
  }, buffer.toString('base64'))
}

async function exportViaPanel(page, testInfo, filename) {
  const downloadPromise = page.waitForEvent('download')
  await page.locator('#ma-export').click()
  const download = await downloadPromise
  const savePath = testInfo.outputPath(filename)
  await download.saveAs(savePath)
  return { download, buffer: await fs.readFile(savePath) }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  // Give every scenario real screen content — media export requires
  // content.type === "image" (see src/export/media.js assertImageContent).
  await page.locator('.ma-file-input').setInputFiles(FIXTURE_PNG)
})

test('PNG still export has correct magic bytes and doubles pixel dimensions at 2x scale', async ({
  page,
}, testInfo) => {
  await page.locator('#ma-export-format').selectOption('png')

  const first = await exportViaPanel(page, testInfo, 'still-1x.png')
  expect(first.buffer.subarray(0, 8)).toEqual(PNG_SIGNATURE)
  const dims1 = pngDimensions(first.buffer)
  expect(dims1.width).toBeGreaterThan(0)
  expect(dims1.height).toBeGreaterThan(0)

  await page.locator('#ma-export-scale').selectOption('2')
  const second = await exportViaPanel(page, testInfo, 'still-2x.png')
  const dims2 = pngDimensions(second.buffer)

  expect(dims2.width).toBe(dims1.width * 2)
  expect(dims2.height).toBe(dims1.height * 2)
})

// Regression cover for the v2 final review's C2: Scale used to grow only the
// output canvas, blitting the same layout-sized GL render into the middle of
// it — 1x/2x/3x all shipped the same ~214px-wide device on ever-emptier
// frames, at a size that depended on the exporting machine's
// devicePixelRatio. Canvas dimensions alone (the test above) cannot catch
// that; this measures the device itself.
test('Scale raises the still export\'s real resolution: the device is twice as wide at 2x', async ({
  page,
}, testInfo) => {
  await page.locator('#ma-export-format').selectOption('png')

  const first = await exportViaPanel(page, testInfo, 'detail-1x.png')
  const width1 = await opaqueDeviceWidth(page, first.buffer)
  const frame1 = pngDimensions(first.buffer)
  expect(width1).toBeGreaterThan(0)
  // The device must actually fill its frame rather than sit as a thumbnail
  // in a sea of margin (the phone is portrait in a landscape frame, so it is
  // height-bound — a third of the frame width is already generous).
  expect(width1).toBeGreaterThan(frame1.width * 0.15)

  await page.locator('#ma-export-scale').selectOption('2')
  const second = await exportViaPanel(page, testInfo, 'detail-2x.png')
  const width2 = await opaqueDeviceWidth(page, second.buffer)

  expect(width2 / width1).toBeGreaterThan(1.9)
  expect(width2 / width1).toBeLessThan(2.1)
})

// A failed capture used to reject unhandled and silently re-enable the
// button, leaving the user with no idea why nothing downloaded.
test('a failed still export surfaces a toast and re-enables the button', async ({ page }) => {
  // Simulate a browser that cannot give the offscreen exporter a WebGL
  // context. Installed before any page script, so it applies from mount.
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      if (String(type).startsWith('webgl')) return null
      return original.call(this, type, ...rest)
    }
  })
  await page.goto('/')
  await page.locator('.ma-file-input').setInputFiles(FIXTURE_PNG)
  await page.locator('#ma-export-format').selectOption('png')

  const pageErrors = []
  page.on('pageerror', (err) => pageErrors.push(err.message))

  await page.locator('#ma-export').click()

  await expect(page.locator('#ma-export-fallback')).toBeVisible()
  await expect(page.locator('#ma-export-fallback')).toContainText('Export failed')
  await expect(page.locator('#ma-export')).toBeEnabled()
  expect(pageErrors).toEqual([])
})

test('JPG still export has correct magic bytes', async ({ page }, testInfo) => {
  await page.locator('#ma-export-format').selectOption('jpeg')
  const { buffer } = await exportViaPanel(page, testInfo, 'still.jpg')
  expect(buffer.subarray(0, 3)).toEqual(JPEG_SIGNATURE)
})

test('WebP still export has correct magic bytes', async ({ page }, testInfo) => {
  await page.locator('#ma-export-format').selectOption('webp')
  const { buffer } = await exportViaPanel(page, testInfo, 'still.webp')
  expect(buffer.subarray(0, 4).toString('ascii')).toBe('RIFF')
  expect(buffer.subarray(8, 12).toString('ascii')).toBe('WEBP')
})

test('media export is disabled with a notice for live URL content (HTML export stays enabled)', async ({ page }) => {
  await page.locator('#ma-url-input').fill('https://example.com')
  await page.locator('.ma-content-panel button[type="submit"]').click()

  await page.locator('#ma-export-format').selectOption('png')
  await expect(page.locator('#ma-export')).toBeDisabled()
  await expect(page.locator('#ma-export-notice')).toContainText('image')

  await page.locator('#ma-export-format').selectOption('html')
  await expect(page.locator('#ma-export')).toBeEnabled()
})

test('animation formats are disabled with a notice when the preset is "none"', async ({ page }) => {
  await page.locator('#ma-export-format').selectOption('gif')
  await expect(page.locator('#ma-export')).toBeDisabled()
  await expect(page.locator('#ma-export-notice')).toContainText('preset')

  await page.locator('#ma-preset-rotate-in').click()
  await expect(page.locator('#ma-export')).toBeEnabled()
})

test('GIF and MP4 each default the Size select to their own spec-mandated preset', async ({ page }) => {
  await page.locator('#ma-export-format').selectOption('mp4')
  await expect(page.locator('#ma-export-size')).toHaveValue('1080p')

  await page.locator('#ma-export-format').selectOption('gif')
  await expect(page.locator('#ma-export-size')).toHaveValue('720p')

  // Switching back to MP4 must re-sync to its own default, not stick with
  // whatever GIF last left selected.
  await page.locator('#ma-export-format').selectOption('mp4')
  await expect(page.locator('#ma-export-size')).toHaveValue('1080p')
})

test('GIF export produces GIF89a bytes with more than one frame', async ({ page }, testInfo) => {
  await page.locator('#ma-preset-rotate-in').click()
  await page.locator('#ma-duration').fill('300') // keep the e2e runtime sane — a handful of frames is enough
  await page.locator('#ma-export-format').selectOption('gif')
  await page.locator('#ma-export-size').selectOption('preview') // 320x240 — fast to quantize/encode

  const { buffer } = await exportViaPanel(page, testInfo, 'anim.gif')
  expect(buffer.subarray(0, 6).toString('ascii')).toBe('GIF89a')
  expect(countGifGraphicControlBlocks(buffer)).toBeGreaterThan(1)
})

test('MP4 export encodes via WebCodecs in Chromium and produces a valid mp4 blob', async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  await page.locator('#ma-preset-rotate-in').click()
  await page.locator('#ma-duration').fill('300') // -> 10 frames at MP4's fixed 30fps
  await page.locator('#ma-export-format').selectOption('mp4')
  await page.locator('#ma-export-size').selectOption('preview')

  const { buffer } = await exportViaPanel(page, testInfo, 'anim.mp4')
  expect(buffer.length).toBeGreaterThan(0)
  // ISO base media file format: a 4-byte box size followed by the box type.
  // mp4-muxer always writes an "ftyp" box first — chromium supports
  // WebCodecs avc encoding, so this must be a real mp4, not a WebM fallback.
  expect(buffer.subarray(4, 8).toString('ascii')).toBe('ftyp')
  await expect(page.locator('#ma-export-fallback')).toHaveCount(0)
})

test('MP4 export falls back to WebM with a notice when WebCodecs avc is unavailable', async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  // Simulate a browser whose WebCodecs implementation can't do avc — the
  // init script only takes effect on the next navigation, so re-navigate.
  await page.addInitScript(() => {
    if (window.VideoEncoder) {
      window.VideoEncoder.isConfigSupported = async () => ({ supported: false })
    }
  })
  await page.goto('/')
  await page.locator('.ma-file-input').setInputFiles(FIXTURE_PNG)
  await page.locator('#ma-preset-rotate-in').click()
  await page.locator('#ma-duration').fill('300')
  await page.locator('#ma-export-format').selectOption('mp4')
  await page.locator('#ma-export-size').selectOption('preview')

  const { download, buffer } = await exportViaPanel(page, testInfo, 'anim-fallback')
  expect(download.suggestedFilename()).toMatch(/\.webm$/)
  expect(buffer.length).toBeGreaterThan(0)
  // WebM/Matroska EBML header.
  expect(buffer.subarray(0, 4)).toEqual(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))

  await expect(page.locator('#ma-export-fallback')).toBeVisible()
  await expect(page.locator('#ma-export-fallback')).toContainText('WebM')
})
