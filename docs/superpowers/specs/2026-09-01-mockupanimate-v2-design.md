# MockupAnimate v2 — Design Spec (Realism + Media Export + Theming)

Date: 2026-09-01
Status: Approved by Tudor (chat). Builds on 2026-09-01-mockupanimate-design.md; that spec remains binding except where amended here.

## 1. Volumetric CSS devices

Problem: CSS devices are flat planes — no visible thickness when rotated; the
laptop reads as a squashed slab because the lid mapping and base model are
wrong.

Requirements:
- Phone/tablet/browser: the body renders as a true 3D box — front face,
  back face (translateZ(-thickness)), and edge walls around the perimeter.
  Implementation approach is the renderer's choice (4 wall quads for the
  straight segments + shaded stacked-layer "extrusion" for rounded corners,
  or a stacked-copies extrusion of the whole rounded body) but rotation
  around any axis must show shaded side surfaces, never a paper edge.
  Device thickness per device in DEVICES (new `thickness` field, abstract
  units consistent with existing dims; phone thinnest, tablet slightly
  thicker, laptop base thickest).
- Edge shading: side faces darker than the front (fixed pseudo-lighting),
  back face darkest. Screen stays inset in the front face.
- Laptop rework: base is a foreshortened slab lying flat (rotateX ≈ -90°
  relative to the lid plane), extending toward the viewer, with a subtle
  keyboard-deck texture (CSS gradient rows are enough) and front lip. The
  lid rises from the hinge line; lidAngle 110° must read as a nearly
  upright screen tilted ~20° back. lidAngle 0 = closed (lid flat on base),
  90 = vertical, 130 = max. Screen content lives in the lid's front face.
- Explode still separates the layer stack; the box walls belong to the
  body layer and explode with it.
- The default scene pose must look good out of the box: apply a subtle
  default rotation for laptop (e.g. rotateX 12°) so the base is visible —
  editor-only default via defaultScene() per device is NOT required; keep
  scene defaults unchanged, but the laptop must look correct at rotateX 0
  (straight-on: thin base edge + upright lid) and impressive when rotated.
- WebGL laptop must match the corrected CSS semantics (base flat, lid
  rising; same lidAngle meaning). Existing GL sign conventions were
  verified in v1 — only adjust if the CSS rework changes the meaning.

## 2. WebGL browser-window device

- The browser device becomes supported in the GL renderer: thin rounded
  slab; the screen texture is composed on an offscreen canvas — chrome bar
  (traffic dots + URL pill, generic/unbranded) drawn above the content
  image — then applied as the screen texture. UnsupportedDeviceError goes
  away; editor stops forcing css for browser device (url content still
  forces css).

## 3. Media export (stills + animation)

Export menu replaces the single button: HTML (existing), PNG, JPG, WebP,
GIF, MP4 (WebM fallback).

- All media exports render through the GL renderer offscreen (fresh
  instance in a hidden container), regardless of the editor's current
  renderer toggle, because canvases can be captured and DOM cannot.
  Requires content.type === "image": for url content, media options are
  disabled with a notice ("media export needs an image — browsers can't
  capture cross-origin iframes").
- Stills: render at the chosen resolution scale (1×/2×/3× of a 1200×900
  base stage), same-frame readback (preserveDrawingBuffer or render-then-
  toBlob in one frame). PNG lossless; JPG quality 0.92 on a solid
  background (style.background or white — JPG has no alpha); WebP quality
  0.92 (alpha preserved when background transparent).
- Animation: deterministic frame stepping — for each output frame t_i,
  seek the preset's timeline (tick(t_i)) → setPose → render → capture.
  Never wall-clock recording. Presets with mode pointer (hover-tilt) get a
  synthetic pointer orbit sweep; scroll-rotate maps t 0→1 to scroll
  progress; "none" exports are stills-only (animation options disabled).
- MP4: WebCodecs VideoEncoder (avc) + mp4-muxer (MIT dep), default output
  1920×1080-fit 30fps, duration = scene.animation.duration (loop presets:
  exactly one loop). If WebCodecs/avc unavailable → automatic WebM fallback
  via MediaRecorder on a canvas replayed in real time, with a toast noting
  the fallback.
- GIF: gifenc (MIT dep), default 720p-fit, 20fps, 256-color quantization.
- Export UI: a small dropdown/panel on the Export button: format choice,
  scale (stills) or size preset (video/gif), progress bar during encode
  (frame N/M), cancel. Files download as mockup-<device>-<preset>.<ext>.
- New deps allowed: gifenc, mp4-muxer (editor-only; NOT in export HTML
  runtimes).

## 4. Theming: light mode + toggle

- All editor chrome colors move to CSS custom properties with two palettes:
  dark (current) and a clean light theme (light gray panels, white stage,
  visible dot-grid, accessible contrast for labels/sliders).
- Toggle in the top bar (where Photoreal lives): three-state
  dark / light / auto (auto = prefers-color-scheme, live-updates on OS
  change). Persisted in localStorage (`ma-theme`); default auto.
- Theme affects the editor UI only, not the scene/export output
  (style.background governs those).

## Out of scope

Server-side rendering, batch export, per-frame custom easing curves,
audio in MP4, Safari-specific MP4 fallbacks beyond WebM.

## Verification

- Playwright: laptop straight-on shows upright lid (screen area pixel-
  dominant vs v1's squashed slab — pixel assertions in GL; DOM geometry
  assertions in CSS: lid element's bounding box taller than wide for
  phone-like content, base box present); rotateY 35° on phone shows side
  wall elements; media export produces a non-empty PNG/JPG/WebP blob with
  correct magic bytes and plausible dimensions; GIF export produces
  GIF89a bytes with >1 frame; MP4 test asserts blob type/size (encode a
  short 10-frame clip in-test); theme toggle flips a data-theme attribute
  and persists across reload; auto follows emulated prefers-color-scheme.
- Vitest: DEVICES thickness fields; frame-timing math (fps/duration →
  frame count, t_i sequence); texture-composition helper (browser chrome)
  pure-math parts; theme resolution logic (auto/dark/light → applied).
