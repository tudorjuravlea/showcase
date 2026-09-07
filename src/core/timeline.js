// rAF-based tween engine. Interpolates a single 0..1 progress value over a
// duration, applying an easing curve, and hands the eased value to onTick.
// Must not import React — this module also runs inside exported standalone
// HTML files (see docs/superpowers/specs/2026-09-01-mockupanimate-design.md,
// "Animation engine").

const SPRING_C1 = 1.70158
const SPRING_C3 = SPRING_C1 + 1

export const EASINGS = {
  linear: (t) => t,
  'ease-in': (t) => t * t,
  'ease-out': (t) => 1 - (1 - t) * (1 - t),
  'ease-in-out': (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  // easeOutBack approximation: overshoots past 1 then settles back to 1.
  spring: (t) => 1 + SPRING_C3 * (t - 1) ** 3 + SPRING_C1 * (t - 1) ** 2,
}

function resolveEasing(easing) {
  if (typeof easing === 'function') return easing
  return EASINGS[easing] || EASINGS.linear
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value))
}

const defaultNow = () => Date.now()
const defaultRaf =
  typeof requestAnimationFrame === 'function'
    ? (cb) => requestAnimationFrame(cb)
    : (cb) => setTimeout(() => cb(defaultNow()), 16)

/**
 * @param {object} options
 * @param {number} options.duration - ms
 * @param {string|(t:number)=>number} [options.easing]
 * @param {boolean} [options.loop]
 * @param {(t: number) => void} [options.onTick] - called with the eased 0..1 value
 * @param {() => void} [options.onDone] - called once when a non-looping run finishes
 * @param {() => number} [options.now] - injectable clock, for deterministic tests
 * @param {(cb: (t: number) => void) => any} [options.raf] - injectable scheduler
 */
export class Timeline {
  constructor({ duration, easing = 'linear', loop = false, onTick = () => {}, onDone = () => {}, now, raf } = {}) {
    this.duration = duration
    this.loop = loop
    this.onTick = onTick
    this.onDone = onDone
    this._easingFn = resolveEasing(easing)
    this._now = now || defaultNow
    this._raf = raf || defaultRaf

    this._playing = false
    this._destroyed = false
    this._gen = 0
    this._startTime = 0
    this._elapsed = 0 // ms of progress accumulated across pauses/seeks
  }

  play() {
    if (this._destroyed || this._playing) return
    this._playing = true
    this._startTime = this._now() - this._elapsed
    this._scheduleFrame()
  }

  pause() {
    if (!this._playing) return
    this._elapsed = this._now() - this._startTime
    this._playing = false
    this._gen += 1 // invalidate any frame already queued
  }

  seek(t) {
    const clamped = clamp01(t)
    this._elapsed = clamped * this.duration
    if (this._playing) {
      this._startTime = this._now() - this._elapsed
    }
    this.onTick(this._easingFn(clamped))
  }

  destroy() {
    this._destroyed = true
    this._playing = false
    this._gen += 1
  }

  _scheduleFrame() {
    const gen = this._gen
    this._raf(() => this._onFrame(gen))
  }

  _onFrame(gen) {
    if (this._destroyed || !this._playing || gen !== this._gen) return

    const elapsed = this._now() - this._startTime
    const rawProgress = this.duration > 0 ? elapsed / this.duration : 1

    if (rawProgress >= 1) {
      if (this.loop) {
        const wrapped = this.duration > 0 ? (elapsed % this.duration) / this.duration : 0
        this._startTime = this._now() - wrapped * this.duration
        this.onTick(this._easingFn(wrapped))
        this._scheduleFrame()
        return
      }

      this._elapsed = this.duration
      this._playing = false
      this.onTick(this._easingFn(1))
      this.onDone()
      return
    }

    this.onTick(this._easingFn(rawProgress))
    this._scheduleFrame()
  }
}
