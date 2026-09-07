// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { PRESETS, runAnimation, scrollProgress } from '../src/core/presets.js'
import { defaultScene, mergeScene } from '../src/core/scene.js'

const PRESET_KEYS = ['none', 'rotate-in', 'orbit', 'float', 'exploded-reveal', 'hover-tilt', 'scroll-rotate']

function expectFinitePose(pose) {
  for (const value of Object.values(pose)) {
    expect(Number.isFinite(value)).toBe(true)
  }
}

describe('PRESETS', () => {
  it('has exactly the seven spec\'d keys', () => {
    expect(Object.keys(PRESETS).sort()).toEqual([...PRESET_KEYS].sort())
  })

  it.each(PRESET_KEYS)('%s has a mode and a tick function', (key) => {
    const preset = PRESETS[key]
    expect(['timeline', 'pointer', 'scroll']).toContain(preset.mode)
    expect(typeof preset.tick).toBe('function')
  })

  it.each(PRESET_KEYS)('%s.tick(0/0.5/1, scene) returns a partial pose of finite numbers', (key) => {
    const scene = defaultScene()
    for (const t of [0, 0.5, 1]) {
      const partial = PRESETS[key].tick(t, scene)
      expect(typeof partial).toBe('object')
      expectFinitePose(partial)
    }
  })

  it('none makes no change', () => {
    const scene = defaultScene()
    expect(PRESETS.none.tick(0, scene)).toEqual({})
    expect(PRESETS.none.tick(1, scene)).toEqual({})
  })

  it('rotate-in animates rotateY from -90 into the scene\'s target rotateY', () => {
    const scene = mergeScene(defaultScene(), { pose: { rotateY: -25 } })
    expect(PRESETS['rotate-in'].tick(0, scene).rotateY).toBeCloseTo(-90)
    expect(PRESETS['rotate-in'].tick(1, scene).rotateY).toBeCloseTo(-25)
  })

  it('orbit sweeps rotateY through a full 360 turn from the scene rotateY', () => {
    const scene = mergeScene(defaultScene(), { pose: { rotateY: 10 } })
    expect(PRESETS.orbit.tick(0, scene).rotateY).toBeCloseTo(10)
    expect(PRESETS.orbit.tick(1, scene).rotateY).toBeCloseTo(370)
  })

  it('float oscillates translateY/rotateX around the base pose and returns to it at t=0 and t=1', () => {
    const scene = defaultScene()
    const start = PRESETS.float.tick(0, scene)
    const end = PRESETS.float.tick(1, scene)
    const mid = PRESETS.float.tick(0.25, scene)

    expect(start.translateY).toBeCloseTo(scene.pose.translateY)
    expect(end.translateY).toBeCloseTo(scene.pose.translateY)
    expect(mid.translateY).not.toBeCloseTo(scene.pose.translateY, 3)
  })

  it('exploded-reveal goes from fully exploded (1) to the scene\'s target explode, exactly, at t=1', () => {
    const scene = mergeScene(defaultScene(), { pose: { explode: 0.3 } })
    expect(PRESETS['exploded-reveal'].tick(0, scene).explode).toBeCloseTo(1)
    expect(PRESETS['exploded-reveal'].tick(1, scene).explode).toBe(scene.pose.explode)
  })

  it('hover-tilt maps pointer offset to a bounded rotateX/rotateY tilt', () => {
    const scene = defaultScene()
    const center = PRESETS['hover-tilt'].tick({ x: 0, y: 0 }, scene)
    const topRight = PRESETS['hover-tilt'].tick({ x: 1, y: -1 }, scene)

    expect(center.rotateX).toBeCloseTo(0)
    expect(center.rotateY).toBeCloseTo(0)
    expect(Math.abs(topRight.rotateX)).toBeLessThanOrEqual(15)
    expect(Math.abs(topRight.rotateY)).toBeLessThanOrEqual(15)
    expect(topRight.rotateY).toBeGreaterThan(0)
  })

  it('scroll-rotate maps scroll progress 0..1 onto rotateY -45..45', () => {
    const scene = defaultScene()
    expect(PRESETS['scroll-rotate'].tick(0, scene).rotateY).toBeCloseTo(-45)
    expect(PRESETS['scroll-rotate'].tick(0.5, scene).rotateY).toBeCloseTo(0)
    expect(PRESETS['scroll-rotate'].tick(1, scene).rotateY).toBeCloseTo(45)
  })
})

describe('scrollProgress', () => {
  const VIEWPORT = 800
  const HEIGHT = 400

  it('is 0 when the container top is exactly at the bottom of the viewport', () => {
    expect(scrollProgress({ top: VIEWPORT, height: HEIGHT }, VIEWPORT)).toBe(0)
  })

  it('is 1 when the container bottom has passed the top of the viewport', () => {
    expect(scrollProgress({ top: -HEIGHT, height: HEIGHT }, VIEWPORT)).toBe(1)
  })

  it('is 0.5 halfway through the container\'s travel across the viewport', () => {
    // travel span = viewport + height = 1200; half of that from the start
    // (top = 800) is top = 200.
    expect(scrollProgress({ top: 200, height: HEIGHT }, VIEWPORT)).toBeCloseTo(0.5)
  })

  it('increases monotonically as the container scrolls up the viewport', () => {
    const tops = [900, 700, 400, 100, -200, -500]
    const values = tops.map((top) => scrollProgress({ top, height: HEIGHT }, VIEWPORT))
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1])
    }
  })

  it('clamps to 0..1 outside the travel range', () => {
    expect(scrollProgress({ top: 5000, height: HEIGHT }, VIEWPORT)).toBe(0)
    expect(scrollProgress({ top: -5000, height: HEIGHT }, VIEWPORT)).toBe(1)
  })

  it('returns 0 rather than NaN for a zero-sized viewport and container', () => {
    expect(scrollProgress({ top: 0, height: 0 }, 0)).toBe(0)
  })
})

describe('runAnimation', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('drives a timeline-mode preset, calling applyPose with a full merged pose each tick', () => {
    let rafCb = null
    vi.stubGlobal('requestAnimationFrame', (cb) => {
      rafCb = cb
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    // Timeline's default clock is Date.now(); drive it deterministically:
    // one call in play() (t=1000), one in the frame callback (t=1500) ->
    // 500ms elapsed of a 1000ms duration = progress 0.5.
    vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(1500)

    const scene = mergeScene(defaultScene(), {
      pose: { rotateY: -25 },
      animation: { preset: 'rotate-in', duration: 1000, easing: 'linear', loop: false, autoplay: true },
    })
    const poses = []
    const controller = runAnimation(scene, (pose) => poses.push(pose))

    expect(typeof controller.stop).toBe('function')
    expect(rafCb).toBeInstanceOf(Function)

    rafCb() // simulate the queued animation frame firing
    expect(poses).toHaveLength(1)
    // full pose shape (every field from scene.pose), not just the touched one
    expect(Object.keys(poses[0]).sort()).toEqual(Object.keys(scene.pose).sort())
    // rotate-in at progress 0.5, linear, from -90 towards -25
    expect(poses[0].rotateY).toBeCloseTo(-57.5)
    expect(poses[0].explode).toBe(scene.pose.explode) // untouched fields pass through

    controller.stop()
  })

  it('falls back to the "none" preset for an unknown preset name without throwing', () => {
    vi.stubGlobal('requestAnimationFrame', () => 1)
    vi.stubGlobal('cancelAnimationFrame', () => {})

    const scene = mergeScene(defaultScene(), { animation: { preset: 'does-not-exist' } })
    const controller = runAnimation(scene, () => {})
    expect(() => controller.stop()).not.toThrow()
  })

  it('wires pointer mode to window pointermove and stops cleanly', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')

    const scene = mergeScene(defaultScene(), { animation: { preset: 'hover-tilt' } })
    const poses = []
    const controller = runAnimation(scene, (pose) => poses.push(pose))

    expect(addSpy).toHaveBeenCalledWith('pointermove', expect.any(Function))
    const handler = addSpy.mock.calls.find(([type]) => type === 'pointermove')[1]

    handler({ clientX: window.innerWidth, clientY: 0 })
    expect(poses).toHaveLength(1)
    // full pose shape, with the pointer-driven fields tilted and everything
    // else passed through from the scene's base pose
    expect(poses[0]).toMatchObject({ ...scene.pose, rotateX: 15, rotateY: 15 })

    controller.stop()
    expect(removeSpy).toHaveBeenCalledWith('pointermove', handler)
  })

  it('drives scroll mode from the container element\'s own position, not document scrollY', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')

    const container = document.createElement('div')
    // jsdom gives every element a zero rect; fake a real one that moves.
    let rect = { top: window.innerHeight, height: 400 }
    container.getBoundingClientRect = () => rect

    const scene = mergeScene(defaultScene(), { animation: { preset: 'scroll-rotate' } })
    const poses = []
    const controller = runAnimation(scene, (pose) => poses.push(pose), container)

    // handleScroll runs once at wiring time -> container fully below the fold
    // = progress 0 = rotateY -45.
    expect(poses).toHaveLength(1)
    expect(poses[0].rotateY).toBeCloseTo(-45)

    // Capture-phase listener: scroll events don't bubble, so a bubbling
    // listener would miss a scrollable ancestor entirely.
    expect(addSpy).toHaveBeenCalledWith('scroll', expect.any(Function), true)
    const handler = addSpy.mock.calls.find(([type]) => type === 'scroll')[1]

    rect = { top: -400, height: 400 } // scrolled fully past
    handler()
    expect(poses).toHaveLength(2)
    expect(poses[1].rotateY).toBeCloseTo(45)

    controller.stop()
    expect(removeSpy).toHaveBeenCalledWith('scroll', handler, true)
  })

  it('does not throw in scroll mode when no container is supplied', () => {
    const scene = mergeScene(defaultScene(), { animation: { preset: 'scroll-rotate' } })
    const poses = []
    const controller = runAnimation(scene, (pose) => poses.push(pose))
    expect(poses[0].rotateY).toBeCloseTo(-45)
    expect(() => controller.stop()).not.toThrow()
  })
})
