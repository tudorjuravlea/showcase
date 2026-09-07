import { useState } from 'react'
import { defaultScene, mergeScene, requiresCssRenderer } from '../core/scene.js'
import { initTheme } from './theme.js'
import Preview from './Preview.jsx'
import ContentPanel from './panels/ContentPanel.jsx'
import PosePanel from './panels/PosePanel.jsx'
import StylePanel from './panels/StylePanel.jsx'
import AnimationPanel from './panels/AnimationPanel.jsx'
import ExportPanel from './panels/ExportPanel.jsx'
import './app.css'

// Runs once at module load — before the first render — so the correct
// data-theme is on <html> before the editor chrome ever paints.
initTheme()

export default function App() {
  const [scene, setScene] = useState(defaultScene)
  // Bumped by the Animation panel's Play button; Preview watches this to
  // restart the current animation from t=0 without re-creating it.
  const [playToken, setPlayToken] = useState(0)

  function updateScene(patch) {
    setScene((prev) => {
      const merged = mergeScene(prev, patch)
      // Force the renderer back to css whenever the scene lands in a state
      // WebGL can't render (see requiresCssRenderer), however it got there.
      const forceCss = requiresCssRenderer(merged.content)
      return forceCss && merged.renderer !== 'css' ? mergeScene(merged, { renderer: 'css' }) : merged
    })
  }

  return (
    <div className="ma-app">
      <aside className="ma-panel-column ma-panel-column-left">
        <ContentPanel scene={scene} updateScene={updateScene} />
      </aside>
      <Preview scene={scene} updateScene={updateScene} playToken={playToken} />
      <aside className="ma-panel-column ma-panel-column-right">
        <PosePanel scene={scene} updateScene={updateScene} />
        <StylePanel scene={scene} updateScene={updateScene} />
        <AnimationPanel scene={scene} updateScene={updateScene} onPlay={() => setPlayToken((t) => t + 1)} />
        <ExportPanel scene={scene} />
      </aside>
    </div>
  )
}
