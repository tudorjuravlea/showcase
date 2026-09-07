# Lessons Learned (v1 to showcase, 2026-09-01 to 2026-09-06)

Technical lessons from building this project, written for whoever works on it
next (including a future session). Project history lives in git; this records
what the history alone doesn't teach.

## Rendering / 3D

- **Green tests prove almost nothing about pixels.** The Photoreal renderer
  shipped through 104 green tests while rendering a blank slab
  (black-multiplied screen texture, body occluding the screen, inverted
  rotation axes). Every renderer change needs at least one pixel-truth
  assertion (readback plus color-share) and a human look at rendered frames.
  The matrix e2e now does this; keep it that way.
- **CSS 3D and Three.js do not share handedness.** CSS Y points down, THREE Y
  up: rotateX/rotateZ negate between them, rotateY doesn't. This bit us twice
  (device pose, laptop lid). The sign conventions are unit-tested
  (`poseToEuler`, `lidRotationX`); extend those tests before touching any
  rotation math.
- **`MeshBasicMaterial` multiplies `map` by `color`.** A black base color
  renders any texture black. White is the passthrough.
- **CSS `filter` on an ancestor flattens `preserve-3d`.** Drop shadows must
  live on a wrapper outside the 3D subtree (`.ma-shadow-wrap`).
- **Inline pixel width/height plus CSS `max-*` means per-axis clamping, which
  means stretched content.** For scalable canvases, set `aspect-ratio` from
  the buffer dims and leave width/height auto. Assert proportionality in
  tests, not just containment.

## Deterministic media pipeline

- **Seek-driven rendering beats wall-clock recording everywhere.**
  Frame-stepping (`seek(t)`, then pose, render, capture) gives byte-identical
  MP4s across runs and survives slow machines. Anything wall-clock (the old
  canvas-diff e2e, exported intro timing) eventually flakes under load. The
  fix is always to make the test event-driven, not to widen timeouts.
- **Texture readiness is a contract, not a hope.** `render()` returns a
  promise resolved by the actual texture-load callback, and media export
  awaits it. Without that, frame 0 of every GIF/MP4 is black.
- **Units at module boundaries need a stated convention.** The activity
  analyzer emitted seconds; a consumer normalized to 0..1; the look divided
  by duration again, and camera choreography silently collapsed. When two
  pure modules exchange time values, the contract test must pin the units
  (ours now does).

## Cinematography rules are geometry, not taste

- The reference video's "never side-cropped" rule became a computable
  constraint: camera distance is legal only outside (bleed, fit), where `fit`
  means the device is fully inside the frame laterally and `bleed` means the
  screen covers the frame. Enforced per frame in the driver, with hysteresis
  (6% of the gap) so held zooms near the boundary can't strobe. Any new look
  inherits the rule for free. Keep the constraint in the driver, keep looks
  pure.
- rotateX foreshortening widens the projected device; bounds computed from
  the unrotated width alone still slice the band. Bounds are pose-dependent.
- A fixed float amplitude reads about 1/distance larger as the camera pushes
  in. Scale ambient wobble by camera distance or the ending swims.

## Exported HTML must assume a hostile embed

- Sandboxed previews block autoplay (and sometimes scripts). Layered
  fallbacks: a static poster in plain markup (hidden by the runtime only
  after a real frame is drawn), a play-button overlay on `play()` rejection,
  full animation otherwise. `play().catch(() => {})` is a bug pattern; a
  rejection always needs a visible fallback.
- The embedding viewport is never the authored resolution. The canvas buffer
  stays full-res; on-page size scales to fit with preserved aspect ratio.

## Process (what actually caught the bugs)

- Fresh implementer per task, an independent reviewer gate, and one
  adversarial whole-branch review at the end. The final reviews found the
  only Critical bugs of every phase, always things per-task gates
  structurally couldn't see (cross-renderer parity, real-input behavior,
  end-to-end camera trajectories). Budget for that final review; it
  out-earned its cost every time.
- Verify on the real input, not just fixtures. The HEVC decode failure, the
  one-segment activity collapse, and the side-cropping were all invisible on
  the clean little fixture and obvious on the actual recording.
- When a reviewer and an implementer disagree on something visual, measure it
  (matrix angles, projected widths, pixel shares). Both sides being "sure"
  from screenshots produced one false alarm and one real bug; numbers settled
  both.

## Session 2 additions (2026-09-06, the showcase refinement iterations)

- **The output frame is a design decision, not a container.** Three
  successive reframings (16:9-canonical, then exact-size canvas, then
  screen-aspect frame) each fixed a visible defect the previous shape merely
  hid: background pillars were invisible on black and glaring on brand
  yellow. When a background color option lands, re-verify every compositing
  assumption black was hiding.
- **Thickness must READ, not just exist.** A 2.6x band still looked like
  paper because a sharp 90-degree extrusion catches no light. What sells
  depth: chamfered edges drawing bright rim lines, side buttons breaking the
  silhouette, and a polished band material. Geometry that is correct but
  unlit is invisible.
- **"Washed out" is almost never one bug.** The screen color loss decomposed
  into five measured causes (glare veil, boost clipping, Chromium
  tone-mapping HDR PQ input, untagged BT.601 encode, double tone-map from
  surviving HDR metadata). Diagnose by pixel-sampling source vs output at the
  same content time; fix causes in order of measured contribution; add no
  cosmetic grading until fidelity is proven (a 17.7% to 1.5% delta needed
  zero taste).
- **Two-state constraints make some transitions cuts, not eases.** The
  fit-to-screenFit step cannot be interpolated (the between-zone is
  forbidden), so the choreography must own the cut: bury it inside a fast
  punch where it reads as intent. Naming the legal states symbolically
  ('fit', 'screen-fit') and resolving per device kept every retune a
  one-line change.
- **Ordering is meaning.** Snap-then-melt and melt-then-snap are different
  stories with identical endpoints. Choreography changes need the sequence
  stated, not just the states.
- **ffmpeg seek semantics matter in tests.** `-ss` before `-i` snaps to
  keyframes (measured the wrong frame), and seeking past the last frame's
  PTS decodes zero bytes (flaky "ending" assertions). Sample
  `duration - 1.5/fps` with output-side seeking.
- **Time-capped choreography must respect the last rendered frame.** A melt
  capped at t=0.985 never completes on a 4s/12fps clip whose final frame
  sits at t=0.98.
