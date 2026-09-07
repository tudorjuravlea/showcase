// Pure activity-segmentation coverage (see scripts/analyze-activity.mjs).
// The ffmpeg-backed extraction (extractDiffGrids/analyzeActivity) needs a
// real video file and binary on PATH — exercised end-to-end by
// e2e/showcase.spec.js instead; this file only drives segmentActivity
// directly on synthetic grids.
import { describe, it, expect } from 'vitest'
import { segmentActivity, gridDimsFor, GRID_ROWS, GRID_COLS } from '../scripts/analyze-activity.mjs'

function emptyGrid() {
  return Array.from({ length: GRID_ROWS }, () => new Array(GRID_COLS).fill(0))
}

// A grid with a single "hot" cell at (row, col) carrying `energy`, zero
// elsewhere — the centroid math should reproduce that cell's own center
// coordinate exactly, and spread should be exactly 0 (all energy at one
// point).
function hotCellGrid(row, col, energy = 200) {
  const grid = emptyGrid()
  grid[row][col] = energy
  return grid
}

// A grid with a rectangular block of equally-hot cells — the block's own
// size is what the spread -> zoom mapping reads.
function hotBlockGrid(row0, col0, rowCount, colCount, energy = 200) {
  const grid = emptyGrid()
  for (let r = row0; r < row0 + rowCount; r++) {
    for (let c = col0; c < col0 + colCount; c++) grid[r][c] = energy
  }
  return grid
}

function repeat(grid, count) {
  return Array.from({ length: count }, () => grid)
}

describe('segmentActivity', () => {
  it('returns no segments for an empty input', () => {
    expect(segmentActivity([])).toEqual([])
  })

  it('returns no segments when every frame is static (all-zero grids)', () => {
    const grids = repeat(emptyGrid(), 20)
    expect(segmentActivity(grids, { fps: 4 })).toEqual([])
  })

  it('a single hot cell produces one segment centered exactly on that cell, zoomed to zoomMin', () => {
    // GRID_ROWS x GRID_COLS = 8 x 16; cell (2, 3) center is u=(3+0.5)/16, v=(2+0.5)/8.
    const grids = repeat(hotCellGrid(2, 3), 8) // 8 frames @ 4fps = one full 2s window
    const segments = segmentActivity(grids, { fps: 4, windowSec: 2, zoomMin: 0.3, zoomMax: 0.7 })

    expect(segments).toHaveLength(1)
    expect(segments[0].u).toBeCloseTo(3.5 / 16, 6)
    expect(segments[0].v).toBeCloseTo(2.5 / 8, 6)
    expect(segments[0].zoom).toBeCloseTo(0.3, 6)
    expect(segments[0].t0).toBe(0)
    expect(segments[0].t1).toBeCloseTo(2, 6)
  })

  it('drops a low-energy window relative to a much more active one', () => {
    const fps = 4
    const windowSec = 2 // 8 frames/window
    const grids = [
      ...repeat(hotCellGrid(0, 0, 250), 8), // strong window 1
      ...repeat(hotCellGrid(7, 15, 5), 8), // near-static window 2 (well under 15% of peak)
    ]
    const segments = segmentActivity(grids, { fps, windowSec, minEnergyFraction: 0.15 })

    expect(segments).toHaveLength(1)
    expect(segments[0].u).toBeCloseTo(0.5 / 16, 6)
    expect(segments[0].v).toBeCloseTo(0.5 / 8, 6)
  })

  it('produces two separated segments for two bursts with a static gap between them', () => {
    const fps = 4
    const windowSec = 2 // 8 frames/window
    const grids = [
      ...repeat(hotCellGrid(0, 0, 200), 8), // window 1: top-left burst
      ...repeat(emptyGrid(), 8), // window 2: static gap
      ...repeat(hotCellGrid(7, 15, 200), 8), // window 3: bottom-right burst
    ]
    const segments = segmentActivity(grids, { fps, windowSec })

    expect(segments).toHaveLength(2)
    expect(segments[0].u).toBeLessThan(0.2)
    expect(segments[0].v).toBeLessThan(0.2)
    expect(segments[1].u).toBeGreaterThan(0.8)
    expect(segments[1].v).toBeGreaterThan(0.8)
    // Segments are in chronological order and don't overlap.
    expect(segments[0].t1).toBeLessThanOrEqual(segments[1].t0)
  })

  it('merges adjacent windows with similar activity into a single continuous segment', () => {
    const fps = 4
    const windowSec = 2 // 8 frames/window
    // Same hot cell across two consecutive windows (no gap, identical u/v/zoom) —
    // should merge into one segment spanning both windows' full duration.
    const grids = repeat(hotCellGrid(4, 8, 200), 16)
    const segments = segmentActivity(grids, { fps, windowSec })

    expect(segments).toHaveLength(1)
    expect(segments[0].t0).toBe(0)
    expect(segments[0].t1).toBeCloseTo(4, 6)
  })

  it('uniform full-screen motion yields no segments at all', () => {
    const grid = emptyGrid()
    // Every cell equally hot — a full-screen crossfade/flash, not localized
    // action. There is nothing to point a camera at, so the look should be
    // left to breathe on its hero framing rather than pushed in dead-center.
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) grid[r][c] = 100
    }
    expect(segmentActivity(repeat(grid, 8), { fps: 4, windowSec: 2 })).toEqual([])
  })

  it('a localized burst zooms in tight', () => {
    // A 4x4 block covers a quarter of each axis: spread stays low, so the
    // segment lands near zoomMin rather than at the wide end.
    const grids = repeat(hotBlockGrid(2, 6, 4, 4), 8)
    const segments = segmentActivity(grids, { fps: 4, windowSec: 2, zoomMin: 0.3, zoomMax: 0.7 })

    expect(segments).toHaveLength(1)
    expect(segments[0].u).toBeCloseTo(8 / 16, 6)
    expect(segments[0].v).toBeCloseTo(4 / 8, 6)
    expect(segments[0].zoom).toBeLessThan(0.45)
  })

  it('motion scattered to opposite corners zooms out to zoomMax', () => {
    const grid = emptyGrid()
    for (const [r, c] of [[0, 0], [0, GRID_COLS - 1], [GRID_ROWS - 1, 0], [GRID_ROWS - 1, GRID_COLS - 1]]) {
      grid[r][c] = 200
    }
    const segments = segmentActivity(repeat(grid, 8), { fps: 4, windowSec: 2, zoomMin: 0.3, zoomMax: 0.7 })

    expect(segments).toHaveLength(1)
    expect(segments[0].zoom).toBeCloseTo(0.7, 6)
  })

  it('the centroid follows the hottest cells, not the frame-wide average', () => {
    // Broad low-level motion everywhere (e.g. a scrolling page) plus one much
    // hotter region. Averaging every cell would park the centroid at 0.5/0.5;
    // only the hot cells should steer it.
    const grid = emptyGrid()
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) grid[r][c] = 20
    }
    for (let c = 12; c < 16; c++) grid[6][c] = 200

    const segments = segmentActivity(repeat(grid, 8), { fps: 4, windowSec: 2 })
    expect(segments).toHaveLength(1)
    expect(segments[0].u).toBeCloseTo(14 / 16, 6)
    expect(segments[0].v).toBeCloseTo(6.5 / 8, 6)
  })
})

describe('gridDimsFor', () => {
  it('gives a portrait source the long axis in rows and landscape the transpose', () => {
    expect(gridDimsFor(1288, 2662)).toEqual({ rows: GRID_COLS, cols: GRID_ROWS })
    expect(gridDimsFor(1920, 1080)).toEqual({ rows: GRID_ROWS, cols: GRID_COLS })
    expect(gridDimsFor(1000, 1000)).toEqual({ rows: GRID_ROWS, cols: GRID_COLS })
  })

  it('keeps two adjacent-but-different bursts as separate segments (no gap, but far apart in uv)', () => {
    const fps = 4
    const windowSec = 2
    const grids = [
      ...repeat(hotCellGrid(0, 0, 200), 8), // top-left
      ...repeat(hotCellGrid(7, 15, 200), 8), // bottom-right, immediately after, no gap
    ]
    const segments = segmentActivity(grids, { fps, windowSec, mergeUvDistance: 0.12 })

    expect(segments).toHaveLength(2)
  })
})
