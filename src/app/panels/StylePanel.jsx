const DEFAULT_CUSTOM_BACKGROUND = '#1d2230'

export default function StylePanel({ scene, updateScene }) {
  const { style } = scene
  const hasCustomBackground = style.background !== 'transparent'

  function setStyle(patch) {
    updateScene({ style: patch })
  }

  return (
    <section className="ma-panel ma-style-panel">
      <h2>Style</h2>

      <label htmlFor="ma-style-shadow">
        <input
          id="ma-style-shadow"
          type="checkbox"
          checked={style.shadow}
          onChange={(event) => setStyle({ shadow: event.target.checked })}
        />
        Shadow
      </label>

      <label htmlFor="ma-style-glare">
        <input
          id="ma-style-glare"
          type="checkbox"
          checked={style.glare}
          onChange={(event) => setStyle({ glare: event.target.checked })}
        />
        Glare
      </label>

      <label htmlFor="ma-style-glow">
        <input
          id="ma-style-glow"
          type="checkbox"
          checked={style.glow}
          onChange={(event) => setStyle({ glow: event.target.checked })}
        />
        Glow
      </label>

      <label htmlFor="ma-style-background-toggle">
        <input
          id="ma-style-background-toggle"
          type="checkbox"
          checked={hasCustomBackground}
          onChange={(event) =>
            setStyle({ background: event.target.checked ? DEFAULT_CUSTOM_BACKGROUND : 'transparent' })
          }
        />
        Custom background
      </label>
      {hasCustomBackground && (
        <input
          id="ma-style-background"
          type="color"
          value={style.background}
          onChange={(event) => setStyle({ background: event.target.value })}
        />
      )}
    </section>
  )
}
