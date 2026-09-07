// Two e2e smokes for bin/showcase.mjs (see docs/superpowers/specs/2026-09-04-
// showcase-design.md's Economy constraints: "ONE e2e smoke per output kind").
// Both spawn the real CLI as a subprocess (not an in-process function call) —
// end-to-end means going through argv, ffprobe, vite build/preview, and a
// real headless Chromium, exactly as a user's `npm run showcase -- ...`
// would. Pure argument/fit/timing math is unit-tested instead, in
// tests/showcase-cli.test.js.
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { test, expect, chromium } from '@playwright/test'

const execFileAsync = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const CLI = path.join(ROOT, 'bin', 'showcase.mjs')
const FIXTURE = path.join(__dirname, 'fixtures', 'showcase-sample.mp4')

async function runCli(args, timeoutMs) {
  return execFileAsync('node', [CLI, ...args], { cwd: ROOT, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 })
}

// A distinctive backdrop for the full-bleed assertion below: nothing in the
// device render or the fixture's content is anywhere near this yellow, so
// "column contains only near-background pixels" is an unambiguous read of
// "this column is a background pillar".
const PILLAR_BACKGROUND = '#FFCC00'
const PILLAR_RGB = [0xff, 0xcc, 0x00]
// Generous per-channel tolerance: h264 (yuv420p, 4:2:0 chroma) does not
// round-trip a saturated flat color exactly, and the scene's own lighting
// tints the backdrop slightly. Still nowhere near any screen content.
const PILLAR_TOLERANCE = 40

/**
 * Decodes one frame of `videoPath` at `atSeconds` to raw RGB via ffmpeg and
 * measures the ending framing:
 *
 * - `backgroundColumns`: columns that are background top to bottom — the
 *   pillars the exact-size canvas fix exists to eliminate.
 * - `backgroundPixels` / `backgroundDepth`: how much backdrop is still in
 *   frame and how far from a corner the furthest such pixel sits. At the
 *   ending this must be ZERO: the screen sits at exact screen-fit (so nothing
 *   of it is cropped) AND its corners have been squared off by then (see
 *   setScreenCorners / the reference look's cornerScale), so the frame is
 *   100% content, corners included.
 * - `gaps`: distance in px from each frame edge's MIDPOINT to the first
 *   non-background pixel — 0 means the content reaches that edge.
 */
async function endingFrameStats(videoPath, atSeconds) {
  const { stdout: dims } = await execFileAsync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', videoPath,
  ])
  const [width, height] = dims.trim().split(',').map(Number)

  const { stdout: raw } = await execFileAsync(
    'ffmpeg',
    ['-v', 'error', '-ss', String(atSeconds), '-i', videoPath, '-frames:v', '1',
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
  )
  const pixels = Buffer.from(raw)
  // A short read would make every out-of-range byte `undefined`, i.e. compare
  // as background, i.e. pass this scan vacuously. Fail loudly instead.
  if (pixels.length !== width * height * 3) {
    throw new Error(`decoded ${pixels.length} bytes for a ${width}x${height} frame, expected ${width * height * 3}`)
  }

  const at = (x, y) => (y * width + x) * 3
  const isBackground = (i) =>
    Math.abs(pixels[i] - PILLAR_RGB[0]) <= PILLAR_TOLERANCE &&
    Math.abs(pixels[i + 1] - PILLAR_RGB[1]) <= PILLAR_TOLERANCE &&
    Math.abs(pixels[i + 2] - PILLAR_RGB[2]) <= PILLAR_TOLERANCE

  let backgroundPixels = 0
  // How deep into the frame the backdrop reaches, measured from the nearest
  // corner: max over background pixels of max(distance to nearer vertical
  // edge, distance to nearer horizontal edge). Small => corners only.
  let backgroundDepth = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isBackground(at(x, y))) continue
      backgroundPixels++
      const depth = Math.max(Math.min(x, width - 1 - x), Math.min(y, height - 1 - y))
      if (depth > backgroundDepth) backgroundDepth = depth
    }
  }

  let backgroundColumns = 0
  for (let x = 0; x < width; x++) {
    let allBackground = true
    for (let y = 0; y < height && allBackground; y++) {
      if (!isBackground(at(x, y))) allBackground = false
    }
    if (allBackground) backgroundColumns++
  }

  const midY = height >> 1
  const midX = width >> 1
  const scan = (n, probe) => {
    for (let k = 0; k < n; k++) if (!isBackground(probe(k))) return k
    return n
  }
  const gaps = {
    left: scan(width, (k) => at(k, midY)),
    right: scan(width, (k) => at(width - 1 - k, midY)),
    top: scan(height, (k) => at(midX, k)),
    bottom: scan(height, (k) => at(midX, height - 1 - k)),
  }

  return { width, height, backgroundPixels, backgroundColumns, backgroundDepth, gaps }
}

// Playwright requires the first param to be an object-destructuring pattern
// even when no fixture is needed.
// oxlint-disable-next-line no-empty-pattern
test('CLI produces a valid MP4 at the requested size/fps/duration, ending edge-to-edge', async ({}, testInfo) => {
  test.setTimeout(180_000)
  const outPath = testInfo.outputPath('showcase-smoke.mp4')

  const { stderr } = await runCli(
    [FIXTURE, '--size', '360', '--fps', '12', '--duration', '4', '--out', outPath, '--background', PILLAR_BACKGROUND],
    170_000,
  )
  expect(stderr).toContain(`wrote ${outPath}`)

  const stat = await fs.stat(outPath)
  expect(stat.size).toBeGreaterThan(50 * 1024)

  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,width,height',
    '-show_entries', 'format=duration',
    '-of', 'json',
    outPath,
  ])
  const probe = JSON.parse(stdout)
  const stream = probe.streams[0]

  expect(stream.codec_name).toBe('h264')
  // The fixture (644x1332) is portrait on the default phone device, and
  // --size 360 is the short side — see bin/showcase.mjs's outputDimensions
  // (360 short side -> 784 long side, derived from the phone screen's own
  // aspect, not from 16:9).
  expect(stream.width).toBe(360)
  expect(stream.height).toBe(784)
  expect(Number(probe.format.duration)).toBeGreaterThan(3.5)
  expect(Number(probe.format.duration)).toBeLessThan(4.5)

  // The decisive assertion for the ending: at screen-fit the WHOLE screen is
  // in frame and it exactly fills the frame. Sampled inside the final ~1% —
  // AFTER the post-snap corner melt completes (referenceCornerMelt caps
  // meltEnd at t=0.985; before that the landed frames deliberately show the
  // rounded corners per Tudor's snap-then-dissolve ordering).
  //
  // (The renderer used to aspect-fit its drawing buffer to the device layout —
  // a 360-wide request rendered ~295 wide — and ffmpeg padded the rest with
  // the background color, so every frame carried ~32 background columns per
  // side no matter how far the camera pushed in; hence the background checks.)
  const durationSec = Number(probe.format.duration)
  // Sample the LAST encoded frame: seeking past the final frame's PTS decodes
  // zero bytes (duration*0.995 overshoots on a 4s/12fps clip whose last frame
  // starts at ~3.92s). 1.5 frame-intervals back from the end is always inside.
  const stats = await endingFrameStats(outPath, durationSec - 1.5 / 12)
  expect(stats.width).toBe(360)
  expect(stats.backgroundColumns).toBe(0)

  // Content reaches all four edge midpoints with no gap at all.
  expect(stats.gaps).toEqual({ left: 0, right: 0, top: 0, bottom: 0 })

  // ...and NOT ONE background pixel anywhere in the frame, corners included.
  // This is the two-part ending: screen-fit frames the whole screen (so the
  // content is uncropped) and the corner-squaring (cornerScale 0) removes the
  // rounded corners that would otherwise leave four slivers of backdrop in
  // the frame's own corners. Both halves are needed — drop either and this
  // count goes non-zero.
  expect(stats.backgroundPixels).toBe(0)
  expect(stats.backgroundDepth).toBe(0)
})

test('--html export opens offline via file://, shows an animating canvas, and makes no network requests', async ({ page }, testInfo) => {
  // Hangs on GitHub-hosted runners (macOS and Linux alike): the hero canvas
  // never becomes ready/stable there, while the MP4 path drives the same
  // renderer fine. Tracked in issue #1; still a required local gate.
  test.skip(!!process.env.CI, 'fails on GitHub-hosted runners — see issue #1')
  test.setTimeout(120_000)
  const outPath = testInfo.outputPath('showcase-smoke.html')

  const { stderr } = await runCli([FIXTURE, '--duration', '3', '--out', outPath, '--html'], 110_000)
  expect(stderr).toContain(`wrote ${outPath}`)

  const stat = await fs.stat(outPath)
  expect(stat.size).toBeGreaterThan(10 * 1024)

  const failedRequests = []
  page.on('requestfailed', (req) => failedRequests.push(req.url()))
  const consoleErrors = []
  page.on('pageerror', (err) => consoleErrors.push(String(err)))

  await page.goto(`file://${outPath}`)

  const canvas = page.locator('#stage canvas')
  await expect(canvas).toBeVisible()

  // The canvas buffer is authored at full output resolution (larger than most
  // embedding viewports); on the page it must SCALE TO FIT, or the window
  // itself crops the device no matter what the camera does. Assert against a
  // deliberately small viewport, portrait-canvas-hostile (wide, short).
  await page.setViewportSize({ width: 900, height: 600 })
  const box = await canvas.boundingBox()
  expect(box.width).toBeLessThanOrEqual(900)
  expect(box.height).toBeLessThanOrEqual(600)
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  // ...and the fit must be PROPORTIONAL: the on-page box keeps the drawing
  // buffer's aspect ratio (a height-only clamp visibly stretches the device).
  const bufRatio = await canvas.evaluate((el) => el.width / el.height)
  expect(box.width / box.height).toBeCloseTo(bufRatio, 2)

  // Live mode plays the intro look then idles with a float loop — two
  // screenshots ~1s apart must differ (the "not a frozen frame" check).
  const shot1 = await canvas.screenshot()
  await page.waitForTimeout(1000)
  const shot2 = await canvas.screenshot()
  expect(shot1.equals(shot2)).toBe(false)

  expect(failedRequests).toEqual([])
  expect(consoleErrors).toEqual([])
})

// A solid-black PNG this size compresses (deflate) to well under 1KB — a
// real device/photo frame does not — so buffer size is a cheap, decoder-free
// proxy for "this isn't a black rectangle" in the two sandboxed smokes below.
// The fixture is a small synthetic clip (mostly flat backdrop + one small
// moving square in frame at any instant, see e2e/fixtures/README.md) rather
// than a busy screen recording, so its rendered frames compress smaller too —
// the bar is set well above the solid-black floor but below what this
// simpler content actually produces (~4.5KB measured for the autoplay-blocked
// still frame).
const NOT_BLACK_BYTES = 3 * 1024

// oxlint-disable-next-line no-empty-pattern
test('--html export inside an autoplay-blocked sandbox shows a non-black still frame + play button, and the button starts playback', async ({}, testInfo) => {
  // Same GitHub-runner hang as the file:// test above — issue #1.
  test.skip(!!process.env.CI, 'fails on GitHub-hosted runners — see issue #1')
  test.setTimeout(120_000)
  const outPath = testInfo.outputPath('showcase-autoplay-blocked.html')

  const { stderr } = await runCli([FIXTURE, '--duration', '3', '--out', outPath, '--html'], 110_000)
  expect(stderr).toContain(`wrote ${outPath}`)

  // `--autoplay-policy=user-gesture-required` is the documented way to force
  // this, but this Chromium build reports navigator.userActivation.isActive
  // === true immediately after any Playwright-driven navigation (headless
  // automation quirk, confirmed by probing it directly) — so the real policy
  // never actually blocks anything here. Simulating the rejection directly at
  // the play() call exercises the exact same fallback code path
  // deterministically, regardless of that quirk.
  const browser = await chromium.launch({ args: ['--autoplay-policy=user-gesture-required'] })
  try {
    const page = await browser.newPage()
    await page.addInitScript(() => {
      const realPlay = HTMLMediaElement.prototype.play
      let blockNext = true
      HTMLMediaElement.prototype.play = function play() {
        if (blockNext) {
          blockNext = false
          return Promise.reject(new DOMException('play() failed: no user gesture', 'NotAllowedError'))
        }
        return realPlay.call(this)
      }
    })
    await page.goto(`file://${outPath}`)

    const canvas = page.locator('#stage canvas')
    await expect(canvas).toBeVisible()

    const playButton = page.locator('#ma-hero-play')
    await expect(playButton).toBeVisible()

    const stillShot = await canvas.screenshot({ type: 'png' })
    expect(stillShot.length).toBeGreaterThan(NOT_BLACK_BYTES)

    await playButton.click()
    await expect(playButton).toBeHidden()

    // Playback actually started: two screenshots ~1s apart differ.
    const shot1 = await canvas.screenshot()
    await page.waitForTimeout(1000)
    const shot2 = await canvas.screenshot()
    expect(shot1.equals(shot2)).toBe(false)
  } finally {
    await browser.close()
  }
})

test.describe('--html export inside a scripts-disabled sandbox', () => {
  test.use({ javaScriptEnabled: false })

  test('shows the static poster frame in place of the (never-initialized) canvas', async ({ page }, testInfo) => {
    test.setTimeout(120_000)
    const outPath = testInfo.outputPath('showcase-no-js.html')

    const { stderr } = await runCli([FIXTURE, '--duration', '3', '--out', outPath, '--html'], 110_000)
    expect(stderr).toContain(`wrote ${outPath}`)

    await page.goto(`file://${outPath}`)

    const poster = page.locator('#ma-hero-poster')
    await expect(poster).toBeVisible()

    const posterShot = await poster.screenshot({ type: 'png' })
    expect(posterShot.length).toBeGreaterThan(NOT_BLACK_BYTES)
  })
})
