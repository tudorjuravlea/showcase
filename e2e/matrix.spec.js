// Full-matrix verification (device × renderer × animation preset), per
// docs/superpowers/specs/2026-09-01-mockupanimate-design.md ("Testing /
// verification": "screenshot-based visual checks for each device in both
// renderers"). One page, one test, looping through every scenario — cheaper
// than 21 separate tests (each of which would pay for a fresh page/context)
// and still asserts real behavior per scenario: the device (css) or canvas
// (webgl) is visible, and no console error/pageerror fired while rendering
// it. Screenshots land in e2e/__screenshots__/ for the human review gate
// called out in the brief (gitignored — see .gitignore).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PNG = path.join(__dirname, 'fixtures', 'red-dot.png')
const SCREENSHOT_DIR = path.join(__dirname, '__screenshots__')

// Both renderers now support all 4 devices (the browser device gained WebGL
// support in v2 §2 — composed chrome-bar texture; see chromeTexture.js).
const DEVICE_RENDERER_COMBOS = [
  { device: 'phone', renderer: 'css' },
  { device: 'tablet', renderer: 'css' },
  { device: 'laptop', renderer: 'css' },
  { device: 'browser', renderer: 'css' },
  { device: 'phone', renderer: 'webgl' },
  { device: 'tablet', renderer: 'webgl' },
  { device: 'laptop', renderer: 'webgl' },
  { device: 'browser', renderer: 'webgl' },
]

const PRESETS = ['rotate-in', 'orbit', 'exploded-reveal']

test('every device x renderer x preset combination renders without console errors', async ({ page }) => {
  test.setTimeout(150_000) // 8 combos x 3 presets = 24 scenarios; generous headroom over the <3min budget

  const consoleErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(err.message))

  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })

  await page.goto('/')
  // Give every scenario real screen content instead of an empty src.
  await page.locator('.ma-file-input').setInputFiles(FIXTURE_PNG)

  const deviceSelect = page.locator('#ma-device-select')
  const photorealToggle = page.locator('#ma-photoreal-toggle')

  for (const { device, renderer } of DEVICE_RENDERER_COMBOS) {
    await deviceSelect.selectOption(device)

    if (renderer === 'webgl') {
      await expect(photorealToggle).toBeEnabled()
      await photorealToggle.check()
    } else if (await photorealToggle.isChecked()) {
      await photorealToggle.uncheck()
    }

    for (const preset of PRESETS) {
      consoleErrors.length = 0

      await page.locator(`#ma-preset-${preset}`).click()
      await page.locator('#ma-play').click()
      await page.waitForTimeout(250) // let the animation tick a few frames

      if (renderer === 'webgl') {
        await expect(page.locator('.ma-stage canvas')).toBeVisible()
      } else {
        const deviceEl = page.locator('.ma-device')
        await expect(deviceEl).toBeVisible()
        await expect(deviceEl).toHaveAttribute('data-device', device)
      }

      expect(consoleErrors, `console errors for ${device}-${renderer}-${preset}`).toEqual([])

      await page.locator('.ma-stage').screenshot({
        path: path.join(SCREENSHOT_DIR, `${device}-${renderer}-${preset}.png`),
      })
    }
  }
})

// Pixel truth, not just liveness. The "canvas is visible" and "two frames
// differ" assertions above happily passed while the WebGL screen rendered
// pure black (MeshBasicMaterial multiplying the texture by a black base
// color) and while the body slab occluded the screen plane entirely. This
// reads the actual framebuffer back and demands the fixture's red actually
// reaches the viewer.
async function redPixelShare(canvasLocator) {
  return canvasLocator.evaluate((canvas) => {
    const readback = document.createElement('canvas')
    readback.width = canvas.width
    readback.height = canvas.height
    const ctx = readback.getContext('2d')
    ctx.drawImage(canvas, 0, 0)
    const { data } = ctx.getImageData(0, 0, readback.width, readback.height)
    let red = 0
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]]
      // "red-dominant": opaque, bright red, and clearly not grey/white.
      if (a > 128 && r > 120 && r > g * 1.6 && r > b * 1.6) red += 1
    }
    return red / (data.length / 4)
  })
}

test('WebGL phone at the default pose actually shows the screen content (not black, occluded, or facing away)', async ({
  page,
}) => {
  await page.goto('/')
  await page.locator('.ma-file-input').setInputFiles(FIXTURE_PNG) // solid opaque red 4x4

  const toggle = page.locator('#ma-photoreal-toggle')
  await expect(toggle).toBeEnabled()
  await toggle.check()

  const canvas = page.locator('.ma-stage canvas')
  await expect(canvas).toBeVisible()

  // The texture load is async (THREE.TextureLoader) and triggers its own
  // re-render; poll until the readback stabilises rather than guessing a
  // fixed timeout.
  await expect
    .poll(() => redPixelShare(canvas), { timeout: 10_000 })
    // The phone screen covers ~90% of the device, which itself fills ~1/1.4
    // of the canvas height under the camera's fit margin — so a correct
    // render is ~45% red. 10% is far above any incidental red but far below
    // that, leaving room for glare/AA without going green on a black or
    // hidden screen (both of which read 0%).
    .toBeGreaterThan(0.1)
})

test('WebGL laptop shows its screen at the default lid angle, matching the CSS renderer', async ({ page }) => {
  await page.goto('/')
  await page.locator('.ma-file-input').setInputFiles(FIXTURE_PNG)
  await page.locator('#ma-device-select').selectOption('laptop')
  await page.locator('#ma-photoreal-toggle').check()

  const canvas = page.locator('.ma-stage canvas')
  await expect(canvas).toBeVisible()

  // At the default lidAngle (110), the lid is only ~20deg off vertical —
  // nearly upright, not heavily foreshortened — so the screen should read
  // at a share closer to the phone's than to the old, badly-tipped slab.
  // A wrong hinge sign points the screen away from the camera entirely.
  await expect.poll(() => redPixelShare(canvas), { timeout: 10_000 }).toBeGreaterThan(0.02)
})

test('WebGL browser device shows the composed chrome+content texture (not black, occluded, or facing away)', async ({
  page,
}) => {
  await page.goto('/')
  await page.locator('.ma-file-input').setInputFiles(FIXTURE_PNG) // solid opaque red 4x4
  await page.locator('#ma-device-select').selectOption('browser')

  const toggle = page.locator('#ma-photoreal-toggle')
  await expect(toggle).toBeEnabled() // browser no longer forces css (v2 §2)
  await toggle.check()

  const canvas = page.locator('.ma-stage canvas')
  await expect(canvas).toBeVisible()

  // Threshold derivation (device fills ~1/1.4 of the canvas per dimension,
  // same camera-fit margin as the phone test above, so ~(1/1.4)^2 ≈ 51% of
  // the canvas area is device):
  //   screen-of-device fraction = layout.screen area / body area
  //                             = (800*484) / (800*520) ≈ 0.93
  //   content-of-screen fraction (composeChromeTexture's own chrome bar,
  //     unique to the browser device — the phone/tablet/laptop screen
  //     texture has no such internal bar) = 1 - BAR_HEIGHT_RATIO ≈ 0.93
  //   expected red share ≈ 0.51 * 0.93 * 0.93 ≈ 0.44
  // The chrome bar's extra ~7% loss (absent from the phone's calculation)
  // is exactly why this threshold sits below the phone test's 0.1 — set
  // comfortably below the ~0.44 estimate (headroom for AA/compositing) but
  // still far above the ~0% a black, occluded, or facing-away screen reads.
  await expect.poll(() => redPixelShare(canvas), { timeout: 10_000 }).toBeGreaterThan(0.08)
})
