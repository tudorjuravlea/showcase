import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PNG = path.join(__dirname, 'fixtures', 'red-dot.png')

const DEVICE_NAMES = ['phone', 'tablet', 'laptop', 'browser']

test('editor loads with a device visible', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.ma-device')).toBeVisible()
})

for (const device of DEVICE_NAMES) {
  test(`selecting ${device} shows .ma-device`, async ({ page }) => {
    await page.goto('/')
    await page.locator('#ma-device-select').selectOption(device)
    const deviceEl = page.locator('.ma-device')
    await expect(deviceEl).toBeVisible()
    await expect(deviceEl).toHaveAttribute('data-device', device)
  })
}

test('moving the rotateY slider changes the transform style attribute', async ({ page }) => {
  await page.goto('/')
  const deviceEl = page.locator('.ma-device')
  const before = await deviceEl.getAttribute('style')

  const slider = page.locator('#ma-rotateY')
  await slider.focus()
  await slider.press('End') // native range input: jumps to max (60)

  await expect(deviceEl).toHaveAttribute('style', /rotateY\(60deg\)/)
  const after = await deviceEl.getAttribute('style')
  expect(after).not.toBe(before)
})

test('phone at rotateY 35deg exposes shaded side-wall elements with nonzero rendered size', async ({ page }) => {
  await page.goto('/')

  const slider = page.locator('#ma-rotateY')
  await slider.focus()
  for (let i = 0; i < 35; i += 1) await slider.press('ArrowRight') // default 0 -> 35

  const walls = page.locator('.ma-body .ma-box-wall')
  await expect(walls).toHaveCount(4)
  const boxes = await walls.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect()
      return { width: r.width, height: r.height }
    })
  )
  // Rotating around Y swings the left/right walls into view (they are the
  // ones whose normals lie in the rotation plane; the top/bottom walls stay
  // near edge-on for a pure Y rotation — see cssRenderer.js buildBodyBox())
  // — at least one wall must have real on-screen area, not a degenerate
  // paper-thin sliver.
  const visibleWalls = boxes.filter((b) => b.width > 1 && b.height > 1)
  expect(visibleWalls.length).toBeGreaterThan(0)
})

test('laptop straight-on shows an upright lid with a thin base slab hinged below it', async ({ page }) => {
  await page.goto('/')
  await page.locator('#ma-device-select').selectOption('laptop')

  const lidBox = await page.locator('.ma-lid').boundingBox()
  expect(lidBox.height).toBeGreaterThan(lidBox.width / 2)

  const baseBox = await page.locator('.ma-laptop-base').boundingBox()
  expect(baseBox).not.toBeNull()
  // Straight-on (rotateX 0), the folded-flat base reads as a thin edge below
  // the lid, not a tall front-facing panel — a small fraction of the lid's
  // own height, sitting at (allowing a little perspective parallax past)
  // the hinge line.
  expect(baseBox.height).toBeGreaterThan(0)
  expect(baseBox.height).toBeLessThan(lidBox.height / 4)
  expect(baseBox.y + baseBox.height).toBeGreaterThanOrEqual(lidBox.y + lidBox.height - 1)
})

// Measures the projected on-screen width of a 3D-transformed element's own
// top and bottom edges by temporarily appending two full-width, 1px-tall
// probe divs inside it. They inherit the element's accumulated 3D matrix
// (everything up the chain is transform-style: preserve-3d under
// .ma-device's perspective()), so their bounding rects are the perspective
// projections of those two edges — the measurement getBoundingClientRect()
// on the element itself cannot give, since that is a single axis-aligned
// box around all four corners.
async function projectedEdgeWidths(locator) {
  return locator.evaluate((host) => {
    const probeAt = (edge) => {
      const el = document.createElement('div')
      el.style.cssText = `position:absolute;left:0;right:0;height:1px;${edge}:0`
      host.appendChild(el)
      const { width } = el.getBoundingClientRect()
      el.remove()
      return width
    }
    return { top: probeAt('top'), bottom: probeAt('bottom') }
  })
}

// Regression cover for the v2 final review's C1: the CSS lid used to fold
// the opposite way from the WebGL renderer and the spec, so the default
// lidAngle 110 tipped the screen's top TOWARD the viewer (top edge projected
// WIDER than the bottom) instead of the spec's ~20deg back tilt.
test('laptop lid tilts back at the default lid angle: projected top edge narrower than the bottom', async ({
  page,
}) => {
  await page.goto('/')
  await page.locator('#ma-device-select').selectOption('laptop')

  const slider = page.locator('#ma-rotateX')
  await slider.focus()
  for (let i = 0; i < 15; i += 1) await slider.press('ArrowRight') // default 0 -> 15

  const lid = await projectedEdgeWidths(page.locator('.ma-lid'))
  expect(lid.top).toBeGreaterThan(0)
  // Back tilt pushes the lid's top edge to negative Z (further from the
  // camera), so perspective shrinks it. A flipped sign inverts this.
  expect(lid.top).toBeLessThan(lid.bottom * 0.95)

  // The keyboard deck runs the other way: its far edge comes toward the
  // viewer (positive Z), so it projects wider than the hinge edge it starts
  // from. rotateX(-90deg) on .ma-laptop-base sends it backwards instead.
  const base = await projectedEdgeWidths(page.locator('.ma-laptop-base'))
  expect(base.bottom).toBeGreaterThan(base.top * 1.05)
})

// Recovers the lid's X-rotation in degrees from its own computed transform
// matrix: rotateX(a) puts cos a in m22 and sin a in m23, so atan2 gives the
// signed angle back exactly, independent of perspective or any ancestor
// transform.
async function lidRotationDeg(page) {
  return page.locator('.ma-lid').evaluate((el) => {
    const m = new DOMMatrix(getComputedStyle(el).transform)
    return (Math.atan2(m.m23, m.m22) * 180) / Math.PI
  })
}

async function setLidAngle(page, value) {
  await page.locator('#ma-lidAngle').fill(String(value))
}

// The direction-only assertion above passes at +20deg AND at, say, +70deg —
// a formula slip such as rotateX(180 - lidAngle) would sail through it. These
// pin the magnitude too: the exact hinge angle from the transform matrix, and
// the rendered consequence of it.
test('laptop lid hinge angle tracks lidAngle - 90 in magnitude, not just sign', async ({ page }) => {
  await page.goto('/')
  await page.locator('#ma-device-select').selectOption('laptop')

  for (const lidAngle of [0, 45, 90, 110, 130]) {
    await setLidAngle(page, lidAngle)
    expect(await lidRotationDeg(page)).toBeCloseTo(lidAngle - 90, 1)
  }
})

test('laptop at the default lid angle renders a near-upright screen, not a heavily reclined one', async ({
  page,
}) => {
  await page.goto('/')
  await page.locator('#ma-device-select').selectOption('laptop')

  const lidHeight = () => page.locator('.ma-lid').evaluate((el) => el.getBoundingClientRect().height)

  await setLidAngle(page, 90) // dead vertical: the unforeshortened reference
  const upright = await lidHeight()
  await setLidAngle(page, 110) // the scene default
  const tilted = await lidHeight()

  const ratio = tilted / upright
  // Measured 0.858. Not cos(20deg) = 0.94, because perspective foreshortens
  // on top of the rotation: at rotateX 0 the lid's top edge ends up ~178px
  // further from the camera than the hinge, which costs the remaining ~8%.
  // The WebGL renderer measures 0.886 the same way — a 1.4% difference in the
  // screen's projected aspect ratio, which is the deferred perspective-strength
  // gap, not a hinge disagreement.
  //
  // The band is what makes this a magnitude test. Analytic values for the
  // same measurement at other hinge angles: 0deg (no tilt at all) -> 1.000,
  // 40deg -> 0.666, 70deg -> 0.332. So a lid that is upright, or reclined
  // anywhere near double the spec's ~20deg, fails here.
  expect(ratio).toBeGreaterThan(0.8)
  expect(ratio).toBeLessThan(0.95)
})

test('laptop at rotateX 15deg reveals the keyboard deck', async ({ page }) => {
  await page.goto('/')
  await page.locator('#ma-device-select').selectOption('laptop')

  const slider = page.locator('#ma-rotateX')
  await slider.focus()
  for (let i = 0; i < 15; i += 1) await slider.press('ArrowRight') // default 0 -> 15

  const deck = page.locator('.ma-laptop-base .ma-box-front')
  await expect(deck).toBeVisible()
  const deckBox = await deck.boundingBox()
  // Flat-on (rotateX 0) the base is edge-on (near-zero height); tilting the
  // pose must foreshorten it open into a real visible deck.
  expect(deckBox.height).toBeGreaterThan(10)
})

test('dropping a fixture PNG shows it inside .ma-screen img', async ({ page }) => {
  await page.goto('/')
  await page.locator('.ma-file-input').setInputFiles(FIXTURE_PNG)

  const screenImg = page.locator('.ma-screen img.ma-content')
  await expect(screenImg).toBeVisible()
  await expect(screenImg).toHaveAttribute('src', /^data:image\/png;base64,/)
})

test('laptop explode composites shell/body translateZ under a preserve-3d base', async ({ page }) => {
  await page.goto('/')
  await page.locator('#ma-device-select').selectOption('laptop')

  const explodeSlider = page.locator('#ma-explode')
  await explodeSlider.focus()
  await explodeSlider.press('End') // jumps to max (1)

  // shell (index 0, depth 0): translateZ(0 + 1*60*0) = 0px
  await expect(page.locator('.ma-laptop-base .ma-shell')).toHaveAttribute(
    'style',
    /translateZ\(0px\)/
  )
  // body (index 1, depth 4): translateZ(4 + 1*60*1) = 64px
  await expect(page.locator('.ma-laptop-base .ma-body')).toHaveAttribute(
    'style',
    /translateZ\(64px\)/
  )

  const baseTransformStyle = await page
    .locator('.ma-laptop-base')
    .evaluate((el) => getComputedStyle(el).transformStyle)
  expect(baseTransformStyle).toBe('preserve-3d')
})

test('picking rotate-in and pressing Play animates the device transform over time', async ({ page }) => {
  await page.goto('/')

  await page.locator('#ma-preset-rotate-in').click()
  await page.locator('#ma-play').click()

  const deviceEl = page.locator('.ma-device')
  const first = await deviceEl.getAttribute('style')
  await page.waitForTimeout(300)
  const second = await deviceEl.getAttribute('style')

  expect(second).not.toBe(first)
})

test('picking orbit with loop keeps animating indefinitely', async ({ page }) => {
  await page.goto('/')

  await page.locator('#ma-preset-orbit').click()
  await page.locator('#ma-loop').check()
  await page.locator('#ma-play').click()

  const deviceEl = page.locator('.ma-device')
  const first = await deviceEl.getAttribute('style')
  await page.waitForTimeout(300)
  const second = await deviceEl.getAttribute('style')
  await page.waitForTimeout(300)
  const third = await deviceEl.getAttribute('style')

  expect(second).not.toBe(first)
  expect(third).not.toBe(second)
})

test('toggling Photoreal with an image scene shows a WebGL canvas and logs no console errors', async ({ page }) => {
  const consoleErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(err.message))

  await page.goto('/')
  await page.locator('.ma-file-input').setInputFiles(FIXTURE_PNG)

  const toggle = page.locator('#ma-photoreal-toggle')
  await expect(toggle).toBeEnabled()
  await toggle.check()

  await expect(page.locator('.ma-stage canvas')).toBeVisible()
  await page.waitForTimeout(200) // let texture load / first frames render
  expect(consoleErrors).toEqual([])
})

test('Photoreal toggle is enabled for the browser device with image content', async ({ page }) => {
  await page.goto('/')
  await page.locator('.ma-file-input').setInputFiles(FIXTURE_PNG)
  await page.locator('#ma-device-select').selectOption('browser')

  const toggle = page.locator('#ma-photoreal-toggle')
  await expect(toggle).toBeEnabled()
  await expect(page.locator('#ma-renderer-notice')).toHaveCount(0)

  await toggle.check()
  await expect(page.locator('.ma-stage canvas')).toBeVisible()
})

test('Photoreal toggle is disabled with a notice for live URL content', async ({ page }) => {
  await page.goto('/')
  await page.locator('#ma-url-input').fill('https://example.com')
  await page.getByRole('button', { name: 'Use URL' }).click()

  await expect(page.locator('#ma-photoreal-toggle')).toBeDisabled()
  await expect(page.locator('#ma-renderer-notice')).toBeVisible()
})

test('switching to the browser device while Photoreal is on keeps rendering via WebGL', async ({ page }) => {
  await page.goto('/')
  await page.locator('.ma-file-input').setInputFiles(FIXTURE_PNG)
  await page.locator('#ma-photoreal-toggle').check()
  await expect(page.locator('.ma-stage canvas')).toBeVisible()

  await page.locator('#ma-device-select').selectOption('browser')

  const toggle = page.locator('#ma-photoreal-toggle')
  await expect(toggle).toBeChecked()
  await expect(toggle).toBeEnabled()
  await expect(page.locator('#ma-renderer-notice')).toHaveCount(0)
  await expect(page.locator('.ma-stage canvas')).toBeVisible()
})

test('switching to live URL content while Photoreal is on tears down the canvas and falls back to CSS', async ({
  page,
}) => {
  await page.goto('/')
  await page.locator('.ma-file-input').setInputFiles(FIXTURE_PNG)
  await page.locator('#ma-photoreal-toggle').check()
  await expect(page.locator('.ma-stage canvas')).toBeVisible()

  await page.locator('#ma-url-input').fill('https://example.com')
  await page.getByRole('button', { name: 'Use URL' }).click()

  const toggle = page.locator('#ma-photoreal-toggle')
  await expect(toggle).not.toBeChecked()
  await expect(toggle).toBeDisabled()
  await expect(page.locator('#ma-renderer-notice')).toBeVisible()
  await expect(page.locator('.ma-stage canvas')).toHaveCount(0)
  await expect(page.locator('.ma-screen iframe.ma-content')).toBeVisible()
})

test('dragging a pose slider does not tear down a live iframe (url content)', async ({ page }) => {
  await page.goto('/')

  await page.locator('#ma-url-input').fill('https://example.com')
  await page.getByRole('button', { name: 'Use URL' }).click()

  const iframe = page.locator('.ma-screen iframe.ma-content')
  await expect(iframe).toHaveCount(1)
  await iframe.evaluate((el) => {
    el.dataset.marker = 'kept'
  })

  const rotateYSlider = page.locator('#ma-rotateY')
  await rotateYSlider.focus()
  await rotateYSlider.press('End') // jumps to max (60) -> pose-only change

  await expect(page.locator('.ma-device')).toHaveAttribute('style', /rotateY\(60deg\)/)
  // still the same DOM node (our marker survived) and no duplicate iframe was created
  await expect(iframe).toHaveAttribute('data-marker', 'kept')
  await expect(page.locator('.ma-screen iframe.ma-content')).toHaveCount(1)
})

test('dropping a non-image file shows a toast and keeps the previous content', async ({ page }) => {
  // Throws "Cannot read properties of null (reading 'timeout')" on
  // GitHub-hosted runners (macOS and Linux) — issue #1; local gate only.
  test.skip(!!process.env.CI, 'fails on GitHub-hosted runners — see issue #1')
  await page.goto('/')
  await page.locator('.ma-file-input').setInputFiles(FIXTURE_PNG)
  const screenImg = page.locator('.ma-screen img.ma-content')
  const previousSrc = await screenImg.getAttribute('src')

  await page.locator('.ma-file-input').setInputFiles({
    name: 'not-an-image.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('this is not an image'),
  })

  await expect(page.locator('#ma-toast')).toBeVisible()
  await expect(page.locator('#ma-toast')).toContainText('not-an-image.txt')
  // Previous image content is untouched.
  await expect(screenImg).toHaveAttribute('src', previousSrc)
})

test('a non-http(s) URL is rejected with a toast instead of reaching the scene', async ({ page }) => {
  await page.goto('/')

  await page.locator('#ma-url-input').fill('javascript:alert(1)')
  await page.getByRole('button', { name: 'Use URL' }).click()

  await expect(page.locator('#ma-toast')).toBeVisible()
  await expect(page.locator('#ma-toast')).toContainText('http')
  // Content type never flipped to url, so no iframe was ever created.
  await expect(page.locator('.ma-screen iframe.ma-content')).toHaveCount(0)

  // An ordinary https URL still goes through.
  await page.locator('#ma-url-input').fill('https://example.com')
  await page.getByRole('button', { name: 'Use URL' }).click()
  await expect(page.locator('.ma-screen iframe.ma-content')).toHaveCount(1)
})

test('picking live URL content shows a persistent X-Frame-Options hint', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#ma-xframe-hint')).toHaveCount(0)

  await page.locator('#ma-url-input').fill('https://example.com')
  await page.getByRole('button', { name: 'Use URL' }).click()

  await expect(page.locator('#ma-xframe-hint')).toBeVisible()

  await page.locator('.ma-file-input').setInputFiles(FIXTURE_PNG)
  await expect(page.locator('#ma-xframe-hint')).toHaveCount(0)
})

test('toggling the Style panel Glare checkbox adds/removes the glare layer', async ({ page }) => {
  await page.goto('/')
  // Default scene has style.glare: true.
  const glare = page.locator('.ma-glass .ma-glare')
  await expect(glare).toHaveCount(1)

  await page.locator('#ma-style-glare').uncheck()
  await expect(glare).toHaveCount(0)

  await page.locator('#ma-style-glare').check()
  await expect(glare).toHaveCount(1)
})

test('toggling the Style panel Glow checkbox adds/removes the glow halo', async ({ page }) => {
  await page.goto('/')
  const glow = page.locator('.ma-device > .ma-glow-halo')
  await expect(glow).toHaveCount(0) // default scene has style.glow: false

  await page.locator('#ma-style-glow').check()
  await expect(glow).toHaveCount(1)

  await page.locator('#ma-style-glow').uncheck()
  await expect(glow).toHaveCount(0)
})

test('enabling a custom background paints it on the stage root', async ({ page }) => {
  await page.goto('/')
  const stage = page.locator('.ma-stage')
  await expect(page.locator('#ma-style-background')).toHaveCount(0)

  await page.locator('#ma-style-background-toggle').check()
  const colorInput = page.locator('#ma-style-background')
  await expect(colorInput).toBeVisible()

  await colorInput.fill('#123456')
  await expect(stage).toHaveCSS('background-color', 'rgb(18, 52, 86)')

  await page.locator('#ma-style-background-toggle').uncheck()
  await expect(page.locator('#ma-style-background')).toHaveCount(0)
  await expect(stage).not.toHaveCSS('background-color', 'rgb(18, 52, 86)')
})
