import { useEffect, useRef, useState } from 'react'
import { DEVICES } from '../../core/devices.js'

const DEVICE_NAMES = Object.keys(DEVICES)
const ORIENTABLE_DEVICES = new Set(['phone', 'tablet'])
const TOAST_DURATION_MS = 4000

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

// Confirms the browser can actually decode `dataUrl` as an image — catches
// both a non-image file (e.g. a PDF) and a file that merely claims an image
// MIME type but is corrupt, so a bad drop can't put unrenderable data.src
// into the scene.
function verifyImageLoads(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('invalid image'))
    img.src = dataUrl
  })
}

// The URL goes straight into an <iframe src> (and is baked into exported
// files), so only the two schemes that can meaningfully be embedded are
// accepted — this rejects javascript:, data:, file: and friends before they
// ever reach scene.content.src.
const ALLOWED_URL_PROTOCOLS = new Set(['http:', 'https:'])

function isEmbeddableUrl(value) {
  try {
    return ALLOWED_URL_PROTOCOLS.has(new URL(value).protocol)
  } catch {
    return false
  }
}

export default function ContentPanel({ scene, updateScene }) {
  const fileInputRef = useRef(null)
  const [urlValue, setUrlValue] = useState(scene.content.type === 'url' ? scene.content.src : '')
  const [toast, setToast] = useState(null)

  useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => setToast(null), TOAST_DURATION_MS)
    return () => clearTimeout(timer)
  }, [toast])

  async function loadImageFile(file) {
    if (!file) return
    try {
      const dataUrl = await readFileAsDataUrl(file)
      await verifyImageLoads(dataUrl)
      updateScene({ content: { type: 'image', src: dataUrl } })
    } catch {
      // Bad image file: per the spec's "Error handling" section, show a
      // toast and keep whatever content was already in the scene.
      setToast(`Couldn't load "${file.name}" — not a valid image.`)
    }
  }

  function handleFileInputChange(event) {
    loadImageFile(event.target.files?.[0])
  }

  function handleDrop(event) {
    event.preventDefault()
    loadImageFile(event.dataTransfer.files?.[0])
  }

  function handleUrlSubmit(event) {
    event.preventDefault()
    if (!isEmbeddableUrl(urlValue)) {
      setToast('Only http:// and https:// URLs can be embedded.')
      return
    }
    updateScene({ content: { type: 'url', src: urlValue } })
  }

  const orientationDisabled = !ORIENTABLE_DEVICES.has(scene.device)

  return (
    <section className="ma-panel ma-content-panel">
      <h2>Content</h2>

      {toast && (
        <p id="ma-toast" className="ma-toast" role="status">
          {toast}
        </p>
      )}

      <div
        className="ma-dropzone"
        onDrop={handleDrop}
        onDragOver={(event) => event.preventDefault()}
        onClick={() => fileInputRef.current?.click()}
      >
        Drop an image, or click to choose one
        <input
          ref={fileInputRef}
          className="ma-file-input"
          type="file"
          accept="image/*"
          onChange={handleFileInputChange}
          style={{ display: 'none' }}
        />
      </div>

      <form onSubmit={handleUrlSubmit}>
        <label htmlFor="ma-url-input">Live URL</label>
        <input
          id="ma-url-input"
          type="url"
          placeholder="https://..."
          value={urlValue}
          onChange={(event) => setUrlValue(event.target.value)}
        />
        <button type="submit">Use URL</button>
      </form>

      {scene.content.type === 'url' && (
        <p id="ma-xframe-hint" className="ma-hint">
          If the preview looks blank, this site may block embedding
          (X-Frame-Options) — that can't be detected automatically.
        </p>
      )}

      <label htmlFor="ma-device-select">Device</label>
      <select
        id="ma-device-select"
        value={scene.device}
        onChange={(event) => updateScene({ device: event.target.value })}
      >
        {DEVICE_NAMES.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>

      <label htmlFor="ma-orientation-select">Orientation</label>
      <select
        id="ma-orientation-select"
        value={scene.orientation}
        disabled={orientationDisabled}
        onChange={(event) => updateScene({ orientation: event.target.value })}
      >
        <option value="portrait">Portrait</option>
        <option value="landscape">Landscape</option>
      </select>
    </section>
  )
}
