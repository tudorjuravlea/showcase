import { describe, it, expect, vi } from 'vitest'
import { Timeline, EASINGS } from '../src/core/timeline.js'

// Deterministic fake clock + rAF: `raf(cb)` queues `cb`, `tick(ms)` advances
// the fake clock and flushes exactly the callbacks queued so far (mirroring
// one animation frame). Each Timeline schedules its next frame from inside
// the callback, so calling `tick()` repeatedly drives successive frames.
function makeFakeClock(start = 0) {
  let time = start
  let queue = []
  return {
    now: () => time,
    raf: (cb) => {
      queue.push(cb)
      return queue.length
    },
    tick(ms) {
      time += ms
      const due = queue
      queue = []
      due.forEach((cb) => cb(time))
    },
    pendingFrames() {
      return queue.length
    },
  }
}

describe('EASINGS', () => {
  it('exposes the five named easing functions, each a no-op at the endpoints', () => {
    expect(Object.keys(EASINGS).sort()).toEqual(
      ['ease-in', 'ease-in-out', 'ease-out', 'linear', 'spring'].sort()
    )
    for (const fn of Object.values(EASINGS)) {
      expect(fn(0)).toBeCloseTo(0, 5)
      expect(fn(1)).toBeCloseTo(1, 5)
    }
  })

  it('linear is the identity function', () => {
    expect(EASINGS.linear(0.3)).toBeCloseTo(0.3)
  })

  it('spring overshoots past 1 before settling (approximated overshoot)', () => {
    const values = []
    for (let t = 0; t <= 1; t += 0.01) values.push(EASINGS.spring(t))
    expect(Math.max(...values)).toBeGreaterThan(1)
  })
})

describe('Timeline', () => {
  it('ticks with an eased 0..1 value across the duration, ending exactly at 1', () => {
    const clock = makeFakeClock()
    const ticks = []
    const timeline = new Timeline({
      duration: 1000,
      easing: 'linear',
      onTick: (t) => ticks.push(t),
      now: clock.now,
      raf: clock.raf,
    })

    timeline.play()
    clock.tick(250)
    clock.tick(250)
    clock.tick(500)

    expect(ticks).toEqual([0.25, 0.5, 1])
  })

  it('calls onDone exactly once when a non-looping timeline finishes', () => {
    const clock = makeFakeClock()
    const onDone = vi.fn()
    const timeline = new Timeline({
      duration: 1000,
      easing: 'linear',
      onTick: () => {},
      onDone,
      now: clock.now,
      raf: clock.raf,
    })

    timeline.play()
    clock.tick(1000)
    expect(onDone).toHaveBeenCalledTimes(1)

    // no further frames get scheduled once finished
    expect(clock.pendingFrames()).toBe(0)
  })

  it('loops: wraps back to 0 instead of stopping at 1, and keeps scheduling frames', () => {
    const clock = makeFakeClock()
    const onDone = vi.fn()
    const ticks = []
    const timeline = new Timeline({
      duration: 1000,
      easing: 'linear',
      loop: true,
      onTick: (t) => ticks.push(t),
      onDone,
      now: clock.now,
      raf: clock.raf,
    })

    timeline.play()
    clock.tick(1000) // exactly a full cycle -> wraps to 0
    clock.tick(500) // half way into the next cycle

    expect(ticks).toEqual([0, 0.5])
    expect(onDone).not.toHaveBeenCalled()
    expect(clock.pendingFrames()).toBe(1) // still scheduling more frames
  })

  it('seek() jumps to an eased value immediately, independent of play state', () => {
    const clock = makeFakeClock()
    const ticks = []
    const timeline = new Timeline({
      duration: 1000,
      easing: 'linear',
      onTick: (t) => ticks.push(t),
      now: clock.now,
      raf: clock.raf,
    })

    timeline.seek(0.5)
    expect(ticks).toEqual([0.5])

    // resuming playback continues on from the sought position
    timeline.play()
    clock.tick(250)
    expect(ticks).toEqual([0.5, 0.75])
  })

  it('seek() clamps out-of-range values to 0..1', () => {
    const clock = makeFakeClock()
    const ticks = []
    const timeline = new Timeline({
      duration: 1000,
      onTick: (t) => ticks.push(t),
      now: clock.now,
      raf: clock.raf,
    })

    timeline.seek(-1)
    timeline.seek(2)
    expect(ticks).toEqual([0, 1])
  })

  it('pause() stops scheduling further frames until play() resumes', () => {
    const clock = makeFakeClock()
    const ticks = []
    const timeline = new Timeline({
      duration: 1000,
      easing: 'linear',
      onTick: (t) => ticks.push(t),
      now: clock.now,
      raf: clock.raf,
    })

    timeline.play()
    clock.tick(300)
    timeline.pause()

    // time passing while paused must not move the timeline: the frame
    // already queued before pause() is invalidated (a no-op when flushed),
    // and no new frame gets scheduled behind it.
    clock.tick(400)
    expect(ticks).toEqual([0.3])
    expect(clock.pendingFrames()).toBe(0)

    timeline.play()
    clock.tick(200)
    expect(ticks).toEqual([0.3, 0.5])
  })

  it('destroy() cancels the timeline: a frame already queued before destroy is a no-op', () => {
    const clock = makeFakeClock()
    const ticks = []
    const timeline = new Timeline({
      duration: 1000,
      easing: 'linear',
      onTick: (t) => ticks.push(t),
      now: clock.now,
      raf: clock.raf,
    })

    timeline.play() // queues the first frame
    timeline.destroy()
    clock.tick(500) // flushes the frame that was queued before destroy

    expect(ticks).toEqual([])
  })

  it('destroy() prevents play() from doing anything afterwards', () => {
    const clock = makeFakeClock()
    const ticks = []
    const timeline = new Timeline({
      duration: 1000,
      onTick: (t) => ticks.push(t),
      now: clock.now,
      raf: clock.raf,
    })

    timeline.destroy()
    timeline.play()
    clock.tick(1000)

    expect(ticks).toEqual([])
  })

  it('applies non-linear easing to the emitted t value', () => {
    const clock = makeFakeClock()
    const ticks = []
    const timeline = new Timeline({
      duration: 1000,
      easing: 'ease-in',
      onTick: (t) => ticks.push(t),
      now: clock.now,
      raf: clock.raf,
    })

    timeline.play()
    clock.tick(500)

    // ease-in(0.5) = 0.5*0.5 = 0.25, not the raw 0.5
    expect(ticks[0]).toBeCloseTo(0.25)
  })
})
