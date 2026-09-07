#!/usr/bin/env node
// Showcase CLI — see docs/superpowers/specs/2026-09-04-showcase-design.md §5.
// `node bin/showcase.mjs <input> [--device ...] [--look ...] [--duration N]
// [--fps N] [--size N] [--out path] [--html] [--contained]` turns a
// video/image into a cinematic MP4 (default) or a self-contained hero HTML
// file (--html) of the content playing on a realistic device — the
// window.__showcase.init(cfg)/seek(t) contract this CLI drives is defined in
// src/showcase/runtime.js. `--contained` keeps the whole device in frame the entire time
// (no full-bleed state) — for slide/column embeds.
//
// Pure argument/fit/timing/defaults math is exported below for unit testing
// (tests/showcase-cli.test.js); everything below the "CLI" divider does real
// I/O (ffprobe/ffmpeg/vite/Playwright) and only runs when this file is
// executed directly, not when tests import it.

import { readFile, writeFile } from 'node:fs/promises'
import { unlinkSync, existsSync } from 'node:fs'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { build, preview } from 'vite'
import { chromium } from '@playwright/test'
import { analyzeActivity } from '../scripts/analyze-activity.mjs'
import { ffmpegPath, ffprobePath } from '../scripts/ffmpeg-bin.mjs'
// src/render/webgl/layout.js is the THREE-free half of the GL renderer's
// geometry math (glRenderer.js re-exports it) — importable from this Node CLI
// precisely because it pulls nothing but src/core/devices.js.
import { screenAspect } from '../src/render/webgl/layout.js'

const execFileAsync = promisify(execFile)

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested directly).

export const VALID_DEVICES = ['phone', 'tablet', 'laptop', 'browser']
// Per the spec's CLI signature: 'auto-action' isn't a user-selectable value —
// it's only ever reached via 'auto' + video content (see resolveLook).
export const VALID_LOOKS = ['auto', 'reference', 'hero-drift', 'close-up-pan', 'orbit-loop', 'flat-lay-rise', 'hero-rise']
// Mirrors src/render/webgl/glRenderer.js's FRAME_FINISHES keys — kept as its
// own local list rather than importing that (THREE-dependent) module into
// this Node CLI, the same way VALID_DEVICES/VALID_LOOKS above don't import
// DEVICES/LOOKS from their own source-of-truth modules either. (The screen
// geometry outputDimensions needs is the one exception, and only because it
// was split out into a deliberately THREE-free module — see the import above.)
export const VALID_FRAMES = ['gold', 'silver', 'graphite', 'black']
export const DEFAULT_FRAME = 'gold'
// Devices that don't reorient (see src/core/devices.js's ORIENTABLE set) —
// their base shape is already landscape, so content aspect can't flip them.
const NON_ORIENTABLE_DEVICES = new Set(['laptop', 'browser'])

export const DEFAULT_DEVICE = 'phone'
export const DEFAULT_FPS = 30
export const DEFAULT_SIZE = 1080
export const DEFAULT_IMAGE_DURATION = 10
export const MIN_AUTO_DURATION = 6
// Tudor's standing rule (2026-09-06): always show the FULL recording — the
// auto duration follows the content length instead of truncating it. The cap
// only mirrors the --duration flag's own 120s sanity ceiling, and the 6s
// floor keeps choreography readable for tiny clips (the content loops).
export const MAX_AUTO_DURATION = 120
// Accepted ranges for the explicitly-passed numeric flags. Values outside
// these are rejected up front rather than producing a 0-frame encode, an
// hours-long render, or a browser viewport nothing can screenshot.
export const NUMBER_FLAG_RANGES = {
  '--duration': { min: 1, max: 120 },
  '--fps': { min: 5, max: 60 },
  '--size': { min: 240, max: 2160 },
}
const HTML_SIZE_WARNING_BYTES = 25 * 1024 * 1024

const VIDEO_MIME = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
}
const IMAGE_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/** @returns {'video'|'image'} based on file extension. Throws on an unrecognized extension. */
export function contentKindFromExtension(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext in VIDEO_MIME) return 'video'
  if (ext in IMAGE_MIME) return 'image'
  throw new Error(
    `showcase: unrecognized file extension "${ext}" — expected a video (${Object.keys(VIDEO_MIME).join(', ')}) or image (${Object.keys(IMAGE_MIME).join(', ')}) file.`,
  )
}

/** @returns the data: URI mime type for `filePath`, given its already-resolved content kind. */
export function mimeForPath(filePath, kind) {
  const ext = path.extname(filePath).toLowerCase()
  return (kind === 'video' ? VIDEO_MIME[ext] : IMAGE_MIME[ext]) || 'application/octet-stream'
}

// Chromium (the Playwright-bundled build this CLI drives) has no HEVC/H.265
// decoder and only reliably plays back h264 inside mp4/m4v or vp8/vp9/av1
// inside webm — a real-world screen recording (e.g. an iPhone .mov, which
// defaults to HEVC) embedded as-is silently fails the content <video>'s
// load with "showcase: failed to load video content" (src/showcase/
// runtime.js), producing no output at all. This is a conservative allowlist,
// not a full compatibility matrix: anything not on it gets transcoded
// (see transcodeForBrowser) rather than risk a silent playback failure.
const BROWSER_SAFE_MP4_CODECS = new Set(['h264'])
const BROWSER_SAFE_WEBM_CODECS = new Set(['vp8', 'vp9', 'av1'])

// HDR. Recent iPhones record the screen in 10-bit PQ (SMPTE ST 2084) BT.2020
// — `ffprobe` says color_transfer=smpte2084 — and those PQ code values are
// nothing like SDR ones: fed to a browser as-is they are tone-mapped by
// Chromium against a 203-nit reference white (measured: the recording's pure
// white arrived on the content canvas as 187/255) and everything downstream
// inherits a washed-out, low-contrast screen. So an HDR source is converted
// to plain BT.709 SDR up front, in the same ffmpeg pass that makes it
// browser-playable.
//
// The conversion is a per-channel PQ EOTF, a linear-light BT.2020 -> BT.709
// primaries matrix, and an sRGB OETF. No zscale/libplacebo (this ffmpeg build
// has neither, and neither is a dependency we can add), and no tone-mapping
// curve: a UI screen recording is SDR content carried in an HDR container, so
// the honest mapping is "PQ reference white == SDR white" with a hard clip
// above it, not a highlight roll-off that would grey down the whole UI.
const PQ_M1_INV = 16384 / 2610
const PQ_M2_INV = 4096 / (2523 * 128)
const PQ_C1 = 3424 / 4096
const PQ_C2 = (2413 / 4096) * 32
const PQ_C3 = (2392 / 4096) * 32
// The nit level PQ white maps onto SDR white. 100 is the SDR reference
// (BT.2035/sRGB): iOS composes the screen's SDR UI at exactly that level, so
// it round-trips back to the original sRGB values.
export const HDR_REFERENCE_NITS = 100

/** @returns whether an ffprobe `color_transfer` names an HDR transfer this CLI must convert to SDR. */
export function needsHdrToneMap(colorTransfer) {
  return colorTransfer === 'smpte2084'
}

/**
 * The ffmpeg -vf chain converting an HDR PQ / BT.2020 source to BT.709 SDR
 * (see the block comment above). Built as a string so the whole conversion is
 * one ffmpeg pass; exported for unit testing.
 * @param {number} [referenceNits]
 * @returns {string}
 */
export function hdrToSdrFilter(referenceNits = HDR_REFERENCE_NITS) {
  const n = 'clip(val/maxval,0,1)'
  const e = `pow(${n},${PQ_M2_INV})`
  const linear = `pow(max(${e}-${PQ_C1},0)/(${PQ_C2}-${PQ_C3}*${e}),${PQ_M1_INV})`
  // PQ EOTF -> nits -> SDR-white-relative, clipped at 1.
  const eotf = `maxval*min((${linear})*${10000 / referenceNits},1)`
  // sRGB OETF on the linear-light value.
  const oetf = `maxval*if(lte(${n},0.0031308),12.92*(${n}),1.055*pow(${n},${1 / 2.4})-0.055)`
  // BT.2020 -> BT.709 in linear light (the two gamuts' RGB->XYZ matrices,
  // composed); out-of-709 colours clip, which is all that can be done.
  const primaries =
    'colorchannelmixer=rr=1.6605:rg=-0.5876:rb=-0.0728:gr=-0.1246:gg=1.1329:gb=-0.0083:br=-0.0182:bg=-0.1006:bb=1.1187'
  return [
    'format=gbrp16le', // 16-bit planar RGB: enough headroom for a linear-light intermediate
    `lutrgb=r='${eotf}':g='${eotf}':b='${eotf}'`,
    primaries,
    `lutrgb=r='${oetf}':g='${oetf}':b='${oetf}'`,
    'scale=out_color_matrix=bt709:out_range=tv',
    // Say what the frames now ARE. Without this the source's PQ/BT.2020
    // properties ride along on the filtered frames (the -color_* output
    // options do not override them) and end up in the mp4's colr box.
    'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv',
    // ...and drop the HDR mastering metadata with them. It is carried as
    // frame side data, survives re-encoding into both the bitstream and the
    // mp4's mdcv/clli boxes, and on its own is enough to make Chromium treat
    // the (now SDR) copy as HDR and tone-map it a second time — measured:
    // blown-out near-whites and garish, clipped colour.
    'sidedata=delete:type=MASTERING_DISPLAY_METADATA',
    'sidedata=delete:type=CONTENT_LIGHT_LEVEL',
  ].join(',')
}

/** @returns whether `codecName` (from ffprobe) is safe to embed as-is for `filePath`'s container. */
export function isBrowserSafeVideo(filePath, codecName) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.mp4' || ext === '.m4v') return BROWSER_SAFE_MP4_CODECS.has(codecName)
  if (ext === '.webm') return BROWSER_SAFE_WEBM_CODECS.has(codecName)
  return false
}

/**
 * Orientable devices (phone/tablet) follow the content's own aspect;
 * laptop/browser are always 'landscape' (their base shape can't reorient —
 * see src/core/devices.js's ORIENTABLE set).
 * @returns {'portrait'|'landscape'}
 */
export function resolveOrientation(device, contentWidth, contentHeight) {
  if (NON_ORIENTABLE_DEVICES.has(device)) return 'landscape'
  return contentWidth >= contentHeight ? 'landscape' : 'portrait'
}

/**
 * @returns look default: 'reference' when no look is requested at all (both
 * video and image); an explicit 'auto' still resolves to the older
 * content-aware default (auto-action for video, hero-drift for image); any
 * other explicit `requested` value passes through verbatim.
 */
export function resolveLook(requested, kind) {
  if (!requested) return 'reference'
  if (requested === 'auto') return kind === 'video' ? 'auto-action' : 'hero-drift'
  return requested
}

/** Clamps a content-derived default duration to the 6-120s window (full recording by default). */
export function clampAutoDuration(seconds) {
  return Math.min(MAX_AUTO_DURATION, Math.max(MIN_AUTO_DURATION, seconds))
}

/**
 * Duration default = the FULL content duration, clamped 6-120s (images: 10s) — an
 * explicit `requested` value always wins verbatim, unclamped.
 */
export function resolveDuration(requested, kind, contentDurationSec) {
  if (requested != null) return requested
  if (kind === 'image') return DEFAULT_IMAGE_DURATION
  return clampAutoDuration(contentDurationSec)
}

/**
 * Output frame dimensions: `shortSide` (the --size value) on the short axis,
 * the other axis derived from the DEVICE SCREEN's own aspect ratio (see
 * src/render/webgl/layout.js's screenAspect) — both forced even (required by
 * yuv420p). E.g. phone portrait size 1080 -> {width: 1080, height: 2352};
 * browser (always landscape) size 1080 -> {width: 1786, height: 1080}.
 *
 * Replaces the older 16:9 canonical frame. A 16:9 frame is a different shape
 * from every device screen, so the zoomed-in ending had to crop the content
 * hard on one axis just to cover the frame's other axis. Matching the screen's
 * aspect makes `screenFit` (see glRenderer's distanceBounds) reachable at all:
 * one distance at which the whole screen is inscribed in the frame on BOTH
 * axes at once, which is where the reference look's ending now stops.
 *
 * @param {string|object} device - device name (or DEVICES spec)
 * @param {'portrait'|'landscape'} orientation
 * @param {number} shortSide
 * @returns {{width: number, height: number}}
 */
export function outputDimensions(device, orientation, shortSide) {
  const aspect = screenAspect(device, orientation)
  const even = (value) => Math.max(2, Math.round(value / 2) * 2)
  return orientation === 'portrait'
    ? { width: even(shortSide), height: even(shortSide / aspect) }
    : { width: even(shortSide * aspect), height: even(shortSide) }
}

/**
 * Output-timeline sample points for an MP4 export: N = round(durationSec*fps)
 * frames at exactly fps, so N frames at that rate play back in durationSec
 * seconds. Progress values are in [0, 1) (frame 0 at t=0, the last frame just
 * short of t=1) — matching seek(t)'s "t*cfg.duration" contract.
 * @returns {number[]}
 */
export function outputFrameTimes(durationSec, fps) {
  const totalFrames = Math.max(1, Math.round(durationSec * fps))
  return Array.from({ length: totalFrames }, (_, i) => i / totalFrames)
}

/** @returns default output filename: mockup-showcase-<look>.<ext> */
export function defaultOutputPath(look, ext) {
  return `mockup-showcase-${look}.${ext}`
}

/**
 * Clamps activity segments (seconds, from scripts/analyze-activity.mjs) to
 * the output's [0, durationSec] window, dropping degenerate segments.
 * t0/t1 stay in seconds — src/showcase/looks.js's auto-action (ctx =
 * {duration, activity}) divides them by ctx.duration itself to get 0..1
 * progress, so normalizeActivity must NOT also convert to fractions here.
 * @returns {{t0: number, t1: number, u: number, v: number, zoom: number}[]}
 */
export function normalizeActivity(segmentsSec, durationSec) {
  if (!durationSec) return []
  const clamp = (v) => Math.min(durationSec, Math.max(0, v))
  return segmentsSec
    .map((s) => ({ ...s, t0: clamp(s.t0), t1: clamp(s.t1) }))
    .filter((s) => s.t1 > s.t0)
}

/** Parses argv (post `node bin/showcase.mjs`) into a flat options object. Throws on bad input. */
export function parseArgs(argv) {
  const args = { _: [] }
  const FLAG_KEYS = { '--device': 'device', '--look': 'look', '--out': 'out', '--frame': 'frame', '--background': 'background' }
  const NUMBER_FLAG_KEYS = { '--duration': 'duration', '--fps': 'fps', '--size': 'size' }

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token === '--html') {
      args.html = true
    } else if (token === '--contained') {
      args.contained = true
    } else if (token in FLAG_KEYS) {
      const value = argv[++i]
      if (value === undefined) throw new Error(`showcase: ${token} needs a value`)
      args[FLAG_KEYS[token]] = value
    } else if (token in NUMBER_FLAG_KEYS) {
      const raw = argv[++i]
      const value = Number(raw)
      if (raw === undefined || raw === '' || !Number.isFinite(value)) {
        throw new Error(`showcase: ${token} needs a number, got "${raw}"`)
      }
      const { min, max } = NUMBER_FLAG_RANGES[token]
      if (value < min || value > max) {
        throw new Error(`showcase: ${token} must be between ${min} and ${max}, got ${value}`)
      }
      args[NUMBER_FLAG_KEYS[token]] = value
    } else if (token.startsWith('--')) {
      throw new Error(`showcase: unknown flag "${token}"`)
    } else {
      args._.push(token)
    }
  }

  if (args._.length !== 1) {
    throw new Error('Usage: showcase <input> [--device phone|tablet|laptop|browser] [--look auto|reference|hero-drift|close-up-pan|orbit-loop|flat-lay-rise|hero-rise] [--duration N] [--fps N] [--size N] [--frame gold|silver|graphite|black] [--background #hex|cssname (scene backdrop, default black)] [--out path] [--html] [--contained (keep the whole device in frame the entire time — for slide/column embeds)]')
  }
  args.input = args._[0]
  delete args._

  if (args.device && !VALID_DEVICES.includes(args.device)) {
    throw new Error(`showcase: invalid --device "${args.device}" — expected one of ${VALID_DEVICES.join(', ')}`)
  }
  if (args.look && !VALID_LOOKS.includes(args.look)) {
    throw new Error(`showcase: invalid --look "${args.look}" — expected one of ${VALID_LOOKS.join(', ')}`)
  }
  if (args.frame && !VALID_FRAMES.includes(args.frame)) {
    throw new Error(`showcase: invalid --frame "${args.frame}" — expected one of ${VALID_FRAMES.join(', ')}`)
  }
  // Background travels into an inline <style>/<script> and an ffmpeg filter
  // arg, so only two shapes are accepted: hex (#rgb/#rrggbb) or a plain
  // CSS color name. Everything else (rgb(), gradients, injection payloads)
  // is rejected here at the door.
  if (args.background && !/^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$|^[a-zA-Z]+$/.test(args.background)) {
    throw new Error(`showcase: invalid --background "${args.background}" — expected a hex color (#FFCC00) or a CSS color name`)
  }
  // Normalize #rgb to #rrggbb so downstream consumers (ffmpeg's 0xRRGGBB pad
  // color, THREE.Color, inline CSS) all get one canonical shape.
  if (args.background && /^#[0-9a-fA-F]{3}$/.test(args.background)) {
    const [r, g, b] = args.background.slice(1)
    args.background = `#${r}${r}${g}${g}${b}${b}`
  }
  return args
}

// ---------------------------------------------------------------------------
// CLI (impure — not unit-tested directly; exercised end-to-end via e2e/showcase.spec.js).

function isMissingBinaryError(err) {
  return err && (err.code === 'ENOENT' || /ENOENT/.test(err.message || ''))
}

// Playwright's browser download (~150MB for Chromium) is deliberately NOT a
// postinstall hook — that would force it on every `npm install`, including
// editor-only users who never run this CLI. Instead, check lazily right
// before the CLI actually needs Chromium and self-install it once, so a
// fresh `git clone` + `npm install` + a showcase run "just works" without
// a separate manual `npx playwright install chromium` step.
function ensureChromiumInstalled() {
  const execPath = chromium.executablePath()
  if (existsSync(execPath)) return
  process.stderr.write('showcase: Chromium not found — running `npx playwright install chromium` (one-time download)...\n')
  const result = spawnSync('npx', ['playwright', 'install', 'chromium'], { stdio: 'inherit' })
  if (result.error || result.status !== 0) {
    throw new Error('showcase: automatic Chromium install failed — run `npx playwright install chromium` yourself and try again.')
  }
}

async function probeMedia(inputPath, kind) {
  const entries =
    kind === 'video' ? ['stream=width,height,codec_name,color_transfer', 'format=duration'] : ['stream=width,height']
  const args = ['-v', 'error', '-select_streams', 'v:0', ...entries.flatMap((e) => ['-show_entries', e]), '-of', 'json', inputPath]
  let stdout
  try {
    ;({ stdout } = await execFileAsync(ffprobePath, args))
  } catch (err) {
    if (isMissingBinaryError(err)) {
      throw new Error('showcase: ffprobe not found on PATH — install ffmpeg (e.g. `brew install ffmpeg`) and try again.')
    }
    throw new Error(`showcase: ffprobe failed to read ${inputPath}: ${err.message}`)
  }
  const data = JSON.parse(stdout)
  const stream = data.streams?.[0]
  if (!stream?.width || !stream?.height) {
    throw new Error(`showcase: could not read dimensions from ${inputPath}`)
  }
  const durationSec = kind === 'video' ? parseFloat(data.format?.duration ?? '0') || 0 : 0
  return {
    width: stream.width,
    height: stream.height,
    durationSec,
    codecName: stream.codec_name ?? null,
    colorTransfer: stream.color_transfer ?? null,
  }
}

// Re-encodes a video that isn't safely browser-playable as-is (see
// isBrowserSafeVideo), or is HDR (see needsHdrToneMap), into a plain
// h264 BT.709 SDR mp4 in the OS temp dir. Caller is responsible for deleting
// the returned path once done with it.
async function transcodeForBrowser(inputPath, { hdr = false } = {}) {
  const tmpPath = path.join(os.tmpdir(), `showcase-transcode-${randomUUID()}.mp4`)
  await new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      '-v', 'error',
      '-i', inputPath,
      ...(hdr ? ['-vf', hdrToSdrFilter()] : []),
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'veryfast',
      '-crf', '20',
      '-an',
      // Tag what we actually produced. Without this an HDR source's BT.2020/PQ
      // tags are copied onto the converted (now SDR) copy and the browser
      // tone-maps it a second time.
      ...(hdr ? ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'] : []),
      '-movflags', '+faststart',
      '-y', tmpPath,
    ], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    proc.on('error', (err) => {
      if (isMissingBinaryError(err)) {
        reject(new Error('showcase: ffmpeg not found on PATH — install ffmpeg (e.g. `brew install ffmpeg`) and try again.'))
      } else {
        reject(err)
      }
    })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`showcase: ffmpeg transcode exited with code ${code}\n${stderr}`))
    })
  })
  return tmpPath
}

// Escapes "<" so a literal "</script>" arriving through the embedded cfg
// JSON can't terminate the inline <script> tag early — same technique as
// src/export/exporter.js's escapeForInlineScript.
function escapeForInlineScript(json) {
  return json.replace(/</g, '\\u003c')
}

// The runtime renders at pixelSizeMode 'exact' (see runtime.js's init()), so
// each screenshotted frame already IS width x height and `pad` is a no-op
// (iw == ow, ih == oh). It stays as a safety net: a frame that ever came back
// undersized — a rounding change, a future non-exact caller — would otherwise
// make ffmpeg fail or silently rescale, where `pad` centers it on an exact
// width x height canvas instead. The pad color still matters in that case,
// hence the background plumbing below.
//
// This is deliberately NOT the contract src/export/media.js's captureStill/
// captureFrames use: those keep the default aspect-fit pixelSize and do their
// own compositing onto a separately-sized 2D canvas.
function startFfmpegEncoder(outPath, fps, width, height, background = null) {
  // The pad (letterbox) color must match the scene background or a custom
  // --background shows black bars on the padded axis. ffmpeg's color syntax
  // takes 0xRRGGBB for hex (not #RRGGBB) and CSS-style names as-is.
  const padColor = background ? (background.startsWith('#') ? `0x${background.slice(1)}` : background) : 'black'
  const args = [
    '-v', 'error',
    '-f', 'image2pipe',
    '-vcodec', 'png',
    '-r', String(fps),
    '-i', '-',
    // scale's out_color_matrix is what makes the RGB -> yuv420p conversion use
    // BT.709 coefficients. Left to swscale's default, PNG frames are encoded
    // with BT.601 coefficients and the file carries no colour tags at all, so
    // every player treats an HD frame as BT.709 and decodes it with the wrong
    // matrix — measured on a colour test card through this pipeline: a
    // (230,30,40) red came back as (255,53,39), a 9.8% shift, while greys (an
    // identical Y in both matrices) looked fine and hid the bug. The tags
    // below then say what the pixels actually are.
    '-vf', `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:${padColor},scale=out_color_matrix=bt709:out_range=tv,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709`,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709',
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    '-color_range', 'tv',
    '-r', String(fps),
    '-y', outPath,
  ]
  const proc = spawn(ffmpegPath, args, { stdio: ['pipe', 'ignore', 'pipe'] })
  let stderr = ''
  proc.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  const done = new Promise((resolve, reject) => {
    proc.on('error', (err) => {
      if (isMissingBinaryError(err)) {
        reject(new Error('showcase: ffmpeg not found on PATH — install ffmpeg (e.g. `brew install ffmpeg`) and try again.'))
      } else {
        reject(err)
      }
    })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`showcase: ffmpeg exited with code ${code}\n${stderr}`))
    })
  })
  return { proc, done }
}

async function writeToStream(stream, buf) {
  if (!stream.write(buf)) {
    await new Promise((resolve) => stream.once('drain', resolve))
  }
}

async function runMp4Export({ cfg, inputPath, fps, outPath, root }) {
  process.stderr.write('showcase: building app (vite build)...\n')
  await build({ configFile: path.join(root, 'vite.config.js'), logLevel: 'warn' })

  // showcase.html's built assets are root-absolute ("/assets/...") — the
  // default vite `base`, which resolves fine under a real server but not
  // under file:// (the browser looks for /assets/... at the filesystem
  // root). `vite preview` serves dist/ over http, sidestepping that
  // entirely, per the brief's "check file://; if not, use vite preview".
  process.stderr.write('showcase: starting preview server...\n')
  const server = await preview({ configFile: path.join(root, 'vite.config.js'), preview: { port: 0 }, logLevel: 'warn' })
  try {
    const baseUrl = server.resolvedUrls.local[0]
    const showcaseUrl = new URL('showcase.html', baseUrl).href

    // Content is embedded as a data: URI rather than served/linked so the
    // headless page never needs cross-origin/file:// access to the input —
    // data: URIs have no origin restriction. (Size isn't a concern here,
    // unlike --html: this page is never shipped anywhere.)
    const contentBuffer = await readFile(inputPath)
    const contentUrl = `data:${mimeForPath(inputPath, cfg.content.kind)};base64,${contentBuffer.toString('base64')}`

    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: cfg.width, height: cfg.height }, deviceScaleFactor: 1 })
      const pageErrors = []
      page.on('pageerror', (err) => pageErrors.push(err))
      await page.goto(showcaseUrl)
      // The canvas's fractional CSS edge can let a sliver of the page body
      // through in element screenshots — paint the body to match the scene
      // background so that seam is invisible (black default, or --background).
      await page.addStyleTag({ content: `body{background:${cfg.background || '#000000'} !important} #stage{position:fixed !important;left:0 !important;top:0 !important;margin:0 !important;transform:none !important}` })
      // ^ flex-start pins the canvas at integer (0,0): centered, it lands on a
      // half-pixel (e.g. x=32.5), and the element screenshot's rounded-out
      // edge column blends canvas and page pixels into a visible dark seam
      // after encoding. The body background matches the scene as belt+braces.
      await page.evaluate((c) => window.__showcase.init(c), { ...cfg, content: { kind: cfg.content.kind, url: contentUrl } })

      const canvas = await page.$('#stage canvas')
      if (!canvas) throw new Error('showcase: no canvas found on the showcase page after init()')

      const times = outputFrameTimes(cfg.duration, fps)
      const { proc, done } = startFfmpegEncoder(outPath, fps, cfg.width, cfg.height, cfg.background)
      for (let i = 0; i < times.length; i++) {
        await page.evaluate((t) => window.__showcase.seek(t), times[i])
        const png = await canvas.screenshot({ type: 'png' })
        await writeToStream(proc.stdin, png)
        process.stderr.write(`\rshowcase: frame ${i + 1}/${times.length}`)
      }
      process.stderr.write('\n')
      proc.stdin.end()
      await done

      if (pageErrors.length) {
        process.stderr.write(`showcase: warning — ${pageErrors.length} in-page error(s) during capture:\n${pageErrors.map((e) => e.message).join('\n')}\n`)
      }
    } finally {
      await browser.close()
    }
  } finally {
    await server.close()
  }
}

const POSTER_JPEG_QUALITY = 80

// Renders a single JPEG poster frame for the --html export's static
// fallback (a scripts-disabled sandbox, or the brief instant before the
// runtime's own first frame draws, never see a black canvas). Reuses the
// same runtime bundle the export embeds — loaded via page.setContent()
// rather than a second full `vite build`+`preview()` (the runMp4Export
// path's approach), since the iife is already self-contained and this
// avoids paying for a whole extra app build just to grab one frame.
// Non-live cfg (no `live: true`) keeps seek()'s deterministic contract, so
// seek(0.05) lands on a real, decoded content frame rather than t=0 (which
// for video content can still be pre-decode on some builds).
async function renderHeroPoster({ cfg, contentUrl, runtimeScript }) {
  const posterHtml = `<!doctype html><html><head><meta charset="UTF-8" /></head><body><div id="stage"></div><script>${runtimeScript}</script></body></html>`
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: cfg.width, height: cfg.height }, deviceScaleFactor: 1 })
    await page.setContent(posterHtml, { waitUntil: 'load' })
    await page.addStyleTag({ content: `body{background:${cfg.background || '#000000'} !important}` })
    await page.evaluate((c) => window.__showcase.init(c), { ...cfg, content: { kind: cfg.content.kind, url: contentUrl } })
    await page.evaluate((t) => window.__showcase.seek(t), 0.05)
    const canvas = await page.$('#stage canvas')
    if (!canvas) throw new Error('no canvas found on the poster-render page after init()')
    return await canvas.screenshot({ type: 'jpeg', quality: POSTER_JPEG_QUALITY })
  } finally {
    await browser.close()
  }
}

async function runHtmlExport({ cfg, inputPath, outPath, root }) {
  process.stderr.write('showcase: building runtime bundle (vite build)...\n')
  await build({ configFile: path.join(root, 'vite.showcase.config.js'), logLevel: 'warn' })
  const runtimeScript = await readFile(path.join(root, 'src/showcase/generated/showcase-runtime.iife.js'), 'utf8')

  const contentBuffer = await readFile(inputPath)
  const contentUrl = `data:${mimeForPath(inputPath, cfg.content.kind)};base64,${contentBuffer.toString('base64')}`

  // Best-effort: a poster-render failure (of any kind) must not break the
  // export — the page still works fine without one, just black until the
  // runtime's first live frame draws.
  let posterJpeg = null
  try {
    process.stderr.write('showcase: rendering poster frame...\n')
    posterJpeg = await renderHeroPoster({ cfg, contentUrl, runtimeScript })
  } catch (err) {
    process.stderr.write(`showcase: warning — could not render a poster frame (${err.message}); exporting ${outPath} without one.\n`)
  }

  const liveCfg = { ...cfg, live: true, content: { kind: cfg.content.kind, url: contentUrl } }
  const cfgJson = escapeForInlineScript(JSON.stringify(liveCfg))

  // Plain markup, not script-inserted — visible by default so a
  // scripts-disabled sandbox still renders it; the runtime (src/showcase/
  // runtime.js's init()) hides it once its own first frame is on the
  // canvas. Sized/positioned to sit exactly under the canvas (both are
  // cfg.width x cfg.height, centered in the viewport the same way).
  const posterTag = posterJpeg
    ? `<img id="ma-hero-poster" alt="" src="data:image/jpeg;base64,${posterJpeg.toString('base64')}" />`
    : ''

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Showcase</title>
<style>
html,body{margin:0;height:100%;background:${cfg.background || '#000000'};overflow:hidden;position:relative;}
body{display:flex;align-items:center;justify-content:center;}
#stage{display:block;position:relative;z-index:1;line-height:0;}
/* The canvas buffer stays at the authored resolution (${cfg.width}x${cfg.height})
   for render quality, but its on-page size must FIT the embedding viewport —
   without this the window itself crops the oversized canvas (and the device
   with it) in any browser or panel smaller than the buffer. */
#stage canvas{display:block;width:auto;height:auto;max-width:100vw;max-height:100vh;}
#ma-hero-poster{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:auto;height:auto;max-width:100vw;max-height:100vh;object-fit:contain;z-index:0;}
</style>
</head>
<body>
${posterTag}
<div id="stage"></div>
<script>${runtimeScript}</script>
<script>window.__showcase.init(${cfgJson})</script>
</body>
</html>
`
  await writeFile(outPath, html)

  if (posterJpeg) {
    process.stderr.write(`showcase: embedded poster frame (${(posterJpeg.length / 1024).toFixed(1)}KB).\n`)
  }
  const sizeBytes = Buffer.byteLength(html)
  if (sizeBytes > HTML_SIZE_WARNING_BYTES) {
    process.stderr.write(`showcase: warning — ${outPath} is ${(sizeBytes / (1024 * 1024)).toFixed(1)}MB, over the 25MB guideline for a self-contained hero HTML file.\n`)
  }
}

async function main() {
  // The HEVC-transcode temp file must not survive ANY exit path — a failed
  // probe, a crashed render, or a Ctrl-C mid-encode — so the whole run sits
  // inside one try/finally with the path in scope, plus a SIGINT hook (which
  // bypasses `finally` entirely, hence the sync unlink).
  let transcodedPath = null
  const cleanupTranscode = () => {
    if (!transcodedPath) return
    try {
      unlinkSync(transcodedPath)
    } catch {
      // already gone / never written — nothing to clean up
    }
    transcodedPath = null
  }
  process.on('SIGINT', () => {
    cleanupTranscode()
    process.exit(130)
  })

  try {
    const args = parseArgs(process.argv.slice(2))
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const inputPath = path.resolve(args.input)

    process.stderr.write(`showcase: ffmpeg -> ${ffmpegPath}${ffmpegPath === 'ffmpeg' ? ' (PATH)' : ' (bundled)'}\n`)
    process.stderr.write(`showcase: ffprobe -> ${ffprobePath}${ffprobePath === 'ffprobe' ? ' (PATH)' : ' (bundled)'}\n`)

    const kind = contentKindFromExtension(inputPath)
    const probe = await probeMedia(inputPath, kind)
    const device = args.device || DEFAULT_DEVICE
    const orientation = resolveOrientation(device, probe.width, probe.height)
    const look = resolveLook(args.look, kind)
    const durationSec = resolveDuration(args.duration, kind, probe.durationSec)
    const fps = args.fps || DEFAULT_FPS
    const size = args.size || DEFAULT_SIZE
    const frame = args.frame || DEFAULT_FRAME
    const { width, height } = outputDimensions(device, orientation, size)
    const ext = args.html ? 'html' : 'mp4'
    const outPath = path.resolve(args.out || defaultOutputPath(look, ext))

    let activity = []
    if (kind === 'video' && look === 'auto-action') {
      process.stderr.write('showcase: analyzing activity...\n')
      // Activity analysis decodes via ffmpeg directly (not the browser), so it
      // reads the original file regardless of browser-playability.
      const segmentsSec = await analyzeActivity(inputPath, { srcWidth: probe.width, srcHeight: probe.height })
      activity = normalizeActivity(segmentsSec, durationSec)
    }

    const cfg = {
      device,
      orientation,
      look,
      duration: durationSec,
      width,
      height,
      content: { kind, url: null },
      activity,
      frame,
      background: args.background || null,
      contained: !!args.contained,
    }

    // The embedded <video> is decoded by headless Chromium, which lacks HEVC
    // support and is otherwise picky about container/codec — a real screen
    // recording (e.g. an iPhone .mov, HEVC by default) fails to load as-is.
    // Transcode a browser-safe copy first when needed (see isBrowserSafeVideo).
    let contentPath = inputPath
    const hdr = kind === 'video' && needsHdrToneMap(probe.colorTransfer)
    if (kind === 'video' && (hdr || !isBrowserSafeVideo(inputPath, probe.codecName))) {
      const why = hdr
        ? `source is HDR (${probe.colorTransfer}) — converting it to BT.709 SDR`
        : `source codec "${probe.codecName}" may not be browser-playable — transcoding a compatible copy`
      process.stderr.write(`showcase: ${why}...\n`)
      transcodedPath = await transcodeForBrowser(inputPath, { hdr })
      contentPath = transcodedPath
    }

    // Both export paths eventually call chromium.launch() (runMp4Export
    // directly; the --html path inside renderHeroPoster's best-effort poster
    // render, which would otherwise just swallow a missing-Chromium failure
    // as "no poster") — check/install once, up front, so either path gets a
    // clear message instead.
    ensureChromiumInstalled()
    if (args.html) {
      await runHtmlExport({ cfg, inputPath: contentPath, outPath, root })
    } else {
      await runMp4Export({ cfg, inputPath: contentPath, fps, outPath, root })
    }
    process.stderr.write(`showcase: wrote ${outPath}\n`)
  } finally {
    cleanupTranscode()
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((err) => {
    console.error(err.message || err)
    process.exit(1)
  })
}
