// Resolves the ffmpeg/ffprobe binaries this project shells out to (see
// bin/showcase.mjs and scripts/analyze-activity.mjs). Prefers the static
// binaries bundled via the optional ffmpeg-static/ffprobe-static npm
// packages — so a fresh `git clone` + `npm install` works with no manual
// ffmpeg setup — and falls back to the bare PATH name (today's behavior)
// when those optionalDependencies aren't installed (e.g. their binary
// download failed on an exotic platform) or the resolved file is missing.
//
// createRequire is used because ffmpeg-static/ffprobe-static are CJS
// packages exporting a plain path string/object, and this file is ESM.

import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

const require = createRequire(import.meta.url)

function resolveBundled(pkg, pickPath) {
  try {
    const resolved = pickPath(require(pkg))
    if (resolved && existsSync(resolved)) return resolved
  } catch {
    // Not installed (optionalDependency skipped or its install failed) —
    // fall through to the bare PATH name below.
  }
  return null
}

export const ffmpegPath = resolveBundled('ffmpeg-static', (mod) => mod) || 'ffmpeg'
export const ffprobePath = resolveBundled('ffprobe-static', (mod) => mod.path) || 'ffprobe'
