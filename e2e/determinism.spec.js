// A frame is the same frame whatever was drawn before it. The runtime's
// seek(t) contract says every frame is a pure function of t, and the MP4
// pipeline's byte-identity depends on it — but the MP4 path only ever seeks
// FORWARD, so state accidentally kept between frames (the class of bug behind
// the sheen-veil regression) can hide from it. --stills seeks arbitrary
// moments in any order, so order independence is now a shipped behavior, not
// just hygiene. This spec hashes the same probe frames reached three ways:
// seeking forward, seeking backward, and after a jump to the end. Any
// mismatch means something on the page moves by itself or remembers the
// previous frame.
//
// It also asserts the renderer asks for nothing from the internet: content
// arrives as a data URI and everything else must come from the dev server.
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { outputDimensions } from '../bin/showcase.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(__dirname, 'fixtures', 'showcase-sample.mp4')

// Probes cover the reference look's distinct phases: entry, hold, push,
// ending. 0.999 is the final frame (seek takes progress in [0, 1)).
const PROBES = [0.04, 0.3, 0.62, 0.9, 0.999]

test('a frame is the same frame whatever was drawn before it, with no internet requests', async ({ page, baseURL }) => {
  test.setTimeout(120_000)

  const outside = []
  page.on('request', (req) => {
    const url = req.url()
    if (/^https?:/.test(url) && !url.startsWith(baseURL)) outside.push(url)
  })

  const { width, height } = outputDimensions('phone', 'portrait', 240)
  await page.setViewportSize({ width, height })
  await page.goto('/showcase.html')

  const content = await fs.readFile(FIXTURE)
  await page.evaluate((cfg) => window.__showcase.init(cfg), {
    device: 'phone',
    orientation: 'portrait',
    look: 'reference',
    duration: 6,
    width,
    height,
    content: { kind: 'video', url: `data:video/mp4;base64,${content.toString('base64')}` },
    activity: [],
    frame: 'gold',
    background: null,
    contained: false,
  })
  const canvas = page.locator('#stage canvas')
  await expect(canvas).toBeVisible()

  const hash = async (t) => {
    await page.evaluate((x) => window.__showcase.seek(x), t)
    return crypto.createHash('sha1').update(await canvas.screenshot({ type: 'png' })).digest('hex')
  }

  const forward = {}
  for (const t of PROBES) forward[t] = await hash(t)
  for (const t of [...PROBES].reverse()) {
    expect(await hash(t), `seeking backward, the frame at t=${t} differs from the forward pass`).toBe(forward[t])
  }
  for (const t of PROBES) {
    await hash(PROBES[PROBES.length - 1])
    expect(await hash(t), `after a jump to the end, the frame at t=${t} differs from the forward pass`).toBe(forward[t])
  }

  expect(outside, 'rendering must ask for nothing from the internet').toEqual([])
})
