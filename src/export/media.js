// Media export: renders a scene through a fresh, offscreen GL renderer
// instance and reads the result back as an image/animation blob. Always
// uses the GL renderer regardless of scene.renderer (see glRenderer.js) —
// canvases can be captured and read back same-frame, DOM cannot — per
// docs/superpowers/specs/2026-09-01-mockupanimate-v2-design.md §3. Must not
// import React — this module is imported only by the editor's ExportPanel,
// never by the standalone export runtimes (src/export/runtime-entry.js,
// runtime-gl-entry.js), so gifenc/mp4-muxer never ship in an exported file.
import { GIFEncoder, quantize, applyPalette } from 'gifenc'
import { Muxer, ArrayBufferTarget } from 'mp4-muxer'
import { createGlRenderer } from '../render/webgl/glRenderer.js'
import { PRESETS } from '../core/presets.js'
import { EASINGS } from '../core/timeline.js'

// The nominal export "stage" a still is rendered onto at 1x — see the
// spec's "Stills" section. Scale (1/2/3) multiplies this directly; video/gif
// resolutions are this same base fit into their maxW/maxH cap (see fitSize).
const STAGE_WIDTH = 1200
const STAGE_HEIGHT = 900

// Fraction of the output frame the device itself is rendered to fill (the
// rest is margin). The offscreen GL renderer is sized to this box via
// createGlRenderer's `pixelSize` option, so the device is rasterised at the
// export's own resolution — 2x really is twice the detail, not the same
// render blitted onto a bigger empty canvas — and the result no longer
// depends on the user's window.devicePixelRatio.
const DEVICE_FILL = 0.88

function deviceFillBox(outputW, outputH) {
  return { width: Math.round(outputW * DEVICE_FILL), height: Math.round(outputH * DEVICE_FILL) }
}

const MIME_TYPES = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }
const STILL_QUALITY = 0.92

// avc1.42001f: H.264 Constrained Baseline, level 3.1 — the widest-compatible
// profile, per the spec's "similar baseline" allowance.
const MP4_CODEC = 'avc1.42001f'
const MP4_BITRATE = 8_000_000

/**
 * Output frame times for a duration/fps pair, 0..1 inclusive of both
 * endpoints. 2000ms @ 30fps -> 61 frames (60 intervals + the start frame).
 * Pure — no DOM/WebGL involved.
 *
 * @param {number} durationMs
 * @param {number} fps
 * @returns {number[]}
 */
export function frameTimes(durationMs, fps) {
  const totalFrames = Math.max(1, Math.round((durationMs / 1000) * fps) + 1)
  if (totalFrames === 1) return [0]
  return Array.from({ length: totalFrames }, (_, i) => i / (totalFrames - 1))
}

/**
 * Fits a stageW x stageH box into a maxW x maxH box, preserving aspect
 * ratio and never upscaling past the source size. Pure geometry — used both
 * to cap video/gif output resolution (fitSize(1200, 900, maxW, maxH)) and,
 * inside captureStill/captureAnimation, to fit the GL canvas's own native
 * render resolution into the export canvas.
 *
 * @param {number} stageW
 * @param {number} stageH
 * @param {number} maxW
 * @param {number} maxH
 * @returns {{w: number, h: number}}
 */
export function fitSize(stageW, stageH, maxW, maxH) {
  const scale = Math.min(1, maxW / stageW, maxH / stageH)
  return { w: Math.round(stageW * scale), h: Math.round(stageH * scale) }
}

// Video/gif "size preset" choices for the Export panel — maxW/maxH cap that
// fitSize(1200, 900, maxW, maxH) fits the base stage into. `preview` is
// deliberately small so an editor preview (or a test) encodes fast.
export const SIZE_PRESETS = {
  '1080p': { maxW: 1920, maxH: 1080 },
  '720p': { maxW: 1280, maxH: 720 },
  preview: { maxW: 320, maxH: 240 },
}

// Fixed per-format frame rate defaults, per the spec's "Animation" section —
// not user-configurable in this panel.
export const FORMAT_DEFAULTS = {
  mp4: { fps: 30, sizePreset: '1080p' },
  gif: { fps: 20, sizePreset: '720p' },
}

function assertImageContent(scene) {
  if (scene.content.type !== 'image') {
    throw new Error('Media export needs image content — url content cannot be captured (cross-origin iframe).')
  }
}

// A hidden, fixed-position, off-viewport container for a throwaway GL
// renderer instance — never shown, always torn down by the caller when done.
function createOffscreenContainer() {
  const container = document.createElement('div')
  container.style.position = 'fixed'
  container.style.left = '-99999px'
  container.style.top = '-99999px'
  container.style.width = '1px'
  container.style.height = '1px'
  container.style.overflow = 'hidden'
  document.body.appendChild(container)
  return container
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob failed'))), type, quality)
  })
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError')
}

/**
 * Renders `scene` onto a 1200x900 * scale frame (a fresh offscreen GL
 * renderer instance, rasterised at that frame's own resolution — see
 * DEVICE_FILL) and reads it back as an image blob.
 *
 * @param {object} scene
 * @param {object} options
 * @param {'png'|'jpeg'|'webp'} options.format
 * @param {1|2|3} options.scale
 * @param {string} [options.background] - defaults to scene.style.background
 * @returns {Promise<Blob>}
 */
export async function captureStill(scene, { format, scale, background } = {}) {
  assertImageContent(scene)
  const resolvedBackground = background ?? scene.style.background

  const outputW = STAGE_WIDTH * scale
  const outputH = STAGE_HEIGHT * scale

  const container = createOffscreenContainer()
  const renderer = createGlRenderer(container, { pixelSize: deviceFillBox(outputW, outputH) })
  try {
    await renderer.render(scene)
    const glCanvas = container.querySelector('canvas')

    const canvas = document.createElement('canvas')
    canvas.width = outputW
    canvas.height = outputH
    const ctx = canvas.getContext('2d')

    // JPEG has no alpha channel, so it always needs an opaque backdrop —
    // white when the scene itself is transparent, per the spec. PNG/WebP
    // only paint a backdrop when the scene has a real (non-transparent)
    // background, so transparent scenes stay transparent.
    const fillColor =
      resolvedBackground !== 'transparent' ? resolvedBackground : format === 'jpeg' ? '#ffffff' : null
    if (fillColor) {
      ctx.fillStyle = fillColor
      ctx.fillRect(0, 0, outputW, outputH)
    }

    // The offscreen canvas was already rendered to fit inside the output
    // frame (DEVICE_FILL), so this blits 1:1 at native resolution; fitSize
    // stays as a never-upscale guard should the two ever disagree.
    const fitted = fitSize(glCanvas.width, glCanvas.height, outputW, outputH)
    ctx.drawImage(glCanvas, (outputW - fitted.w) / 2, (outputH - fitted.h) / 2, fitted.w, fitted.h)

    return await canvasToBlob(canvas, MIME_TYPES[format], format === 'png' ? undefined : STILL_QUALITY)
  } finally {
    renderer.destroy()
    container.remove()
  }
}

// Matches runAnimation's per-mode wiring (src/core/presets.js) exactly, but
// driven by a deterministic raw t in 0..1 instead of a live clock/pointer/
// scroll event:
// - 'timeline' presets go through Timeline's easing curve before tick(), the
//   same as a live play-through (see Timeline._onFrame / seek()).
// - 'pointer' (hover-tilt) presets get a synthetic orbit sweep so a still
//   pointer position doesn't produce a frozen animation.
// - 'scroll' presets map t directly to progress, same as the live scroll
//   handler (which never eases either).
function poseAtTime(scene, preset, rawT) {
  if (preset.mode === 'timeline') {
    const easingFn = EASINGS[scene.animation.easing] || EASINGS.linear
    return { ...scene.pose, ...preset.tick(easingFn(rawT), scene) }
  }
  if (preset.mode === 'pointer') {
    const angle = rawT * Math.PI * 2
    return { ...scene.pose, ...preset.tick({ x: Math.cos(angle), y: Math.sin(angle) }, scene) }
  }
  return { ...scene.pose, ...preset.tick(rawT, scene) } // 'scroll'
}

// Deterministically ticks the scene's preset across frameTimes(), rendering
// and reading back each frame same-frame via a shared offscreen GL renderer.
// Returns raw ImageData per frame plus the fitted output size — encoding
// (gif/mp4/webm) is format-specific and happens afterward in captureAnimation.
async function captureFrames(scene, { fps, maxW, maxH, onProgress, signal }) {
  const preset = PRESETS[scene.animation.preset] || PRESETS.none
  const times = frameTimes(scene.animation.duration, fps)
  const { w, h } = fitSize(STAGE_WIDTH, STAGE_HEIGHT, maxW, maxH)

  const container = createOffscreenContainer()
  // Same true-resolution rule as captureStill: render the device at the
  // frame's own size (minus margin) rather than at its nominal layout size,
  // so gif/mp4 frames show the device filling the frame instead of a
  // devicePixelRatio-dependent thumbnail in the middle of it.
  const renderer = createGlRenderer(container, { pixelSize: deviceFillBox(w, h) })
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })

  try {
    throwIfAborted(signal)
    await renderer.render(scene)
    const glCanvas = container.querySelector('canvas')
    const fitted = fitSize(glCanvas.width, glCanvas.height, w, h)
    const dx = (w - fitted.w) / 2
    const dy = (h - fitted.h) / 2

    // Video/gif containers here have no meaningful alpha story (see
    // captureAnimation's per-format encoders) — always give frames an
    // opaque backdrop, white when the scene itself is transparent.
    const fillColor = scene.style.background !== 'transparent' ? scene.style.background : '#ffffff'

    const frames = []
    for (let i = 0; i < times.length; i++) {
      throwIfAborted(signal)
      renderer.setPose(poseAtTime(scene, preset, times[i]))
      ctx.fillStyle = fillColor
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(glCanvas, dx, dy, fitted.w, fitted.h)
      frames.push(ctx.getImageData(0, 0, w, h))
      onProgress?.(i + 1, times.length)
      // Yield to the event loop between frames so a Cancel click (and the
      // progress UI) can actually be observed mid-capture.
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    return { frames, width: w, height: h }
  } finally {
    renderer.destroy()
    container.remove()
  }
}

function encodeGif(frames, width, height, fps) {
  const gif = GIFEncoder()
  const delay = Math.round(1000 / fps)
  for (const frame of frames) {
    const palette = quantize(frame.data, 256)
    const index = applyPalette(frame.data, palette)
    gif.writeFrame(index, width, height, { palette, delay })
  }
  gif.finish()
  return new Blob([gif.bytes()], { type: 'image/gif' })
}

async function isMp4EncodingSupported(width, height, fps) {
  if (typeof VideoEncoder === 'undefined') return false
  try {
    const { supported } = await VideoEncoder.isConfigSupported({
      codec: MP4_CODEC,
      width,
      height,
      bitrate: MP4_BITRATE,
      framerate: fps,
    })
    return !!supported
  } catch {
    return false
  }
}

async function encodeMp4(frames, width, height, fps, signal) {
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height, frameRate: fps },
    fastStart: 'in-memory',
  })

  let encoderError = null
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      encoderError = e
    },
  })
  encoder.configure({ codec: MP4_CODEC, width, height, bitrate: MP4_BITRATE, framerate: fps })

  const frameDurationUs = 1e6 / fps
  for (let i = 0; i < frames.length; i++) {
    if (signal?.aborted) {
      encoder.close()
      throwIfAborted(signal)
    }
    const videoFrame = new VideoFrame(frames[i].data, {
      format: 'RGBA',
      codedWidth: width,
      codedHeight: height,
      timestamp: Math.round(i * frameDurationUs),
    })
    encoder.encode(videoFrame, { keyFrame: i === 0 })
    videoFrame.close()
  }

  await encoder.flush()
  encoder.close()
  if (encoderError) throw encoderError

  muxer.finalize()
  return new Blob([muxer.target.buffer], { type: 'video/mp4' })
}

// WebCodecs/avc unavailable — replay the already-captured frames onto a live
// canvas at `fps` and record it with MediaRecorder, per the spec's WebM
// fallback. Needs real wall-clock time to elapse between frames (unlike the
// deterministic capture above) because captureStream()/MediaRecorder record
// whatever is on the canvas as time actually passes.
async function encodeWebm(frames, width, height, fps, signal) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.putImageData(frames[0], 0, 0)

  const stream = canvas.captureStream(fps)
  const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' })
  const chunks = []
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data)
  }
  const stopped = new Promise((resolve) => {
    recorder.onstop = resolve
  })

  recorder.start()
  try {
    const frameDurationMs = 1000 / fps
    for (let i = 1; i < frames.length; i++) {
      if (signal?.aborted) throwIfAborted(signal)
      await new Promise((resolve) => setTimeout(resolve, frameDurationMs))
      ctx.putImageData(frames[i], 0, 0)
    }
    await new Promise((resolve) => setTimeout(resolve, frameDurationMs))
  } finally {
    recorder.stop()
    // Waited on inside the finally (not after it) so a cancelled export
    // tears the recorder down too, before the AbortError propagates.
    await stopped
    // captureStream() tracks keep the canvas alive as a live video source
    // until they're explicitly stopped — stopping only the recorder leaks
    // them for the lifetime of the page.
    for (const track of stream.getTracks()) track.stop()
  }

  return new Blob(chunks, { type: 'video/webm' })
}

/**
 * Deterministically ticks the scene's animation preset across `fps` frames
 * of scene.animation.duration (one loop for looping presets) and encodes
 * the result as a gif or mp4. MP4 automatically falls back to WebM
 * ({ext: 'webm'}) when WebCodecs avc encoding isn't available.
 *
 * @param {object} scene
 * @param {object} options
 * @param {'gif'|'mp4'} options.format
 * @param {number} options.fps
 * @param {number} options.maxW
 * @param {number} options.maxH
 * @param {(done: number, total: number) => void} [options.onProgress]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{blob: Blob, ext: string}>}
 */
export async function captureAnimation(scene, { format, fps, maxW, maxH, onProgress, signal }) {
  assertImageContent(scene)
  if (scene.animation.preset === 'none') {
    throw new Error('Animation export needs an animation preset — "none" only supports still formats.')
  }

  const { frames, width, height } = await captureFrames(scene, { fps, maxW, maxH, onProgress, signal })

  if (format === 'gif') {
    return { blob: encodeGif(frames, width, height, fps), ext: 'gif' }
  }

  if (await isMp4EncodingSupported(width, height, fps)) {
    return { blob: await encodeMp4(frames, width, height, fps, signal), ext: 'mp4' }
  }
  return { blob: await encodeWebm(frames, width, height, fps, signal), ext: 'webm' }
}
