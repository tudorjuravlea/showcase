import { PRESETS } from '../../core/presets.js'
import { EASINGS } from '../../core/timeline.js'

const PRESET_KEYS = Object.keys(PRESETS)
const EASING_KEYS = Object.keys(EASINGS)

export default function AnimationPanel({ scene, updateScene, onPlay }) {
  const { animation } = scene

  function setAnimation(patch) {
    updateScene({ animation: patch })
  }

  return (
    <section className="ma-panel ma-animation-panel">
      <h2>Animation</h2>

      <div className="ma-preset-gallery" role="group" aria-label="Animation preset">
        {PRESET_KEYS.map((key) => (
          <button
            key={key}
            id={`ma-preset-${key}`}
            type="button"
            aria-pressed={animation.preset === key}
            onClick={() => setAnimation({ preset: key })}
          >
            {key}
          </button>
        ))}
      </div>

      <label htmlFor="ma-duration">Duration ({animation.duration}ms)</label>
      <input
        id="ma-duration"
        type="range"
        min={300}
        max={8000}
        step={100}
        value={animation.duration}
        onChange={(event) => setAnimation({ duration: Number(event.target.value) })}
      />

      <label htmlFor="ma-easing-select">Easing</label>
      <select
        id="ma-easing-select"
        value={animation.easing}
        onChange={(event) => setAnimation({ easing: event.target.value })}
      >
        {EASING_KEYS.map((key) => (
          <option key={key} value={key}>
            {key}
          </option>
        ))}
      </select>

      <label htmlFor="ma-loop">
        <input
          id="ma-loop"
          type="checkbox"
          checked={animation.loop}
          onChange={(event) => setAnimation({ loop: event.target.checked })}
        />
        Loop
      </label>

      <label htmlFor="ma-autoplay">
        <input
          id="ma-autoplay"
          type="checkbox"
          checked={animation.autoplay}
          onChange={(event) => setAnimation({ autoplay: event.target.checked })}
        />
        Autoplay
      </label>

      <button id="ma-play" type="button" onClick={onPlay}>
        Play
      </button>
    </section>
  )
}
