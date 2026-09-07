export default function PosePanel({ scene, updateScene }) {
  const { pose } = scene

  function setPose(patch) {
    updateScene({ pose: patch })
  }

  return (
    <section className="ma-panel ma-pose-panel">
      <h2>Pose</h2>

      <label htmlFor="ma-rotateX">Rotate X ({pose.rotateX}°)</label>
      <input
        id="ma-rotateX"
        type="range"
        min={-60}
        max={60}
        value={pose.rotateX}
        onChange={(event) => setPose({ rotateX: Number(event.target.value) })}
      />

      <label htmlFor="ma-rotateY">Rotate Y ({pose.rotateY}°)</label>
      <input
        id="ma-rotateY"
        type="range"
        min={-60}
        max={60}
        value={pose.rotateY}
        onChange={(event) => setPose({ rotateY: Number(event.target.value) })}
      />

      <label htmlFor="ma-rotateZ">Rotate Z ({pose.rotateZ}°)</label>
      <input
        id="ma-rotateZ"
        type="range"
        min={-60}
        max={60}
        value={pose.rotateZ}
        onChange={(event) => setPose({ rotateZ: Number(event.target.value) })}
      />

      <label htmlFor="ma-scale">Scale ({pose.scale.toFixed(2)})</label>
      <input
        id="ma-scale"
        type="range"
        min={0.5}
        max={1.5}
        step={0.01}
        value={pose.scale}
        onChange={(event) => setPose({ scale: Number(event.target.value) })}
      />

      <label htmlFor="ma-explode">Explode ({pose.explode.toFixed(2)})</label>
      <input
        id="ma-explode"
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={pose.explode}
        onChange={(event) => setPose({ explode: Number(event.target.value) })}
      />

      {scene.device === 'laptop' && (
        <>
          <label htmlFor="ma-lidAngle">Lid angle ({pose.lidAngle}°)</label>
          <input
            id="ma-lidAngle"
            type="range"
            min={0}
            max={130}
            value={pose.lidAngle}
            onChange={(event) => setPose({ lidAngle: Number(event.target.value) })}
          />
        </>
      )}
    </section>
  )
}
