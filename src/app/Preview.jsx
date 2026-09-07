import { useEffect, useRef, useState } from 'react'
import { createCssRenderer } from '../render/css/cssRenderer.js'
import { createGlRenderer } from '../render/webgl/glRenderer.js'
import { runAnimation } from '../core/presets.js'
import { requiresCssRenderer } from '../core/scene.js'
import { setTheme, THEME_STORAGE_KEY } from './theme.js'
import '../render/css/device.css'

const THEME_OPTIONS = ['dark', 'light', 'auto']

const RENDERER_FACTORIES = { css: createCssRenderer, webgl: createGlRenderer }

const DRAG_SENSITIVITY = 0.5
const ROTATE_LIMIT = 60

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

// Checked once at module load (a browser's WebGL support doesn't change
// mid-session) — per the spec's "Error handling" section, when WebGL is
// unavailable the editor must disable the Photoreal toggle rather than let
// the user pick a renderer that can't create a context.
function detectWebglAvailable() {
  try {
    const canvas = document.createElement('canvas')
    return !!(window.WebGLRenderingContext && (canvas.getContext('webgl2') || canvas.getContext('webgl')))
  } catch {
    return false
  }
}
const WEBGL_AVAILABLE = detectWebglAvailable()

// Everything about the scene except `pose` — when none of this changes,
// a slider/drag update only needs the cheap setPose() transform update
// instead of a full DOM rebuild (which would tear down a live <iframe>).
function nonPoseKey(scene) {
  return JSON.stringify({
    device: scene.device,
    orientation: scene.orientation,
    content: scene.content,
    style: scene.style,
    renderer: scene.renderer,
  })
}

// The animation config fields that determine which preset/timeline is
// running — changing any of these means the running animation must be torn
// down and restarted (a plain pose edit while a preset is playing does not).
function animationKey(scene) {
  return JSON.stringify(scene.animation)
}

export default function Preview({ scene, updateScene, playToken = 0 }) {
  // App.jsx's module-level initTheme() call has already applied and
  // persisted a setting by the time this ever mounts, so reading storage
  // here (rather than defaulting to "auto") keeps the toggle's highlighted
  // button in sync with what's actually on <html>.
  const [themeSetting, setThemeSetting] = useState(
    () => localStorage.getItem(THEME_STORAGE_KEY) || 'auto'
  )

  function handleThemeChange(setting) {
    setTheme(setting)
    setThemeSetting(setting)
  }

  const containerRef = useRef(null)
  const stageWrapperRef = useRef(null)
  const rendererRef = useRef(null)
  const dragStateRef = useRef(null)
  const lastNonPoseKeyRef = useRef(null)
  const animControllerRef = useRef(null)
  const lastAnimationKeyRef = useRef(null)
  const isFirstPlayTokenRef = useRef(true)

  // Some devices (e.g. laptop at 820px wide) are wider than the space left
  // between the two fixed-width side panels at typical window sizes. The
  // device/canvas keeps its real, untransformed size (pose math, drag
  // handling, and exported HTML all assume that) — this just scales the
  // whole stage down visually to fit, uniformly, so it never bleeds over
  // the panels. Reads layout sizes (offsetWidth/clientWidth), which reflect
  // the untransformed box regardless of any scale already applied.
  function fitStageToWrapper() {
    const wrapper = stageWrapperRef.current
    const stage = containerRef.current
    if (!wrapper || !stage) return
    const contentWidth = stage.offsetWidth
    const contentHeight = stage.offsetHeight
    if (!contentWidth || !contentHeight) return
    const scale = Math.min(1, wrapper.clientWidth / contentWidth, wrapper.clientHeight / contentHeight)
    stage.style.transform = scale < 1 ? `scale(${scale})` : ''
  }

  useEffect(() => {
    const wrapper = stageWrapperRef.current
    if (!wrapper) return undefined
    const observer = new ResizeObserver(fitStageToWrapper)
    observer.observe(wrapper)
    return () => observer.disconnect()
  }, [])

  // Kept in sync so the running animation controller — created once per
  // animation-config change, not per pose edit — always reads the latest
  // pose as its baseline instead of a stale snapshot from whenever it was
  // created.
  const sceneRef = useRef(scene)
  useEffect(() => {
    sceneRef.current = scene
  }, [scene])

  // Re-created whenever scene.renderer changes (not just once on mount) —
  // createCssRenderer and createGlRenderer are different renderer instances
  // entirely, so toggling Photoreal must tear down the old one and build a
  // fresh one of the right kind, not just re-render the old kind with a
  // renderer:"webgl" scene it doesn't know how to honor.
  useEffect(() => {
    const createRenderer = RENDERER_FACTORIES[scene.renderer] || createCssRenderer
    rendererRef.current = createRenderer(containerRef.current)
    // A fresh renderer instance has never had render() called on it, so the
    // next scene effect run must do a full render (not setPose) regardless
    // of what the previous instance last rendered. Matters under React 18
    // StrictMode, which mounts -> cleans up -> remounts effects once in dev.
    lastNonPoseKeyRef.current = null
    // Same reasoning for the animation controller: it was stopped in the
    // previous mount's cleanup, so the next animation effect run must
    // create a fresh one bound to the fresh renderer, even if the
    // animation config itself hasn't changed.
    lastAnimationKeyRef.current = null
    return () => {
      rendererRef.current?.destroy()
      animControllerRef.current?.stop()
    }
  }, [scene.renderer])

  useEffect(() => {
    const key = nonPoseKey(scene)
    if (key === lastNonPoseKeyRef.current) {
      rendererRef.current?.setPose(scene.pose)
    } else {
      rendererRef.current?.render(scene)
      lastNonPoseKeyRef.current = key
      fitStageToWrapper() // device/orientation may have changed the stage's natural size
    }
  }, [scene])

  // Drives the animation preset via runAnimation + setPose, per frame,
  // outside React state. Only restarted when the animation config itself
  // changes (preset/duration/easing/loop/autoplay) — not on every pose edit,
  // which would otherwise restart a running preset on each drag pixel.
  useEffect(() => {
    const key = animationKey(scene)
    if (key === lastAnimationKeyRef.current) return
    lastAnimationKeyRef.current = key
    animControllerRef.current?.stop()
    // `.pose` is a live getter onto sceneRef so presets always animate
    // relative to the current pose, not the one at controller-creation time.
    const liveScene = {
      ...scene,
      get pose() {
        return sceneRef.current.pose
      },
    }
    // containerRef is passed so the scroll-rotate preset can measure the
    // stage's own position (the editor document itself never scrolls).
    animControllerRef.current = runAnimation(
      liveScene,
      (pose) => rendererRef.current?.setPose(pose),
      containerRef.current
    )
  }, [scene])

  // "Play" button: restart the current animation from t=0, regardless of
  // its autoplay setting.
  useEffect(() => {
    if (isFirstPlayTokenRef.current) {
      isFirstPlayTokenRef.current = false
      return
    }
    animControllerRef.current?.seek(0)
    animControllerRef.current?.play()
  }, [playToken])

  function handlePointerDown(event) {
    dragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startRotateX: scene.pose.rotateX,
      startRotateY: scene.pose.rotateY,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handlePointerMove(event) {
    const drag = dragStateRef.current
    if (!drag) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    updateScene({
      pose: {
        rotateY: clamp(drag.startRotateY + dx * DRAG_SENSITIVITY, -ROTATE_LIMIT, ROTATE_LIMIT),
        rotateX: clamp(drag.startRotateX - dy * DRAG_SENSITIVITY, -ROTATE_LIMIT, ROTATE_LIMIT),
      },
    })
  }

  function handlePointerUp() {
    dragStateRef.current = null
  }

  // Photoreal has no live-URL (iframe) content (see requiresCssRenderer);
  // App.jsx's updateScene already forces the scene back to css in that case,
  // so the toggle just needs to stay disabled and explain why. WebGL
  // unavailability is a second, independent reason (per the spec's "Error
  // handling" section) — it can't be "forced back" the same way since the
  // scene already defaults to css.
  const disablePhotoreal = requiresCssRenderer(scene.content) || !WEBGL_AVAILABLE
  const photorealNotice = !WEBGL_AVAILABLE
    ? 'Photoreal is unavailable — WebGL is not supported in this browser.'
    : 'Photoreal is unavailable for live URL content — using Interactive mode.'

  return (
    <div className="ma-preview">
      <div className="ma-renderer-toggle">
        <label htmlFor="ma-photoreal-toggle" className="ma-toggle-label">
          <input
            id="ma-photoreal-toggle"
            type="checkbox"
            checked={scene.renderer === 'webgl'}
            disabled={disablePhotoreal}
            onChange={(event) => updateScene({ renderer: event.target.checked ? 'webgl' : 'css' })}
          />
          Photoreal
        </label>
        {disablePhotoreal && (
          <p id="ma-renderer-notice" className="ma-renderer-notice">
            {photorealNotice}
          </p>
        )}
        <div className="ma-theme-toggle" role="group" aria-label="Theme">
          {THEME_OPTIONS.map((option) => (
            <button
              key={option}
              id={`ma-theme-${option}`}
              type="button"
              aria-pressed={themeSetting === option}
              onClick={() => handleThemeChange(option)}
            >
              {option[0].toUpperCase() + option.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div
        ref={stageWrapperRef}
        className="ma-preview-stage"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <div ref={containerRef} className="ma-stage" />
      </div>
    </div>
  )
}
