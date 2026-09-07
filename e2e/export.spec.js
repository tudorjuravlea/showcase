import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PNG = path.join(__dirname, 'fixtures', 'red-dot.png')

// Records distinct rendered states of an exported page from *before* any of
// its own scripts run, into window.__maFrames.
//
// Sampling from the test side instead (two reads a fixed delay apart) is
// racy: an exported animation autoplays from mount, so under parallel load
// both reads can land after it has finished and two identical end-state
// reads look like "never animated". This rAF loop starts before the runtime
// mounts and sees every frame the page paints, so the assertion is "the page
// painted at least two distinct states", not "it had changed by the time we
// happened to look". (The exports under test also loop — see below — so
// there is no settled end state to race against in the first place.)
//
// `selector` picks the element; `mode` is 'canvas' (WebGL: a 16x16 downscale
// of the canvas, cheap enough to take every frame) or 'transform' (CSS: the
// device's own transform string). Blank/unpainted samples are skipped so the
// count means "distinct painted states", and it stops at 4 to stay cheap.
async function recordRenderedFrames(exportedPage, selector, mode) {
  await exportedPage.addInitScript(
    ([sel, kind]) => {
      window.__maFrames = []
      const probe = document.createElement('canvas')
      probe.width = 16
      probe.height = 16
      const ctx = probe.getContext('2d', { willReadFrequently: true })
      const sample = (el) => {
        if (kind === 'transform') return el.style.transform || ''
        ctx.clearRect(0, 0, 16, 16)
        ctx.drawImage(el, 0, 0, 16, 16)
        const { data } = ctx.getImageData(0, 0, 16, 16)
        let painted = false
        for (let i = 3; i < data.length; i += 4) {
          if (data[i] !== 0) {
            painted = true
            break
          }
        }
        return painted ? data.join(',') : ''
      }
      const tick = () => {
        if (window.__maFrames.length < 4) {
          const el = document.querySelector(sel)
          const key = el ? sample(el) : ''
          if (key && !window.__maFrames.includes(key)) window.__maFrames.push(key)
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    },
    [selector, mode]
  )
}

function distinctFrameCount(exportedPage) {
  return exportedPage.evaluate(() => window.__maFrames?.length ?? 0)
}

test('exported HTML is self-contained, styled, and animates like the editor', async ({ page, context }, testInfo) => {
  await page.goto('/')

  // Give the scene an inlined data-URI image so the exported file has real
  // content to render (an empty content.src would make the network-request
  // assertion below meaningless).
  await page.locator('.ma-file-input').setInputFiles(FIXTURE_PNG)
  await page.locator('#ma-preset-rotate-in').click() // autoplay defaults to true
  // Looped for the same reason as the WebGL export test below: a one-shot
  // 2000ms animation can finish inside a single starved frame, leaving the
  // exported page with only one distinct rendered state to observe.
  await page.locator('#ma-loop').check()

  // A custom style.background must flow into the export unchanged — the
  // renderer reads it straight off the scene JSON embedded in the file.
  await page.locator('#ma-style-background-toggle').check()
  await page.locator('#ma-style-background').fill('#123456')

  const downloadPromise = page.waitForEvent('download')
  await page.locator('#ma-export').click()
  const download = await downloadPromise

  const savePath = testInfo.outputPath('export.html')
  await download.saveAs(savePath)

  const exportedPage = await context.newPage()
  const failedRequests = []
  exportedPage.on('requestfailed', (request) => failedRequests.push(request.url()))

  await recordRenderedFrames(exportedPage, '.ma-device', 'transform')
  await exportedPage.goto(`file://${savePath}`)

  const deviceEl = exportedPage.locator('.ma-device')
  await expect(deviceEl).toBeVisible()

  // The exported page ships no app CSS, so it has to reset the UA body
  // margin and center the device itself — otherwise the device sits in the
  // top-left corner, 8px in.
  await expect(exportedPage.locator('body')).toHaveCSS('margin-top', '0px')
  // Measured on #ma-root (the flex item) rather than .ma-device, whose
  // bounding box is skewed by the running rotate-in transform.
  const centering = await exportedPage.evaluate(() => {
    const rect = document.querySelector('#ma-root').getBoundingClientRect()
    return {
      centerOffset: Math.abs(rect.left + rect.width / 2 - window.innerWidth / 2),
      left: rect.left,
    }
  })
  expect(centering.centerOffset).toBeLessThan(2)
  expect(centering.left).toBeGreaterThan(8)

  // The renderer paints style.background on its own root (#ma-root here —
  // see src/export/exporter.js), not just in the live editor's .ma-stage.
  await expect(exportedPage.locator('#ma-root')).toHaveCSS('background-color', 'rgb(18, 52, 86)')

  // rotate-in autoplays over the scene's 2000ms default duration, so the
  // device's transform must take at least two distinct values across the
  // run (recorded in-page from load — see recordRenderedFrames).
  await expect.poll(() => distinctFrameCount(exportedPage)).toBeGreaterThan(1)

  expect(failedRequests).toEqual([])

  await exportedPage.close()
})

test('an exported scroll-rotate scene scrolls standalone and rotates with scroll progress', async ({
  page,
  context,
}, testInfo) => {
  await page.goto('/')
  await page.locator('.ma-file-input').setInputFiles(FIXTURE_PNG)
  await page.locator('#ma-preset-scroll-rotate').click()

  const downloadPromise = page.waitForEvent('download')
  await page.locator('#ma-export').click()
  const download = await downloadPromise

  const savePath = testInfo.outputPath('export-scroll.html')
  await download.saveAs(savePath)

  const exportedPage = await context.newPage()
  await exportedPage.goto(`file://${savePath}`)

  const deviceEl = exportedPage.locator('.ma-device')
  await expect(deviceEl).toBeVisible()

  // The export shell has to be taller than the viewport or there is nothing
  // to scroll and the preset is inert (which is exactly what shipped).
  const scrollable = await exportedPage.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight
  )
  expect(scrollable).toBeGreaterThan(200)

  const rotateY = async () => {
    const style = await deviceEl.getAttribute('style')
    return Number(style.match(/rotateY\((-?[\d.]+)deg\)/)[1])
  }

  const atTop = await rotateY()
  await exportedPage.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect.poll(rotateY).not.toBe(atTop)
  const atBottom = await rotateY()

  // scroll-rotate maps progress 0..1 onto rotateY -45..45, so scrolling the
  // device up through the viewport must increase rotateY over a real span.
  expect(atBottom).toBeGreaterThan(atTop)
  expect(atBottom - atTop).toBeGreaterThan(20)
  expect(atTop).toBeGreaterThanOrEqual(-45)
  expect(atBottom).toBeLessThanOrEqual(45)

  await exportedPage.close()
})

test('exported WebGL HTML is self-contained, renders a canvas, and animates standalone', async ({
  page,
  context,
}, testInfo) => {
  await page.goto('/')
  await page.locator('.ma-file-input').setInputFiles(FIXTURE_PNG)
  await page.locator('#ma-photoreal-toggle').check()
  await page.locator('#ma-preset-rotate-in').click() // autoplay defaults to true
  // Looped so the exported animation never settles. A one-shot 2000ms
  // rotate-in is unobservable when the exported page is starved of frames
  // for longer than its duration (5 parallel Playwright workers each running
  // WebGL): the timeline is wall-clock driven, so the first rAF after such a
  // stall jumps straight to t=1 and every frame the page ever paints is the
  // same settled one. That was the flake — not a slow sample.
  await page.locator('#ma-loop').check()

  const downloadPromise = page.waitForEvent('download')
  await page.locator('#ma-export').click()
  const download = await downloadPromise

  const savePath = testInfo.outputPath('export-webgl.html')
  await download.saveAs(savePath)

  const exportedPage = await context.newPage()
  const failedRequests = []
  const consoleErrors = []
  exportedPage.on('requestfailed', (request) => failedRequests.push(request.url()))
  exportedPage.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })

  await recordRenderedFrames(exportedPage, '#ma-root canvas', 'canvas')
  await exportedPage.goto(`file://${savePath}`)

  // The exported HTML mounts directly onto #ma-root (see
  // src/export/runtime-gl-entry.js) — there's no .ma-stage wrapper outside
  // the editor's own React markup.
  const canvas = exportedPage.locator('#ma-root canvas')
  await expect(canvas).toBeVisible()

  // rotate-in autoplays over the scene's 2000ms default duration, so the
  // canvas must paint at least two distinct images across the run if the
  // WebGL scene is really re-rendering each animation frame (recorded
  // in-page from load — see recordRenderedFrames).
  await expect.poll(() => distinctFrameCount(exportedPage)).toBeGreaterThan(1)

  expect(failedRequests).toEqual([])
  expect(consoleErrors).toEqual([])

  await exportedPage.close()
})

test('an exported WebGL file shows a static fallback message when WebGL is unavailable', async ({
  page,
  context,
}, testInfo) => {
  await page.goto('/')
  await page.locator('.ma-file-input').setInputFiles(FIXTURE_PNG)
  await page.locator('#ma-photoreal-toggle').check()

  const downloadPromise = page.waitForEvent('download')
  await page.locator('#ma-export').click()
  const download = await downloadPromise

  const savePath = testInfo.outputPath('export-webgl-fallback.html')
  await download.saveAs(savePath)

  const exportedPage = await context.newPage()
  const pageErrors = []
  exportedPage.on('pageerror', (err) => pageErrors.push(err.message))

  // Simulate a browser without WebGL: the export can be opened anywhere, so
  // the editor's own availability check can't cover this. Installed before
  // any page script runs, so the runtime's mount() hits it on first try.
  await exportedPage.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      if (String(type).startsWith('webgl')) return null
      return original.call(this, type, ...rest)
    }
  })

  await exportedPage.goto(`file://${savePath}`)

  const fallback = exportedPage.locator('#ma-root .ma-fallback')
  await expect(fallback).toBeVisible()
  await expect(fallback).toContainText('WebGL')
  // No canvas, and — crucially — mount() swallowed the failure instead of
  // leaving a blank page behind an uncaught error.
  await expect(exportedPage.locator('#ma-root canvas')).toHaveCount(0)
  expect(pageErrors).toEqual([])

  await exportedPage.close()
})
