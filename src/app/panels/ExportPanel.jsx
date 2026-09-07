import { useEffect, useRef, useState } from 'react'
import { requiresCssRenderer } from '../../core/scene.js'
import { buildExportHtml } from '../../export/exporter.js'
import { captureStill, captureAnimation, SIZE_PRESETS, FORMAT_DEFAULTS } from '../../export/media.js'

const STILL_FORMATS = {
  png: { label: 'PNG', ext: 'png' },
  jpeg: { label: 'JPG', ext: 'jpg' },
  webp: { label: 'WebP', ext: 'webp' },
}
const ANIMATION_FORMATS = { gif: { label: 'GIF' }, mp4: { label: 'MP4' } }
const SCALES = [1, 2, 3]
const SIZE_PRESET_KEYS = Object.keys(SIZE_PRESETS)
const TOAST_DURATION_MS = 5000

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export default function ExportPanel({ scene }) {
  const [format, setFormat] = useState('html')
  const [scale, setScale] = useState(1)
  const [sizePreset, setSizePreset] = useState('1080p')
  const [progress, setProgress] = useState(null) // {done, total} | null
  const [exporting, setExporting] = useState(false)
  // One transient toast slot, shared by the MP4->WebM fallback message and
  // export failures. The element keeps the id #ma-export-fallback it has
  // always had.
  const [notice, setNotice] = useState(null)
  const abortControllerRef = useRef(null)

  useEffect(() => {
    if (!notice) return undefined
    const timer = setTimeout(() => setNotice(null), TOAST_DURATION_MS)
    return () => clearTimeout(timer)
  }, [notice])

  const isStillFormat = format in STILL_FORMATS
  const isAnimationFormat = format in ANIMATION_FORMATS
  const formatLabel = (STILL_FORMATS[format] || ANIMATION_FORMATS[format])?.label || 'HTML'
  const mediaBlockedByContent = format !== 'html' && requiresCssRenderer(scene.content)
  const animationBlockedByPreset = isAnimationFormat && scene.animation.preset === 'none'
  const exportDisabled = exporting || mediaBlockedByContent || animationBlockedByPreset

  function downloadName(ext) {
    return `mockup-${scene.device}-${scene.animation.preset}.${ext}`
  }

  function handleExportHtml() {
    const html = buildExportHtml(scene)
    downloadBlob(new Blob([html], { type: 'text/html' }), downloadName('html'))
  }

  // A failed capture (no WebGL context, a texture that won't decode, an
  // encoder that refuses the size) must surface as a toast, not as an
  // unhandled rejection with a silently re-enabled button.
  function reportFailure(error) {
    setNotice(`Export failed — ${error?.message || 'unknown error'}`)
  }

  async function handleExportStill() {
    setExporting(true)
    setNotice(null)
    try {
      const blob = await captureStill(scene, { format, scale, background: scene.style.background })
      downloadBlob(blob, downloadName(STILL_FORMATS[format].ext))
    } catch (error) {
      reportFailure(error)
    } finally {
      setExporting(false)
    }
  }

  async function handleExportAnimation() {
    const controller = new AbortController()
    abortControllerRef.current = controller
    setExporting(true)
    setNotice(null)
    setProgress({ done: 0, total: 0 })
    try {
      const { maxW, maxH } = SIZE_PRESETS[sizePreset]
      const { fps } = FORMAT_DEFAULTS[format]
      const { blob, ext } = await captureAnimation(scene, {
        format,
        fps,
        maxW,
        maxH,
        signal: controller.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      })
      if (format === 'mp4' && ext === 'webm') {
        setNotice('MP4 (WebCodecs) isn’t available in this browser — exported as WebM instead.')
      }
      downloadBlob(blob, downloadName(ext))
    } catch (error) {
      // A user-initiated cancel is not a failure and needs no toast.
      if (error?.name !== 'AbortError') reportFailure(error)
    } finally {
      setExporting(false)
      setProgress(null)
      abortControllerRef.current = null
    }
  }

  function handleExportClick() {
    if (format === 'html') return handleExportHtml()
    if (isAnimationFormat) return handleExportAnimation()
    return handleExportStill()
  }

  function handleCancel() {
    abortControllerRef.current?.abort()
  }

  // Each animation format has its own spec-mandated default size preset
  // (mp4 -> 1080p, gif -> 720p — see FORMAT_DEFAULTS) — resync whenever the
  // user switches format so picking GIF (without touching the Size select)
  // actually exports at 720p instead of whatever preset MP4 last left
  // selected. Driven from the event that caused the change rather than an
  // effect, per oxlint's react(set-state-in-effect) guidance. A no-op for
  // html/still formats, which don't read sizePreset.
  function handleFormatChange(event) {
    const nextFormat = event.target.value
    setFormat(nextFormat)
    const defaults = FORMAT_DEFAULTS[nextFormat]
    if (defaults) setSizePreset(defaults.sizePreset)
  }

  return (
    <section className="ma-panel ma-export-panel">
      <h2>Export</h2>

      <label htmlFor="ma-export-format">Format</label>
      <select id="ma-export-format" value={format} disabled={exporting} onChange={handleFormatChange}>
        <option value="html">HTML</option>
        <option value="png">PNG</option>
        <option value="jpeg">JPG</option>
        <option value="webp">WebP</option>
        <option value="gif">GIF</option>
        <option value="mp4">MP4</option>
      </select>

      {isStillFormat && (
        <>
          <label htmlFor="ma-export-scale">Scale</label>
          <select
            id="ma-export-scale"
            value={scale}
            disabled={exporting}
            onChange={(event) => setScale(Number(event.target.value))}
          >
            {SCALES.map((s) => (
              <option key={s} value={s}>
                {s}x
              </option>
            ))}
          </select>
        </>
      )}

      {isAnimationFormat && (
        <>
          <label htmlFor="ma-export-size">Size</label>
          <select
            id="ma-export-size"
            value={sizePreset}
            disabled={exporting}
            onChange={(event) => setSizePreset(event.target.value)}
          >
            {SIZE_PRESET_KEYS.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </>
      )}

      {mediaBlockedByContent && (
        <p id="ma-export-notice" className="ma-hint">
          Media export needs an image — browsers can&rsquo;t capture cross-origin iframes.
        </p>
      )}

      {!mediaBlockedByContent && animationBlockedByPreset && (
        <p id="ma-export-notice" className="ma-hint">
          Pick an animation preset to export {ANIMATION_FORMATS[format].label} — &ldquo;none&rdquo; only supports
          still formats.
        </p>
      )}

      {notice && (
        <p id="ma-export-fallback" className="ma-toast" role="status">
          {notice}
        </p>
      )}

      {progress && (
        <p id="ma-export-progress" role="status">
          Frame {progress.done}/{progress.total}
        </p>
      )}

      <button
        id="ma-export"
        className="ma-export-btn"
        type="button"
        disabled={exportDisabled}
        onClick={handleExportClick}
      >
        {/* The option label, not the raw format key — the "jpeg" key would
            otherwise read "Export JPEG" under a JPG option and a .jpg file. */}
        Export {formatLabel}
      </button>

      {exporting && isAnimationFormat && (
        <button id="ma-export-cancel" type="button" onClick={handleCancel}>
          Cancel
        </button>
      )}
    </section>
  )
}
