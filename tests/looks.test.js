import { describe, it, expect } from 'vitest'
import { LOOKS, lookFrame, referenceCornerMelt, referenceCornerStart, referenceKeyframes, referenceSnapSpan } from '../src/showcase/looks.js'

const LOOK_KEYS = ['hero-drift', 'close-up-pan', 'orbit-loop', 'flat-lay-rise', 'hero-rise', 'auto-action', 'reference']

const SAMPLE_T = [0, 0.25, 0.5, 0.75, 1]

function expectFiniteFrame(frame) {
  expect(typeof frame.pose).toBe('object')
  expect(typeof frame.camera).toBe('object')
  for (const value of Object.values(frame.pose)) {
    expect(Number.isFinite(value)).toBe(true)
  }
  for (const value of Object.values(frame.camera)) {
    expect(Number.isFinite(value)).toBe(true)
  }
}

describe('LOOKS', () => {
  it('has exactly the seven spec\'d keys', () => {
    expect(Object.keys(LOOKS).sort()).toEqual([...LOOK_KEYS].sort())
  })

  it.each(LOOK_KEYS)('%s is a function', (key) => {
    expect(typeof LOOKS[key]).toBe('function')
  })

  it.each(LOOK_KEYS)('%s produces finite pose/camera values across t=0..1', (key) => {
    const ctx = { duration: 8, activity: [] }
    for (const t of SAMPLE_T) {
      expectFiniteFrame(lookFrame(key, t, ctx))
    }
  })

  it.each(LOOK_KEYS)('%s tolerates a missing ctx', (key) => {
    expectFiniteFrame(lookFrame(key, 0.5))
  })
})

describe('lookFrame', () => {
  it('falls back to hero-drift for an unknown look name', () => {
    const ctx = { duration: 8, activity: [] }
    for (const t of SAMPLE_T) {
      expect(lookFrame('not-a-real-look', t, ctx)).toEqual(lookFrame('hero-drift', t, ctx))
    }
  })
})

describe('hero-drift', () => {
  it('pushes in from a larger distance toward the hero distance', () => {
    const start = lookFrame('hero-drift', 0, { duration: 8 })
    const end = lookFrame('hero-drift', 1, { duration: 8 })
    expect(start.camera.distance).toBeGreaterThan(1)
    expect(end.camera.distance).toBeCloseTo(1, 5)
  })
})

describe('close-up-pan', () => {
  it('starts tight on the screen and pulls back to ~1 by t=1', () => {
    const start = lookFrame('close-up-pan', 0, { duration: 8 })
    const end = lookFrame('close-up-pan', 1, { duration: 8 })
    expect(start.camera.distance).toBeLessThan(0.5)
    expect(end.camera.distance).toBeCloseTo(1, 5)
  })

  it('pans the aim point back to center by t=1', () => {
    const end = lookFrame('close-up-pan', 1, { duration: 8 })
    expect(end.camera.targetU).toBeCloseTo(0.5, 5)
    expect(end.camera.targetV).toBeCloseTo(0.5, 5)
  })
})

describe('orbit-loop', () => {
  it('closes the loop: frame(0) ~= frame(1)', () => {
    const start = lookFrame('orbit-loop', 0, { duration: 8 })
    const end = lookFrame('orbit-loop', 1, { duration: 8 })
    expect(end.pose.rotateX).toBeCloseTo(start.pose.rotateX, 5)
    expect(end.pose.rotateY).toBeCloseTo(start.pose.rotateY, 5)
    expect(end.camera.driftX).toBeCloseTo(start.camera.driftX, 5)
    expect(end.camera.driftY).toBeCloseTo(start.camera.driftY, 5)
  })
})

describe('hero-rise', () => {
  it('starts below frame (large positive translateY) and settles to 0', () => {
    const start = lookFrame('hero-rise', 0, { duration: 8 })
    const end = lookFrame('hero-rise', 1, { duration: 8 })
    expect(start.pose.translateY).toBeGreaterThan(100)
    expect(end.pose.translateY).toBeCloseTo(0, 5)
  })

  it('zooms out from a closer starting distance to the hero distance', () => {
    const start = lookFrame('hero-rise', 0, { duration: 8 })
    const end = lookFrame('hero-rise', 1, { duration: 8 })
    expect(start.camera.distance).toBeLessThan(1)
    expect(end.camera.distance).toBeCloseTo(1, 5)
  })
})

describe('reference', () => {
  it('starts tilted at ~0.95 distance', () => {
    const start = lookFrame('reference', 0, { duration: 8 })
    expect(start.camera.distance).toBeCloseTo(0.95, 5)
    expect(start.pose.rotateY).toBeCloseTo(-14, 5)
  })

  it('ends on the whole screen and near-frontal, not loop-closed', () => {
    const start = lookFrame('reference', 0, { duration: 8 })
    const end = lookFrame('reference', 0.9, { duration: 8 })
    // Exactly the screenFit bound (DEFAULT_BOUNDS here), not past it.
    expect(end.camera.distance).toBeCloseTo(0.7007, 4)
    expect(Math.abs(end.pose.rotateX)).toBeLessThan(2)
    expect(Math.abs(end.pose.rotateY)).toBeLessThan(2)
    expect(end.camera.distance).not.toBeCloseTo(start.camera.distance, 1)
  })

  // The close-up beats used to sit at fixed distances (0.45/0.47/0.7) that
  // land in the forbidden zone — device too big for the frame, screen too
  // small to cover it — so the frame sliced the metal side band. They now
  // name the bound instead, resolved per device/aspect from ctx.bounds.
  describe('symbolic framing bounds', () => {
    // Same ordering distanceBounds always produces: bleed < screenFit < fit.
    const bounds = { fit: 0.8, screenFit: 0.62, bleed: 0.5 }
    const ctx = { duration: 8, bounds }

    it('resolves the close-up beats exactly onto the fit bound', () => {
      for (const t of [0.22, 0.36, 0.76]) {
        expect(lookFrame('reference', t, ctx).camera.distance).toBeCloseTo(bounds.fit, 10)
      }
    })

    it('keeps the mid pull-back just wider than fit', () => {
      const frame = lookFrame('reference', 0.48, ctx)
      expect(frame.camera.distance).toBeCloseTo(bounds.fit * 1.09, 10)
    })

    it('resolves the ending exactly ONTO the screenFit bound — no overshoot', () => {
      for (const t of [0.88, 0.94, 1]) {
        expect(lookFrame('reference', t, ctx).camera.distance).toBeCloseTo(bounds.screenFit, 10)
      }
      // ...and screenFit, not bleed: the ending shows the WHOLE screen.
      expect(lookFrame('reference', 1, ctx).camera.distance).toBeGreaterThan(bounds.bleed)
    })

    // The ending pose must be dead-frontal, not merely close: screenFit is
    // only a legal distance while the pose is within
    // FRONTAL_POSE_EPSILON_DEG (see constrainCameraDistance).
    it('holds the ending inside the frontal window, reaching exactly zero', () => {
      // FRONTAL_POSE_EPSILON_DEG is 1.5; the whole ending segment must stay
      // well inside it, and the held tail must be dead-on.
      for (const t of [0.88, 0.92, 0.94, 0.97, 0.99, 1]) {
        const { pose } = lookFrame('reference', t, ctx)
        expect(Math.abs(pose.rotateX)).toBeLessThan(1)
        expect(Math.abs(pose.rotateY)).toBeLessThan(1)
        expect(pose.rotateZ).toBe(0)
      }
      expect(Math.abs(lookFrame('reference', 0.99, ctx).pose.rotateY)).toBeLessThan(0.02)
      const last = lookFrame('reference', 1, ctx).pose
      expect(last.rotateX).toBe(0)
      expect(last.rotateY).toBe(0)
    })

    // At exact screen-fit there is no crop left to absorb a wobble: any
    // residual float would shift the screen (and the pose-dependent bound
    // with it) and reveal a frame edge, so the micro-float fades out across
    // the final segment.
    it('fades the micro-float to zero before the snap, not during it', () => {
      const wobble = (t) => {
        const { pose } = lookFrame('reference', t, ctx)
        return Math.abs(pose.rotateX) + Math.abs(pose.rotateY)
      }
      // The float has to be gone by cornerStart: from there on the authored
      // rotation is 0 and the pose must be dead-frontal for screenFit to be a
      // legal distance at all (constrainCameraDistance's frontal exemption).
      const cornerStart = referenceCornerStart(ctx.duration)
      expect(wobble(0.65)).toBeGreaterThan(0)
      expect(wobble(0.72)).toBeLessThan(wobble(0.65))
      expect(wobble(cornerStart)).toBe(0)
      for (const t of [cornerStart, 0.85, 0.9, 0.999, 1]) expect(wobble(t)).toBe(0)
    })

    it('holds the ending frame-for-frame still', () => {
      // Two adjacent output frames near the end (30fps, 20s) must be identical
      // to well under a pixel of screen motion.
      const a = lookFrame('reference', 598 / 600, ctx)
      const b = lookFrame('reference', 599 / 600, ctx)
      expect(b.camera.distance).toBeCloseTo(a.camera.distance, 10)
      expect(b.camera.targetV).toBeCloseTo(a.camera.targetV, 10)
      expect(b.pose.rotateX - a.pose.rotateX).toBeLessThan(1e-3)
      expect(b.pose.rotateY - a.pose.rotateY).toBeLessThan(1e-3)
    })

    it('never dwells in the forbidden zone between the two bounds', () => {
      // Only the two crossings (into and out of the close-ups) may traverse
      // it, and a look's raw output is snapped by the runtime anyway — this
      // pins that the *authored* beats resolve to legal framings. The ending
      // beats sit at screenFit, which is legal because their pose is frontal
      // (see constrainCameraDistance's exemption).
      for (const t of [0, 0.14, 0.22, 0.36, 0.48, 0.62, 0.76]) {
        const { distance } = lookFrame('reference', t, ctx).camera
        expect(distance >= bounds.fit || distance <= bounds.bleed).toBe(true)
      }
      for (const t of [0.88, 1]) {
        const { distance } = lookFrame('reference', t, ctx).camera
        expect(distance).toBeCloseTo(bounds.screenFit, 10)
      }
    })

    it('still interpolates literal distances between symbolic keyframes', () => {
      const wide = lookFrame('reference', 0.62, ctx).camera.distance
      expect(wide).toBeCloseTo(1.05, 10) // t=0.62 is authored as a plain number
      const between = lookFrame('reference', 0.55, ctx).camera.distance
      expect(between).toBeGreaterThan(bounds.fit * 1.09)
      expect(between).toBeLessThan(1.05)
    })

    // The ending's final push is a SNAP: a fixed span of REAL time whatever
    // the clip length, front-loaded, slightly past the bound and back.
    describe('ending snap', () => {
      const real = { fit: 0.7294, screenFit: 0.7007, bleed: 0.6547 }

      it('keeps the snap at ~0.6s of real time across clip lengths', () => {
        for (const duration of [10, 20, 39.267, 60, 120]) {
          expect(referenceSnapSpan(duration) * duration).toBeCloseTo(0.6, 6)
        }
        // Short clips hit the fraction-of-timeline ceiling, and even then the
        // snap stays well inside the 0.8s the brief allows.
        for (const duration of [6, 8]) {
          expect(referenceSnapSpan(duration) * duration).toBeLessThanOrEqual(0.8)
        }
      })

      it('orders every ending keyframe strictly after the t=0.76 beat', () => {
        for (const duration of [6, 8, 20, 39.267, 120]) {
          const keyframes = referenceKeyframes(duration)
          for (let i = 1; i < keyframes.length; i++) {
            expect(keyframes[i].t).toBeGreaterThan(keyframes[i - 1].t)
          }
          expect(keyframes[keyframes.length - 1].t).toBe(1)
        }
      })

      it('holds the pre-ending framing, then covers most of the move in the first 0.1s', () => {
        const duration = 39.267
        const c = { duration, bounds: real }
        const span = referenceSnapSpan(duration)
        const snapStart = 0.88 - span
        const at = (seconds) => lookFrame('reference', snapStart + seconds / duration, c).camera.distance
        // Held at `fit` right up to the snap (and for seconds before it).
        expect(at(-2)).toBeCloseTo(real.fit, 10)
        expect(at(0)).toBeCloseTo(real.fit, 10)
        // Decisive: 0.1s in, most of the fit -> screenFit move is already done.
        const moved = (real.fit - at(0.1)) / (real.fit - real.screenFit)
        expect(moved).toBeGreaterThan(0.8)
        // Landed and settled by +0.5s (within 0.5% of the bound), and exactly
        // on it by the end of the span.
        expect(Math.abs(at(0.5) - real.screenFit) / real.screenFit).toBeLessThan(0.005)
        expect(at(0.6)).toBeCloseTo(real.screenFit, 10)
      })

      it('overshoots past screenFit and settles back, without reaching bleed', () => {
        const duration = 39.267
        const c = { duration, bounds: real }
        const span = referenceSnapSpan(duration)
        const samples = []
        for (let i = 0; i <= 60; i++) samples.push(lookFrame('reference', 0.88 - span + (span * i) / 60, c).camera.distance)
        const deepest = Math.min(...samples)
        expect(deepest).toBeLessThan(real.screenFit) // past the bound...
        expect(deepest).toBeGreaterThan(real.bleed) // ...but inside the legal frontal band
        expect((real.screenFit - deepest) / real.screenFit).toBeCloseTo(0.015, 3)
        expect(samples[samples.length - 1]).toBeCloseTo(real.screenFit, 10)
      })

      it('keeps the corners rounded through the snap, then melts them AFTER landing (Tudor: disappear after, not before)', () => {
        const duration = 39.267
        const c = { duration, bounds: real }
        const snapStart = 0.88 - referenceSnapSpan(duration)
        const { meltStart, meltEnd } = referenceCornerMelt(duration)
        const corner = (t) => lookFrame('reference', t, c).screen.cornerScale
        // Rounded the whole way in — including the punch and the landed hold.
        for (const t of [0, 0.5, snapStart, (snapStart + 0.88) / 2, 0.88, meltStart]) {
          expect(corner(t)).toBe(1)
        }
        // The melt runs strictly after the landing...
        expect(meltStart).toBeGreaterThan(0.88)
        const mid = corner((meltStart + meltEnd) / 2)
        expect(mid).toBeGreaterThan(0)
        expect(mid).toBeLessThan(1)
        // ...and completes before the final hold, square to the end.
        expect(meltEnd).toBeLessThanOrEqual(0.96)
        for (const t of [meltEnd, 0.99, 1]) expect(corner(t)).toBe(0)
      })

      it('is the only look that drives screen state', () => {
        for (const key of LOOK_KEYS) {
          const frame = lookFrame(key, 0.95, { duration: 8, activity: [] })
          if (key === 'reference') expect(frame.screen).toEqual({ cornerScale: 0 })
          else expect(frame.screen).toBeUndefined()
        }
      })
    })

    it('falls back to sane phone-portrait bounds when ctx has none', () => {
      // The phone-portrait bounds the showcase pipeline actually resolves —
      // pixelSizeMode 'exact' against the real screen-aspect frame (1080x2352,
      // see bin/showcase.mjs's outputDimensions and glRenderer's
      // resolvePixelSize / distanceBounds).
      const real = { fit: 0.7294, screenFit: 0.7007, bleed: 0.6547 }
      for (const t of [0.22, 0.88, 1]) {
        const withBounds = lookFrame('reference', t, { duration: 8, bounds: real })
        const without = lookFrame('reference', t, { duration: 8 })
        expect(without.camera.distance).toBeCloseTo(withBounds.camera.distance, 2)
      }
    })
  })
})

describe('auto-action', () => {
  it('equals hero-drift when activity is empty', () => {
    for (const t of SAMPLE_T) {
      expect(lookFrame('auto-action', t, { duration: 8, activity: [] })).toEqual(
        lookFrame('hero-drift', t, { duration: 8, activity: [] })
      )
    }
  })

  it('equals hero-drift when ctx has no activity field at all', () => {
    expect(lookFrame('auto-action', 0.5, { duration: 8 })).toEqual(lookFrame('hero-drift', 0.5, { duration: 8 }))
  })

  it('targets a segment\'s (u, v, zoom) throughout its [t0, t1] window', () => {
    const ctx = { duration: 10, activity: [{ t0: 2, t1: 3, u: 0.75, v: 0.2, zoom: 0.42 }] }
    for (const t of [0.2, 0.25, 0.28, 0.3]) {
      const frame = lookFrame('auto-action', t, ctx)
      expect(frame.camera.targetU).toBeCloseTo(0.75, 5)
      expect(frame.camera.targetV).toBeCloseTo(0.2, 5)
      expect(frame.camera.distance).toBeCloseTo(0.42, 5)
    }
  })

  it('ends on full-device hero framing after the last segment', () => {
    const ctx = { duration: 10, activity: [{ t0: 2, t1: 3, u: 0.75, v: 0.2, zoom: 0.42 }] }
    const end = lookFrame('auto-action', 1, ctx)
    expect(end.camera.targetU).toBeCloseTo(0.5, 5)
    expect(end.camera.targetV).toBeCloseTo(0.5, 5)
    expect(end.camera.distance).toBeCloseTo(1, 5)
  })

  it('pulls back and rotates at the midpoint between two non-adjacent segments', () => {
    const ctx = {
      duration: 10,
      activity: [
        { t0: 1, t1: 2, u: 0.9, v: 0.1, zoom: 0.3 },
        { t0: 6, t1: 7, u: 0.1, v: 0.9, zoom: 0.3 },
      ],
    }
    // Gap is t=2 -> t=6, 40% of duration, well past the ~8% threshold.
    const midT = (2 + 6) / 2 / 10
    const midFrame = lookFrame('auto-action', midT, ctx)
    const plainDrift = lookFrame('hero-drift', midT, ctx)

    expect(midFrame.camera.distance).toBeGreaterThanOrEqual(0.8)
    expect(midFrame.camera.distance).toBeGreaterThan(0.3) // meaningfully wider than either segment's zoom
    expect(midFrame.pose.rotateY).not.toBeCloseTo(plainDrift.pose.rotateY, 1)
  })

  it('keeps a direct pan (no pull-back stop) between adjacent/touching segments', () => {
    const ctx = {
      duration: 10,
      activity: [
        { t0: 1, t1: 4, u: 0.9, v: 0.1, zoom: 0.3 },
        { t0: 4, t1: 6, u: 0.1, v: 0.9, zoom: 0.5 },
      ],
    }
    const midT = (4 + 4) / 2 / 10 // exactly the touching boundary
    const frame = lookFrame('auto-action', midT, ctx)
    // At the shared boundary the camera should sit at the segment values, not pulled back wide.
    expect(frame.camera.distance).toBeLessThan(0.6)

    // Sampling just past the boundary should still land on the second segment's target, not ease
    // through an inserted intermediate stop.
    const justAfter = lookFrame('auto-action', midT + 0.001, ctx)
    expect(justAfter.camera.targetU).toBeCloseTo(0.1, 1)
    expect(justAfter.camera.targetV).toBeCloseTo(0.9, 1)
  })

  it('opens on hero framing and eases in even when a segment starts at t=0', () => {
    const ctx = { duration: 10, activity: [{ t0: 0, t1: 3, u: 0.9, v: 0.1, zoom: 0.35 }] }
    const start = lookFrame('auto-action', 0, ctx)
    expect(start.camera.distance).toBeGreaterThanOrEqual(0.9)
    expect(start.camera.targetU).toBeCloseTo(0.5, 5)
    expect(start.camera.targetV).toBeCloseTo(0.5, 5)

    // ...and the reserved lead-in is an ease, not a cut: partway through it the
    // camera is already travelling toward the segment but hasn't arrived.
    const leadIn = lookFrame('auto-action', 0.04, ctx)
    expect(leadIn.camera.distance).toBeLessThan(start.camera.distance)
    expect(leadIn.camera.distance).toBeGreaterThan(0.35)
    expect(leadIn.camera.targetU).toBeGreaterThan(0.5)
    expect(leadIn.camera.targetU).toBeLessThan(0.9)
  })

  it('pulls back to a hero ending even when a segment runs to the very end', () => {
    const ctx = { duration: 10, activity: [{ t0: 7, t1: 10, u: 0.9, v: 0.1, zoom: 0.35 }] }
    const end = lookFrame('auto-action', 1, ctx)
    expect(end.camera.distance).toBeGreaterThanOrEqual(0.9)
    expect(end.camera.targetU).toBeCloseTo(0.5, 5)
    expect(end.camera.targetV).toBeCloseTo(0.5, 5)

    // The segment still gets its dwell — it's the tail that's reserved, and the
    // pull-back happens inside it rather than being skipped.
    const dwell = lookFrame('auto-action', 0.88, ctx)
    expect(dwell.camera.distance).toBeCloseTo(0.35, 5)
    expect(dwell.camera.targetU).toBeCloseTo(0.9, 5)
  })

  // Activity zooms are free reals (whatever fed ctx.activity chose them) —
  // nothing keeps one out of the lateral-fit forbidden zone the way the
  // reference look's authored keyframes are curated to. Without a clamp, a
  // dwell held at a midpoint-ish zoom is exactly the case the driver's
  // hysteresis can only slow down, not prevent — so autoAction snaps the
  // zoom itself away from the zone before it ever reaches a stop.
  it('snaps a segment zoom inside the forbidden zone to the nearer bound when bounds are given', () => {
    const bounds = { fit: 0.8, bleed: 0.5, uSpan: 1, vSpan: 1 }
    const midpointZoom = (bounds.fit + bounds.bleed) / 2
    const ctx = { duration: 10, activity: [{ t0: 2, t1: 3, u: 0.5, v: 0.5, zoom: midpointZoom }], bounds }
    const dwell = lookFrame('auto-action', 0.25, ctx)
    expect(dwell.camera.distance === bounds.fit || dwell.camera.distance === bounds.bleed).toBe(true)
  })

  it('leaves a segment zoom outside the forbidden zone untouched even with bounds', () => {
    const bounds = { fit: 0.8, bleed: 0.5, uSpan: 1, vSpan: 1 }
    const ctx = { duration: 10, activity: [{ t0: 2, t1: 3, u: 0.5, v: 0.5, zoom: 0.42 }], bounds }
    const dwell = lookFrame('auto-action', 0.25, ctx)
    expect(dwell.camera.distance).toBeCloseTo(0.42, 10)
  })

  it('handles multiple non-overlapping segments in order', () => {
    const ctx = {
      duration: 10,
      activity: [
        { t0: 6, t1: 7, u: 0.1, v: 0.9, zoom: 0.3 },
        { t0: 1, t1: 2, u: 0.9, v: 0.1, zoom: 0.5 },
      ],
    }
    const first = lookFrame('auto-action', 0.15, ctx)
    expect(first.camera.targetU).toBeCloseTo(0.9, 5)
    expect(first.camera.targetV).toBeCloseTo(0.1, 5)

    const second = lookFrame('auto-action', 0.65, ctx)
    expect(second.camera.targetU).toBeCloseTo(0.1, 5)
    expect(second.camera.targetV).toBeCloseTo(0.9, 5)
  })
})
