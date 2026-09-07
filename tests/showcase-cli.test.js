// Pure argument/fit/timing/defaults math for bin/showcase.mjs — see its own
// header comment. The I/O-heavy parts (ffprobe/ffmpeg/vite/Playwright) need
// real binaries and a real browser and are covered end-to-end instead by
// e2e/showcase.spec.js.
import { describe, it, expect } from 'vitest'
import {
  contentKindFromExtension,
  mimeForPath,
  isBrowserSafeVideo,
  needsHdrToneMap,
  hdrToSdrFilter,
  HDR_REFERENCE_NITS,
  resolveOrientation,
  resolveLook,
  clampAutoDuration,
  resolveDuration,
  outputDimensions,
  outputFrameTimes,
  defaultOutputPath,
  normalizeActivity,
  parseArgs,
  DEFAULT_DEVICE,
  DEFAULT_FRAME,
  VALID_FRAMES,
} from '../bin/showcase.mjs'
import { lookFrame } from '../src/showcase/looks.js'
import { screenAspect } from '../src/render/webgl/layout.js'

describe('contentKindFromExtension', () => {
  it.each(['clip.mp4', 'clip.MOV', 'clip.webm', 'clip.mkv', 'clip.avi', 'clip.m4v'])('%s is a video', (file) => {
    expect(contentKindFromExtension(file)).toBe('video')
  })

  it.each(['shot.png', 'shot.JPG', 'shot.jpeg', 'shot.webp', 'shot.gif'])('%s is an image', (file) => {
    expect(contentKindFromExtension(file)).toBe('image')
  })

  it('throws a clear error for an unrecognized extension', () => {
    expect(() => contentKindFromExtension('notes.txt')).toThrow(/unrecognized file extension/)
  })
})

describe('mimeForPath', () => {
  it('maps video extensions to a video mime type', () => {
    expect(mimeForPath('clip.mp4', 'video')).toBe('video/mp4')
    expect(mimeForPath('clip.mov', 'video')).toBe('video/quicktime')
  })

  it('maps image extensions to an image mime type', () => {
    expect(mimeForPath('shot.png', 'image')).toBe('image/png')
    expect(mimeForPath('shot.jpg', 'image')).toBe('image/jpeg')
  })
})

describe('isBrowserSafeVideo', () => {
  it('accepts h264 in mp4/m4v', () => {
    expect(isBrowserSafeVideo('clip.mp4', 'h264')).toBe(true)
    expect(isBrowserSafeVideo('clip.m4v', 'h264')).toBe(true)
  })

  it('rejects hevc in mp4/mov (e.g. an iPhone screen recording)', () => {
    expect(isBrowserSafeVideo('clip.mp4', 'hevc')).toBe(false)
    expect(isBrowserSafeVideo('ScreenRecording.mov', 'hevc')).toBe(false)
  })

  it('rejects h264 inside a .mov container (Chromium demux support is unreliable)', () => {
    expect(isBrowserSafeVideo('clip.mov', 'h264')).toBe(false)
  })

  it('accepts vp8/vp9/av1 in webm, rejects other codecs in webm', () => {
    expect(isBrowserSafeVideo('clip.webm', 'vp9')).toBe(true)
    expect(isBrowserSafeVideo('clip.webm', 'vp8')).toBe(true)
    expect(isBrowserSafeVideo('clip.webm', 'av1')).toBe(true)
    expect(isBrowserSafeVideo('clip.webm', 'h264')).toBe(false)
  })

  it('rejects unsupported containers outright (mkv, avi)', () => {
    expect(isBrowserSafeVideo('clip.mkv', 'h264')).toBe(false)
    expect(isBrowserSafeVideo('clip.avi', 'h264')).toBe(false)
  })
})

// An iPhone screen recording is 10-bit PQ (SMPTE 2084) BT.2020: fed to the
// browser as-is it gets tone-mapped against a 203-nit reference white and the
// screen ends up washed out (measured: white 255 arrived as 187). See
// hdrToSdrFilter's own block comment.
describe('HDR detection and conversion', () => {
  it('treats an smpte2084 (PQ) transfer as HDR and everything else as SDR', () => {
    expect(needsHdrToneMap('smpte2084')).toBe(true)
    for (const transfer of ['bt709', 'iec61966-2-1', 'smpte170m', 'unknown', null, undefined]) {
      expect(needsHdrToneMap(transfer)).toBe(false)
    }
  })

  it('maps PQ reference white to SDR white at 100 nits', () => {
    expect(HDR_REFERENCE_NITS).toBe(100)
    // 10000/nits is the multiplier the PQ EOTF's 0..1 output is scaled by.
    expect(hdrToSdrFilter()).toContain('*100,1)')
    expect(hdrToSdrFilter(200)).toContain('*50,1)')
  })

  it('converts, re-tags AND strips the HDR metadata that would re-trigger tone mapping', () => {
    const filter = hdrToSdrFilter()
    // PQ EOTF -> BT.2020->BT.709 primaries in linear light -> sRGB OETF.
    expect(filter).toContain('format=gbrp16le')
    expect(filter.match(/lutrgb=/g)).toHaveLength(2)
    expect(filter).toContain('colorchannelmixer=rr=1.6605')
    // ...then say what the frames now are, on the frames themselves (the
    // -color_* output options do not override filtered frame properties).
    expect(filter).toContain('scale=out_color_matrix=bt709:out_range=tv')
    expect(filter).toContain('setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv')
    // ...and drop the mastering-display/content-light side data, which
    // otherwise survives into the mp4 and makes Chromium tone-map again.
    expect(filter).toContain('sidedata=delete:type=MASTERING_DISPLAY_METADATA')
    expect(filter).toContain('sidedata=delete:type=CONTENT_LIGHT_LEVEL')
  })
})

describe('resolveOrientation', () => {
  it('a wider-than-tall video on an orientable device (phone) is landscape', () => {
    expect(resolveOrientation('phone', 1920, 1080)).toBe('landscape')
  })

  it('a taller-than-wide video on an orientable device (phone) is portrait', () => {
    expect(resolveOrientation('phone', 644, 1332)).toBe('portrait')
  })

  it('tablet is orientable too', () => {
    expect(resolveOrientation('tablet', 644, 1332)).toBe('portrait')
  })

  it('laptop is always landscape regardless of content aspect', () => {
    expect(resolveOrientation('laptop', 644, 1332)).toBe('landscape')
  })

  it('browser is always landscape regardless of content aspect', () => {
    expect(resolveOrientation('browser', 644, 1332)).toBe('landscape')
  })
})

describe('resolveLook', () => {
  it('defaults to reference for both video and image when no look is requested', () => {
    expect(resolveLook(undefined, 'video')).toBe('reference')
    expect(resolveLook(undefined, 'image')).toBe('reference')
  })

  it('an explicit "auto" still resolves to the content-aware default', () => {
    expect(resolveLook('auto', 'video')).toBe('auto-action')
    expect(resolveLook('auto', 'image')).toBe('hero-drift')
  })

  it('an explicit look overrides the default for either kind', () => {
    expect(resolveLook('orbit-loop', 'video')).toBe('orbit-loop')
    expect(resolveLook('close-up-pan', 'image')).toBe('close-up-pan')
    expect(resolveLook('reference', 'image')).toBe('reference')
  })
})

describe('clampAutoDuration', () => {
  it('clamps below 6s up to 6s', () => {
    expect(clampAutoDuration(2)).toBe(6)
  })

  it('clamps above 30s down to 30s', () => {
    expect(clampAutoDuration(120)).toBe(120)
    expect(clampAutoDuration(150)).toBe(120) // only the flag-range ceiling clamps
  })

  it('leaves an in-range value untouched', () => {
    expect(clampAutoDuration(15)).toBe(15)
  })
})

describe('resolveDuration', () => {
  it('an explicit --duration always wins verbatim, even below the 6s clamp', () => {
    expect(resolveDuration(4, 'video', 4.004)).toBe(4)
  })

  it('image content defaults to 10s when no duration is given', () => {
    expect(resolveDuration(null, 'image', 0)).toBe(10)
  })

  it('video content defaults to its own (clamped) duration', () => {
    expect(resolveDuration(null, 'video', 4.004)).toBe(6) // clamped up from 4.004
    expect(resolveDuration(null, 'video', 15)).toBe(15)
    expect(resolveDuration(null, 'video', 90)).toBe(90) // full recording — Tudor's standing rule
  })
})

describe('outputDimensions', () => {
  // --size is the SHORT side; the other axis comes from the device screen's
  // own aspect (src/render/webgl/layout.js's screenAspect), not from 16:9.
  it('phone portrait: short side is width, screen-derived height', () => {
    expect(outputDimensions('phone', 'portrait', 1080)).toEqual({ width: 1080, height: 2352 })
  })

  it('phone landscape: short side is height, screen-derived width', () => {
    expect(outputDimensions('phone', 'landscape', 1080)).toEqual({ width: 2416, height: 1080 })
  })

  it('tablet portrait/landscape are mirror images of each other', () => {
    expect(outputDimensions('tablet', 'portrait', 1080)).toEqual({ width: 1080, height: 1462 })
    expect(outputDimensions('tablet', 'landscape', 1080)).toEqual({ width: 1462, height: 1080 })
  })

  it('laptop/browser (always landscape) derive on the width axis', () => {
    expect(outputDimensions('laptop', 'landscape', 1080)).toEqual({ width: 1760, height: 1080 })
    expect(outputDimensions('browser', 'landscape', 1080)).toEqual({ width: 1786, height: 1080 })
  })

  it('matches the e2e smoke\'s --size 360 phone-portrait case exactly', () => {
    expect(outputDimensions('phone', 'portrait', 360)).toEqual({ width: 360, height: 784 })
  })

  // The whole point of the change: the frame IS the screen's shape, so the
  // ending can fill it on both axes at once instead of cropping one.
  it.each([
    ['phone', 'portrait'],
    ['phone', 'landscape'],
    ['tablet', 'portrait'],
    ['tablet', 'landscape'],
    ['laptop', 'landscape'],
    ['browser', 'landscape'],
  ])('%s/%s frame aspect equals the screen aspect within even-pixel rounding', (device, orientation) => {
    const { width, height } = outputDimensions(device, orientation, 1080)
    const expected = screenAspect(device, orientation)
    // Rounding each axis to an even pixel can move the ratio by at most
    // ~1px/1080 either way; 0.2% is comfortably above that and well below any
    // real aspect difference.
    expect(Math.abs(width / height / expected - 1)).toBeLessThan(0.002)
  })

  it('both dimensions are always even (yuv420p requirement)', () => {
    const { width, height } = outputDimensions('phone', 'portrait', 361)
    expect(width % 2).toBe(0)
    expect(height % 2).toBe(0)
  })
})

describe('outputFrameTimes', () => {
  it('4s @ 12fps produces 48 frames', () => {
    const times = outputFrameTimes(4, 12)
    expect(times).toHaveLength(48)
  })

  it('starts at 0 and never reaches 1', () => {
    const times = outputFrameTimes(2, 30)
    expect(times[0]).toBe(0)
    expect(times[times.length - 1]).toBeLessThan(1)
  })

  it('is evenly spaced by 1/N', () => {
    const times = outputFrameTimes(1, 10)
    expect(times).toHaveLength(10)
    for (let i = 1; i < times.length; i++) {
      expect(times[i] - times[i - 1]).toBeCloseTo(0.1, 10)
    }
  })

  it('a zero duration still returns a single frame', () => {
    expect(outputFrameTimes(0, 30)).toEqual([0])
  })
})

describe('defaultOutputPath', () => {
  it('builds mockup-showcase-<look>.<ext>', () => {
    expect(defaultOutputPath('auto-action', 'mp4')).toBe('mockup-showcase-auto-action.mp4')
    expect(defaultOutputPath('hero-drift', 'html')).toBe('mockup-showcase-hero-drift.html')
  })
})

describe('normalizeActivity', () => {
  it('passes t0/t1 through in seconds (auto-action divides by ctx.duration itself)', () => {
    const segments = [{ t0: 1, t1: 2, u: 0.3, v: 0.4, zoom: 0.5 }]
    expect(normalizeActivity(segments, 4)).toEqual([{ t0: 1, t1: 2, u: 0.3, v: 0.4, zoom: 0.5 }])
  })

  it('clamps to durationSec when a segment extends past the output duration', () => {
    const segments = [{ t0: 3, t1: 6, u: 0.5, v: 0.5, zoom: 0.5 }]
    const [result] = normalizeActivity(segments, 4)
    expect(result.t1).toBe(4)
  })

  it('drops segments that become degenerate after clamping', () => {
    const segments = [{ t0: 5, t1: 6, u: 0.5, v: 0.5, zoom: 0.5 }]
    expect(normalizeActivity(segments, 4)).toEqual([])
  })

  it('returns [] when durationSec is 0', () => {
    expect(normalizeActivity([{ t0: 0, t1: 1, u: 0.5, v: 0.5, zoom: 0.5 }], 0)).toEqual([])
  })

  it('integration: fed into lookFrame(auto-action), the camera stays engaged across the real segment window instead of collapsing', () => {
    const segmentsSec = [{ t0: 0, t1: 3.5, u: 0.5, v: 0.5, zoom: 0.4 }]
    const durationSec = 4
    const activity = normalizeActivity(segmentsSec, durationSec)
    const ctx = { duration: durationSec, activity }

    // Midway through the action window (t=0.5 of 1, i.e. 2s of 4s — well inside [0, 3.5]),
    // the camera should still be engaged (zoomed toward the action), not pulled back to hero.
    const mid = lookFrame('auto-action', 0.5, ctx)
    expect(mid.camera.distance).toBeLessThanOrEqual(0.6)

    // Only in the final ~12% of the timeline (after the segment ends at t1=3.5/4=0.875)
    // should the camera pull back out to near-hero framing.
    const late = lookFrame('auto-action', 0.98, ctx)
    expect(late.camera.distance).toBeGreaterThanOrEqual(0.9)
  })
})

describe('parseArgs', () => {
  it('parses a bare input path with all defaults', () => {
    const args = parseArgs(['clip.mp4'])
    expect(args.input).toBe('clip.mp4')
    expect(args.device).toBeUndefined()
    expect(args.html).toBeUndefined()
  })

  it('parses every flag', () => {
    const args = parseArgs([
      'clip.mp4', '--device', 'tablet', '--look', 'orbit-loop', '--duration', '12',
      '--fps', '24', '--size', '720', '--out', 'out.mp4', '--html',
    ])
    expect(args).toMatchObject({
      input: 'clip.mp4', device: 'tablet', look: 'orbit-loop', duration: 12, fps: 24, size: 720, out: 'out.mp4', html: true,
    })
  })

  it('parses --contained as a boolean flag', () => {
    const args = parseArgs(['clip.mp4', '--contained'])
    expect(args.contained).toBe(true)
  })

  it('rejects a missing input path', () => {
    expect(() => parseArgs([])).toThrow(/Usage/)
  })

  it('rejects more than one positional argument', () => {
    expect(() => parseArgs(['a.mp4', 'b.mp4'])).toThrow(/Usage/)
  })

  it('rejects an unknown flag', () => {
    expect(() => parseArgs(['clip.mp4', '--bogus'])).toThrow(/unknown flag/)
  })

  it('rejects an invalid --device', () => {
    expect(() => parseArgs(['clip.mp4', '--device', 'watch'])).toThrow(/invalid --device/)
  })

  it('rejects an invalid --look', () => {
    expect(() => parseArgs(['clip.mp4', '--look', 'auto-action'])).toThrow(/invalid --look/)
  })

  it('parses a valid --frame', () => {
    expect(parseArgs(['clip.mp4', '--frame', 'silver']).frame).toBe('silver')
  })

  it('rejects an invalid --frame', () => {
    expect(() => parseArgs(['clip.mp4', '--frame', 'rose-gold'])).toThrow(/invalid --frame/)
  })

  it('accepts --background as 6-digit hex or a CSS name, normalizes #rgb, rejects anything else', () => {
    expect(parseArgs(['clip.mp4', '--background', '#FFCC00']).background).toBe('#FFCC00')
    expect(parseArgs(['clip.mp4', '--background', 'white']).background).toBe('white')
    expect(parseArgs(['clip.mp4', '--background', '#fe6']).background).toBe('#ffee66')
    // Travels into inline <style>/<script> and an ffmpeg filter arg — shapes
    // beyond hex/name (functions, payloads) must be refused at the door.
    expect(() => parseArgs(['clip.mp4', '--background', 'rgb(1,2,3)'])).toThrow(/invalid --background/)
    expect(() => parseArgs(['clip.mp4', '--background', '#000;}</style><script>x'])).toThrow(/invalid --background/)
  })

  it('leaves --frame undefined when not passed (main() applies DEFAULT_FRAME)', () => {
    expect(parseArgs(['clip.mp4']).frame).toBeUndefined()
  })

  it('rejects a non-numeric --duration', () => {
    expect(() => parseArgs(['clip.mp4', '--duration', 'soon'])).toThrow(/needs a number/)
  })

  it('rejects a non-finite or empty numeric flag value', () => {
    expect(() => parseArgs(['clip.mp4', '--fps', 'Infinity'])).toThrow(/needs a number/)
    expect(() => parseArgs(['clip.mp4', '--size', ''])).toThrow(/needs a number/)
  })

  it('rejects numeric flags outside their sane range', () => {
    expect(() => parseArgs(['clip.mp4', '--duration', '0'])).toThrow(/--duration must be between 1 and 120/)
    expect(() => parseArgs(['clip.mp4', '--duration', '600'])).toThrow(/--duration must be between 1 and 120/)
    expect(() => parseArgs(['clip.mp4', '--fps', '-30'])).toThrow(/--fps must be between 5 and 60/)
    expect(() => parseArgs(['clip.mp4', '--fps', '240'])).toThrow(/--fps must be between 5 and 60/)
    expect(() => parseArgs(['clip.mp4', '--size', '16'])).toThrow(/--size must be between 240 and 2160/)
    expect(() => parseArgs(['clip.mp4', '--size', '8000'])).toThrow(/--size must be between 240 and 2160/)
  })

  it('accepts values at the edges of each range', () => {
    expect(parseArgs(['clip.mp4', '--duration', '1']).duration).toBe(1)
    expect(parseArgs(['clip.mp4', '--duration', '120']).duration).toBe(120)
    expect(parseArgs(['clip.mp4', '--fps', '5']).fps).toBe(5)
    expect(parseArgs(['clip.mp4', '--fps', '60']).fps).toBe(60)
    expect(parseArgs(['clip.mp4', '--size', '240']).size).toBe(240)
    expect(parseArgs(['clip.mp4', '--size', '2160']).size).toBe(2160)
  })
})

describe('DEFAULT_DEVICE', () => {
  it('is phone', () => {
    expect(DEFAULT_DEVICE).toBe('phone')
  })
})

describe('DEFAULT_FRAME', () => {
  it('is gold, matching the reference recording\'s hardware', () => {
    expect(DEFAULT_FRAME).toBe('gold')
    expect(VALID_FRAMES).toContain(DEFAULT_FRAME)
  })
})
