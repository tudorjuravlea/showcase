#!/usr/bin/env node
// Activity analysis — see
// docs/superpowers/specs/2026-09-04-showcase-design.md §3 ("Activity
// analysis"). Drives bin/showcase.mjs's auto-action look (src/showcase/looks.js)
// by finding where a screen recording is actually "doing something": extract
// small grayscale frames via ffmpeg (~4fps, ~64px wide), diff consecutive
// frames on an 8x16 grid oriented like the source (16 rows x 8 cols for a
// portrait recording), group into ~1.5s windows, and turn each sufficiently
// active, sufficiently *localized* window into a {t0,t1,u,v,zoom} segment
// (seconds, u/v in
// 0..1 screen-space, zoom a glRenderer camera.distance value — see
// setCamera's doc comment: smaller = closer).
//
// `segmentActivity` is pure (no ffmpeg/DOM) and unit-tested directly on
// synthetic grids (tests/activity.test.js). `extractDiffGrids`/
// `analyzeActivity` shell out to ffmpeg/ffprobe (required on PATH) and are
// only exercised end-to-end (via bin/showcase.mjs and this file's own CLI
// wrapper below).
//
// Standalone usage: `node scripts/analyze-activity.mjs <video>` prints the
// segment JSON to stdout.

import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ffmpegPath, ffprobePath } from './ffmpeg-bin.mjs'

const execFileAsync = promisify(execFile)

// Grid shape is 8 x 16 cells, long axis along the video's long axis — a
// portrait recording gets 16 rows x 8 cols (vertical precision where the
// content actually is), landscape the transpose. GRID_ROWS/GRID_COLS name
// the landscape orientation; use gridDimsFor() to pick per source.
export const GRID_ROWS = 8
export const GRID_COLS = 16
export const DEFAULT_FPS = 4
export const DEFAULT_WIDTH = 64
export const DEFAULT_WINDOW_SEC = 1.5
// A window survives only if it clears BOTH bars: an absolute one (mean
// abs-diff per cell per frame, 0..255 — real screen recordings sit at ~7-12
// while a static stretch sits at ~0.05-0.1, so 1.0 is a wide moat) and a
// relative one (share of the clip's peak window energy). The old 0.15
// relative-only bar dropped nothing on a real recording, so no gaps ever
// formed and the whole clip collapsed into one segment.
export const DEFAULT_MIN_INTENSITY = 1
export const DEFAULT_MIN_ENERGY_FRACTION = 0.18
// Only cells at or above this share of the window's hottest cell steer the
// centroid, and they're weighted by energy^CENTROID_WEIGHT_POWER. Averaging
// *every* cell puts the centroid at dead center for anything full-screen
// (e.g. scrolling), which is what parked the camera at 0.50/0.50 before.
export const DEFAULT_CELL_KEEP_FRACTION = 0.8
export const DEFAULT_CENTROID_WEIGHT_POWER = 2
// ...and if that many cells still qualify, the motion isn't localized at all
// (a full-screen crossfade/flash): emit no segment and let the look breathe
// on its hero framing rather than inventing a dead-center push-in.
export const DEFAULT_UNIFORM_CELL_FRACTION = 0.5
export const DEFAULT_ZOOM_MIN = 0.3
export const DEFAULT_ZOOM_MAX = 0.7
// Spread (normalized-UV std-dev radius over the kept cells) is bounded above
// by ~0.408 for grid-uniform motion, so normalizing by 0.4 pinned every real
// window near zoomMax. These bracket the range actually observed on real
// recordings (~0.15 tight burst .. ~0.38 diffuse), so the zoom curve uses its
// whole travel instead of the top sliver of it.
export const DEFAULT_SPREAD_MIN = 0.08
export const DEFAULT_SPREAD_MAX = 0.4
export const DEFAULT_MERGE_UV_DISTANCE = 0.12
export const DEFAULT_MERGE_ZOOM_DELTA = 0.15
// Merge only across gaps shorter than half a window — i.e. only genuinely
// adjacent surviving windows. A full window's worth of tolerance (the old
// value) meant a dropped, static window in between never broke a segment.
export const DEFAULT_GAP_TOLERANCE_FRACTION = 0.5

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

/** @returns {{rows: number, cols: number}} diff-grid shape matching the source's orientation. */
export function gridDimsFor(srcWidth, srcHeight) {
  return srcHeight > srcWidth ? { rows: GRID_COLS, cols: GRID_ROWS } : { rows: GRID_ROWS, cols: GRID_COLS }
}

// Weighted centroid + spread of a single window's combined grid energy.
// `grids` is one or more diff grids (all frames belonging to the window) —
// cells are summed across frames first, so the result describes "where did
// motion happen in this window" as a single point + a size.
//
// `energy` (total) and `intensity` (mean per cell per frame) describe how
// much moved and drive the survival thresholds; `keptFraction` is the share
// of cells hot enough to steer the centroid, and is what tells localized
// action apart from full-screen-uniform motion.
function windowStats(grids, { cellKeepFraction, centroidWeightPower }) {
  const rows = grids[0].length
  const cols = grids[0][0].length
  const cells = rows * cols
  const totals = Array.from({ length: rows }, () => new Array(cols).fill(0))
  let energy = 0
  let peak = 0
  for (const grid of grids) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const e = grid[r][c]
        if (e <= 0) continue
        totals[r][c] += e
        energy += e
      }
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) peak = Math.max(peak, totals[r][c])
  }
  if (energy <= 0 || peak <= 0) {
    return { energy: 0, intensity: 0, u: 0.5, v: 0.5, spread: 0, keptFraction: 0 }
  }

  const floor = peak * cellKeepFraction
  const kept = []
  let weight = 0
  let sumU = 0
  let sumV = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (totals[r][c] < floor) continue
      const w = totals[r][c] ** centroidWeightPower
      const u = (c + 0.5) / cols
      const v = (r + 0.5) / rows
      kept.push({ w, u, v })
      weight += w
      sumU += w * u
      sumV += w * v
    }
  }

  const u = sumU / weight
  const v = sumV / weight
  let varU = 0
  let varV = 0
  for (const cell of kept) {
    varU += cell.w * (cell.u - u) ** 2
    varV += cell.w * (cell.v - v) ** 2
  }
  return {
    energy,
    intensity: energy / (grids.length * cells),
    u,
    v,
    spread: Math.sqrt(varU / weight + varV / weight),
    keptFraction: kept.length / cells,
  }
}

function zoomFromSpread(spread, { zoomMin, zoomMax, spreadMin, spreadMax }) {
  const p = clamp((spread - spreadMin) / (spreadMax - spreadMin), 0, 1)
  return zoomMin + p * (zoomMax - zoomMin)
}

function uvDistance(a, b) {
  return Math.hypot(a.u - b.u, a.v - b.v)
}

/**
 * Turns a sequence of per-frame-pair diff grids into activity segments.
 *
 * @param {number[][][]} diffGrids - diffGrids[i] is a rows x cols grid of
 *   average abs-diff energy (0..255) between sampled frame i and i+1, at
 *   opts.fps (shape per gridDimsFor()).
 * @param {object} [opts]
 * @param {number} [opts.fps=DEFAULT_FPS] - sample rate diffGrids were extracted at
 * @param {number} [opts.windowSec=DEFAULT_WINDOW_SEC] - analysis window length, seconds
 * @param {number} [opts.minIntensity=DEFAULT_MIN_INTENSITY] - windows whose mean
 *   per-cell per-frame energy is under this are dropped as "static"
 * @param {number} [opts.minEnergyFraction=DEFAULT_MIN_ENERGY_FRACTION] - ...as are
 *   windows under this fraction of the clip's peak window energy
 * @param {number} [opts.cellKeepFraction=DEFAULT_CELL_KEEP_FRACTION] - only cells at
 *   this share of the window's hottest cell steer the centroid
 * @param {number} [opts.centroidWeightPower=DEFAULT_CENTROID_WEIGHT_POWER] - exponent
 *   applied to kept-cell energy before the centroid/spread average
 * @param {number} [opts.uniformCellFraction=DEFAULT_UNIFORM_CELL_FRACTION] - windows
 *   where more than this share of cells stay hot are full-screen-uniform motion,
 *   not localized action, and produce no segment at all
 * @param {number} [opts.zoomMin=DEFAULT_ZOOM_MIN] - camera distance for the most
 *   concentrated motion
 * @param {number} [opts.zoomMax=DEFAULT_ZOOM_MAX] - camera distance for the most
 *   spread-out motion
 * @param {number} [opts.spreadMin=DEFAULT_SPREAD_MIN] - spread (normalized-UV std-dev
 *   radius) at or below which zoom is zoomMin
 * @param {number} [opts.spreadMax=DEFAULT_SPREAD_MAX] - ...and at or above which it is zoomMax
 * @param {number} [opts.mergeUvDistance=DEFAULT_MERGE_UV_DISTANCE] - adjacent
 *   surviving windows within this UV distance get merged into one segment
 * @param {number} [opts.mergeZoomDelta=DEFAULT_MERGE_ZOOM_DELTA] - ...and within
 *   this zoom delta
 * @param {number} [opts.gapToleranceFraction=DEFAULT_GAP_TOLERANCE_FRACTION] - ...and
 *   separated by no more than this fraction of a window
 * @returns {{t0: number, t1: number, u: number, v: number, zoom: number}[]}
 */
export function segmentActivity(diffGrids, opts = {}) {
  const {
    fps = DEFAULT_FPS,
    windowSec = DEFAULT_WINDOW_SEC,
    minIntensity = DEFAULT_MIN_INTENSITY,
    minEnergyFraction = DEFAULT_MIN_ENERGY_FRACTION,
    cellKeepFraction = DEFAULT_CELL_KEEP_FRACTION,
    centroidWeightPower = DEFAULT_CENTROID_WEIGHT_POWER,
    uniformCellFraction = DEFAULT_UNIFORM_CELL_FRACTION,
    zoomMin = DEFAULT_ZOOM_MIN,
    zoomMax = DEFAULT_ZOOM_MAX,
    spreadMin = DEFAULT_SPREAD_MIN,
    spreadMax = DEFAULT_SPREAD_MAX,
    mergeUvDistance = DEFAULT_MERGE_UV_DISTANCE,
    mergeZoomDelta = DEFAULT_MERGE_ZOOM_DELTA,
    gapToleranceFraction = DEFAULT_GAP_TOLERANCE_FRACTION,
  } = opts
  const zoomOpts = { zoomMin, zoomMax, spreadMin, spreadMax }

  if (!diffGrids.length) return []

  const framesPerWindow = Math.max(1, Math.round(windowSec * fps))
  const windows = []
  for (let start = 0; start < diffGrids.length; start += framesPerWindow) {
    const frames = diffGrids.slice(start, start + framesPerWindow)
    const stats = windowStats(frames, { cellKeepFraction, centroidWeightPower })
    windows.push({
      t0: start / fps,
      t1: Math.min(diffGrids.length, start + framesPerWindow) / fps,
      ...stats,
    })
  }

  const maxEnergy = Math.max(...windows.map((w) => w.energy))
  if (maxEnergy <= 0) return []
  const threshold = maxEnergy * minEnergyFraction
  const active = windows.filter(
    (w) => w.energy >= threshold && w.intensity >= minIntensity && w.keptFraction <= uniformCellFraction,
  )
  if (!active.length) return []

  const gapTolerance = (framesPerWindow / fps) * gapToleranceFraction
  const merged = []
  for (const win of active) {
    const last = merged[merged.length - 1]
    if (
      last &&
      win.t0 - last.t1 <= gapTolerance &&
      uvDistance(last, win) <= mergeUvDistance &&
      Math.abs(zoomFromSpread(win.spread, zoomOpts) - last.zoom) <= mergeZoomDelta
    ) {
      const totalEnergy = last.energy + win.energy
      last.u = (last.u * last.energy + win.u * win.energy) / totalEnergy
      last.v = (last.v * last.energy + win.v * win.energy) / totalEnergy
      last.zoom = (last.zoom * last.energy + zoomFromSpread(win.spread, zoomOpts) * win.energy) / totalEnergy
      last.energy = totalEnergy
      last.t1 = win.t1
    } else {
      merged.push({
        t0: win.t0,
        t1: win.t1,
        u: win.u,
        v: win.v,
        zoom: zoomFromSpread(win.spread, zoomOpts),
        energy: win.energy,
      })
    }
  }

  return merged.map(({ t0, t1, u, v, zoom }) => ({ t0, t1, u, v, zoom }))
}

// ---------------------------------------------------------------------------
// ffmpeg-backed extraction (impure — not unit-tested; exercised end-to-end).

function isMissingBinaryError(err) {
  return err && (err.code === 'ENOENT' || /ENOENT/.test(err.message || ''))
}

async function probeDimensions(inputPath) {
  try {
    const { stdout } = await execFileAsync(ffprobePath, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'json',
      inputPath,
    ])
    const stream = JSON.parse(stdout).streams?.[0]
    if (!stream?.width || !stream?.height) {
      throw new Error(`analyze-activity: could not read video dimensions from ${inputPath}`)
    }
    return { width: stream.width, height: stream.height }
  } catch (err) {
    if (isMissingBinaryError(err)) {
      throw new Error('analyze-activity: ffprobe not found on PATH — install ffmpeg (e.g. `brew install ffmpeg`).')
    }
    throw err
  }
}

function runFfmpegRaw(inputPath, fps, width, height) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-i', inputPath,
      '-vf', `fps=${fps},scale=${width}:${height}:flags=area,format=gray`,
      '-f', 'rawvideo',
      '-pix_fmt', 'gray',
      'pipe:1',
    ]
    const proc = spawn(ffmpegPath, args)
    const chunks = []
    let stderr = ''
    proc.stdout.on('data', (chunk) => chunks.push(chunk))
    proc.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    proc.on('error', (err) => {
      if (isMissingBinaryError(err)) {
        reject(new Error('analyze-activity: ffmpeg not found on PATH — install ffmpeg (e.g. `brew install ffmpeg`).'))
      } else {
        reject(err)
      }
    })
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`analyze-activity: ffmpeg exited with code ${code}\n${stderr}`))
        return
      }
      resolve(Buffer.concat(chunks))
    })
  })
}

function diffToGrid(prevFrame, currFrame, width, height, rows, cols) {
  const sums = Array.from({ length: rows }, () => new Array(cols).fill(0))
  const counts = Array.from({ length: rows }, () => new Array(cols).fill(0))
  for (let y = 0; y < height; y++) {
    const row = Math.min(rows - 1, Math.floor((y / height) * rows))
    const rowOffset = y * width
    for (let x = 0; x < width; x++) {
      const col = Math.min(cols - 1, Math.floor((x / width) * cols))
      const idx = rowOffset + x
      sums[row][col] += Math.abs(currFrame[idx] - prevFrame[idx])
      counts[row][col] += 1
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      sums[r][c] = counts[r][c] ? sums[r][c] / counts[r][c] : 0
    }
  }
  return sums
}

/**
 * Extracts ~fps grayscale frames (width px wide, aspect-scaled height) from
 * `inputPath` and returns one GRID_ROWS x GRID_COLS diff grid per consecutive
 * frame pair. Pass `srcWidth`/`srcHeight` when already known (bin/showcase.mjs
 * has already probed the input) to skip a redundant ffprobe call.
 *
 * @param {string} inputPath
 * @param {object} [opts]
 * @param {number} [opts.fps=DEFAULT_FPS]
 * @param {number} [opts.width=DEFAULT_WIDTH]
 * @param {number} [opts.rows] - defaults to gridDimsFor(source) — portrait sources
 *   get the 16-row/8-col shape, landscape the transpose
 * @param {number} [opts.cols]
 * @param {number} [opts.srcWidth] - source video width, skips ffprobe if given with srcHeight
 * @param {number} [opts.srcHeight] - source video height
 * @returns {Promise<number[][][]>}
 */
export async function extractDiffGrids(inputPath, opts = {}) {
  const { fps = DEFAULT_FPS, width = DEFAULT_WIDTH } = opts
  const { width: srcWidth, height: srcHeight } =
    opts.srcWidth && opts.srcHeight ? { width: opts.srcWidth, height: opts.srcHeight } : await probeDimensions(inputPath)
  const dims = gridDimsFor(srcWidth, srcHeight)
  const rows = opts.rows ?? dims.rows
  const cols = opts.cols ?? dims.cols

  const height = Math.max(2, Math.round((width * (srcHeight / srcWidth)) / 2) * 2)
  const buffer = await runFfmpegRaw(inputPath, fps, width, height)

  const frameSize = width * height
  const frameCount = Math.floor(buffer.length / frameSize)
  const grids = []
  for (let i = 0; i < frameCount - 1; i++) {
    const prev = buffer.subarray(i * frameSize, (i + 1) * frameSize)
    const curr = buffer.subarray((i + 1) * frameSize, (i + 2) * frameSize)
    grids.push(diffToGrid(prev, curr, width, height, rows, cols))
  }
  return grids
}

/**
 * Extracts diff grids from `inputPath` and segments them.
 *
 * @param {string} inputPath
 * @param {object} [opts] - forwarded to extractDiffGrids (fps/width/rows/cols/
 *   srcWidth/srcHeight) and segmentActivity (fps/windowSec/minEnergyFraction/
 *   zoomMin/zoomMax/spreadNormalizer/mergeUvDistance/mergeZoomDelta)
 * @returns {Promise<{t0: number, t1: number, u: number, v: number, zoom: number}[]>}
 */
export async function analyzeActivity(inputPath, opts = {}) {
  const diffGrids = await extractDiffGrids(inputPath, opts)
  return segmentActivity(diffGrids, opts)
}

// ---------------------------------------------------------------------------
// CLI wrapper — only runs when this file is executed directly.

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const input = process.argv[2]
  if (!input) {
    console.error('Usage: node scripts/analyze-activity.mjs <video>')
    process.exit(1)
  }
  analyzeActivity(input)
    .then((segments) => {
      console.log(JSON.stringify(segments, null, 2))
    })
    .catch((err) => {
      console.error(err.message || err)
      process.exit(1)
    })
}
