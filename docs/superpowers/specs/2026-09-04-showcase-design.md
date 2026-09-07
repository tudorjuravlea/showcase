# Showcase — Design Spec (headless cinematic mockup videos + hero HTML)

Date: 2026-09-04. Approved by Tudor ("build it smart, as economically and cheaply as possible").
Builds on v1/v2 specs; editor app untouched. Reference look: gold phone floating on
black, live app on screen, slow float/rotation, camera pushes into on-screen action,
pulls back, rotates to next action (modeled on a reference clip).

## Deliverable

One CLI + one Claude skill. "showcase <file>" → MP4 (or self-contained HTML hero)
of the file's content playing on a realistic device in a dark cinematic scene.

## Components

### 1. Renderer extensions (src/render/webgl/glRenderer.js)

- **Video content:** scene.content.type "video": the DRIVER owns decoding; renderer
  accepts an external source canvas — new option/method `setScreenSource(canvas)`
  (or content.src as canvas) rendered as CanvasTexture, `texture.needsUpdate` on
  a new `updateScreen()` call. Editor never uses this; no UI work.
- **Camera rig:** new `setCamera({distance=1, targetU=0.5, targetV=0.5, driftX=0, driftY=0})`
  — distance is a dolly multiplier on the default framing (0.35 ≈ close-up);
  targetU/V aim the camera + lookAt at a point on the screen plane (0..1 UV);
  driftX/Y small world-space offsets for parallax drift. Smoothly composable with
  setPose (device pose unchanged in meaning).
- **Cinematic scene option:** render(scene) with scene.style.scene === "showcase":
  pure black background, stronger key/rim light so the metallic bezel catches
  highlights, screen emissive slightly boosted, soft contact shadow retained.
  Existing default scene unchanged.

### 2. Choreography (src/showcase/looks.js — pure, no DOM)

`LOOKS[name](t, ctx) => {pose, camera}` with easing inside; ctx = {duration,
activity?} where activity = [{t0,t1,u,v,zoom}] segments.
- hero-drift (default for images): 3/4 tilt, slow float + slight rotation, gentle
  push-in then settle.
- close-up-pan: start tight on a screen corner, slow pull-back + pan to full hero.
- orbit-loop: seamless slow orbit, loopable (t=0 pose == t=1 pose).
- flat-lay-rise: flat under overhead camera, rises/tilts to hero angle.
- hero-rise: device enters from bottom of frame, zoom out, settle to hero.
- auto-action (default for videos): consumes ctx.activity; for each segment ease
  camera to (u,v,zoom≈0.4), dwell, pull back + rotate slightly en route to next;
  ends on full-device hero. Falls back to hero-drift when activity is empty.

### 3. Activity analysis (scripts/analyze-activity.mjs — Node + ffmpeg)

Extract grayscale frames at ~4fps, 64px wide; diff consecutive frames on an 8×16
grid; per ~1.5-2s window compute change centroid (u,v) + spread → zoom; drop
low-energy windows; merge adjacent similar segments; output JSON segments
[{t0,t1,u,v,zoom}]. Pure functions unit-testable on synthetic arrays; ffmpeg
invoked via child_process (ffmpeg is on PATH — required, error clearly if missing).

### 4. Showcase runtime (showcase.html + src/showcase/runtime.js)

Loads a config (device, look, content, size, duration) from query/injected JSON.
- **Headless mode:** exposes `window.__showcase.init(cfg)` and `seek(t)` →
  Promise resolving AFTER content-video frame at time map(t) is drawn to the
  screen canvas and the GL frame is rendered (video seek via
  requestVideoFrameCallback/seeked event; content time = t*contentDuration,
  looping if output duration > content duration).
- **Live mode (HTML export):** plays intro look once, then idle: gentle float
  loop + soft hover-follow (pointer position eases device rotation ±6°,
  spring-smoothed; touch devices just float). Content video plays muted/loop/
  autoplay/playsinline.
- Built as a separate vite entry (showcase.html) so the CLI can load dist or dev.

### 5. CLI (bin/showcase.mjs, npm script "showcase")

`node bin/showcase.mjs <input> [--device phone|tablet|laptop|browser]
[--look auto|hero-drift|close-up-pan|orbit-loop|flat-lay-rise|hero-rise]
[--duration Ns] [--fps 30] [--size 1080] [--out path] [--html]`
- Probe input via ffprobe (video) / image size: aspect → device orientation;
  duration default = content duration clamped 6-30s (images: 10s).
- look default: auto-action for video, hero-drift for image.
- MP4: launch Playwright chromium (dep already in repo), load showcase page
  (vite build once → dist, file:// or preview server), init cfg, loop frames:
  seek(t_i) → screenshot of the canvas element → pipe PNGs to ffmpeg
  (libx264, yuv420p, size-fit content aspect, default height 1920 for portrait /
  width 1920 for landscape at --size 1080 ≙ short side). Progress on stderr.
- HTML: emit single self-contained file — runtime IIFE (new vite lib entry
  showcase-runtime) + config + content video embedded as data URI (warn >25MB)
  — intro look + idle float/hover-follow. No network requests.

### 6. Claude skill (~/.claude/skills/showcase/SKILL.md)

Triggers: "showcase this", "make a video of <file>", a dropped recording/
prototype export. Instructions: resolve the input file, pick defaults per this
spec, run `npm run -s showcase -- <args>` in the MockupAnimate repo, send the
resulting file to the user (SendUserFile), offer look/device variants. Document
flags. Keep the skill thin — the CLI holds the logic.

## Economy constraints (binding)

- No new runtime deps beyond what exists (three, gifenc, mp4-muxer) except none
  needed: CLI uses Playwright (present) + system ffmpeg. No React outside src/app.
- Editor untouched except exports of shared modules.
- Tests: unit-test pure logic (looks keyframes, activity segmentation, CLI arg/
  fit math); ONE e2e smoke per output kind (short MP4 from the reference .mov
  fixture trimmed to ~4s; HTML export opens + canvas animates). No new matrix.
- Fixture: a local reference screen recording —
  copy a 4s trim into e2e/fixtures/showcase-sample.mp4 (re-encode small).
  *Superseded 2026-09-06: the committed fixture is fully synthetic (generated
  with ffmpeg lavfi, no recorded footage) — see e2e/fixtures/README.md.*

## Acceptance (final review = visual judgment against reference frames)

- MP4 from the reference recording: dark scene, device readable, content sharp
  and playing in sync, camera visits action regions then pulls back; no blank
  or frozen frames; ends on a hero shot.
- HTML export: opens offline, floats, follows mouse softly, video loops.
- CLI usable end-to-end by the skill with only a file path.
