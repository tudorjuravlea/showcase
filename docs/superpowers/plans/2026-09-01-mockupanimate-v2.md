# MockupAnimate v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Volumetric/realistic devices (CSS laptop rework included), media export (PNG/JPG/WebP/GIF/MP4), and light/dark/auto theming.

**Architecture:** Extends v1's one-scene/two-renderer design. CSS devices gain box geometry; GL gains the browser device via composed screen textures; a new `src/export/media.js` renders deterministic frames through an offscreen GL renderer and encodes via canvas APIs + gifenc + mp4-muxer; theming is CSS-custom-property palettes keyed by a data-theme attribute.

**Tech Stack:** existing (Vite, React 18, Three.js, Vitest, Playwright) + gifenc + mp4-muxer (editor-only deps).

**Spec:** docs/superpowers/specs/2026-09-01-mockupanimate-v2-design.md (binding; v1 spec still applies where not amended)

## Global Constraints

- No React in src/core/*, src/render/*, export runtimes; gifenc/mp4-muxer must NOT enter the exported-HTML runtime bundles.
- Media export requires content.type === "image"; url content disables media options with a notice.
- Generic/unbranded devices. All suites green before each commit. Scene spec field names unchanged; DEVICES gains `thickness`.
- Defaults: MP4 1920×1080-fit 30fps; GIF 720p-fit 20fps; stills scale 1×/2×/3× of 1200×900 stage.
- Theme is editor-only (data-theme on document root; localStorage key `ma-theme`; states dark|light|auto, default auto).

## File Structure

```
src/core/devices.js            — add thickness per device
src/render/css/cssRenderer.js  — box geometry builders, laptop rework
src/render/css/device.css      — wall/edge shading, laptop base/keyboard styles
src/render/webgl/glRenderer.js — browser device support, composed chrome texture
src/render/webgl/chromeTexture.js — compose chrome bar + content image on offscreen canvas (pure-ish, testable layout math exported)
src/export/media.js            — captureStill(scene, opts), captureAnimation(scene, opts, onProgress) → Blob; frame-timing helpers (pure, exported)
src/app/panels/ExportPanel.jsx — format menu, size/scale, progress, cancel (replaces the single Export button UI; HTML path reuses exporter.js)
src/app/theme.js               — resolveTheme(setting, systemPrefersDark), applyTheme(); no React
src/app/App.jsx                — theme toggle in top bar; wire ExportPanel
src/app/app.css                — palettes as custom properties (dark + light)
tests/: devices, media-timing, chrome-texture, theme unit tests
e2e/: realism assertions, media-export.spec.js, theme.spec.js
```

---

### Task 1: Volumetric CSS devices + laptop rework

**Files:** Modify src/core/devices.js (+thickness: phone 8, tablet 10, laptop base 14, browser 6 — abstract units, same scale as width/height), src/render/css/cssRenderer.js, src/render/css/device.css, tests/devices.test.js. Modify e2e/editor.spec.js or add e2e/realism.spec.js.

**Interfaces:** No public API changes; createCssRenderer contract unchanged. DEVICES[d].thickness consumed by both renderers (Task follow-ons) — name it exactly `thickness`.

- [ ] Add thickness to DEVICES + unit tests (present, positive, laptop > phone).
- [ ] Body box geometry: front face (existing body), back face at translateZ(-thickness), edge walls (top/bottom/left/right quads sized by thickness, plus corner treatment so rotation never shows a paper edge; shaded darker via CSS). All inside the body layer so explode moves the whole box.
- [ ] Laptop rework per spec §1: flat foreshortened base (rotateX(-90°)-family transform from the device plane, extending toward viewer, with thickness walls + keyboard-deck gradient + front lip), hinge line at base rear, lid with box thickness rising from hinge; lidAngle 0=closed/90=vertical/110=default ~20° back tilt; screen in lid front face. Verify GL laptop still matches semantics (adjust glRenderer lidRotationX only if meaning changed — document either way).
- [ ] e2e: phone at rotateY 35° exposes side-wall elements (assert wall elements exist and have nonzero rendered size); laptop straight-on: lid bounding box taller than half its width and base element present below screen; laptop at rotateX 15° shows keyboard deck. Update any v1 selectors broken by restructure.
- [ ] Full suites green (fix matrix screenshots expectations if pixel assertions shift); commit "feat: volumetric CSS devices + laptop rework".

### Task 2: WebGL browser device via composed chrome texture

**Files:** Create src/render/webgl/chromeTexture.js, modify src/render/webgl/glRenderer.js, src/app/App.jsx + Preview.jsx (stop forcing css for browser device; url content still forces css), tests/chrome-texture.test.js, e2e updates (matrix gains browser×webgl rows).

**Interfaces:** `composeChromeTexture(image, {width, height, dpr}) => HTMLCanvasElement` and exported pure helper `chromeLayout(width, height) => {barHeight, dots:[{x,y,r}...], pill:{x,y,w,h}}` (unit-testable). glRenderer renders browser as thin rounded slab, screen texture = composed canvas.

- [ ] chromeLayout + tests (bar proportional to height, three dots, pill inside bar).
- [ ] composeChromeTexture draws bar + dots + pill + content image (cover-fit below bar) on canvas; glRenderer uses CanvasTexture for browser device; remove UnsupportedDeviceError path for browser; keep it for genuinely unknown devices.
- [ ] Editor: Photoreal toggle enabled for browser device with image content; matrix e2e extended (browser-webgl × 3 presets, pixel-truth red-share assertion like phone's).
- [ ] Suites green; commit "feat: WebGL browser device".

### Task 3: Media export (PNG/JPG/WebP/GIF/MP4/WebM) + Export panel

**Files:** Create src/export/media.js, src/app/panels/ExportPanel.jsx, tests/media-timing.test.js, e2e/media-export.spec.js. Modify src/app/App.jsx, package.json (gifenc, mp4-muxer).

**Interfaces:**
- media.js exports: `frameTimes(durationMs, fps) => number[]` (t values 0..1 inclusive of both ends), `fitSize(stageW, stageH, maxW, maxH) => {w, h}` (pure, tested); `captureStill(scene, {format: "png"|"jpeg"|"webp", scale: 1|2|3, background}) => Promise<Blob>`; `captureAnimation(scene, {format: "gif"|"mp4", fps, maxW, maxH, onProgress(done, total), signal}) => Promise<{blob, ext}>` — MP4 falls back to WebM ({ext:"webm"}) when WebCodecs avc unsupported.
- Rendering: offscreen container div (position fixed, off-viewport), fresh createGlRenderer, render(scene with renderer forced webgl semantics), for animation: preset tick(t_i) → setPose → captureFrame same-frame. hover-tilt: synthetic pointer sweep tick({x:cos, y:sin} orbit); scroll-rotate: t = scroll progress; none → stills only.
- JPG: composite onto background (style.background !== "transparent" ? it : "#ffffff").

- [ ] TDD frameTimes/fitSize (30fps 2000ms → 61 frames incl. endpoints; fit preserves aspect, never upscales beyond scale intent).
- [ ] captureStill via GL canvas toBlob (same-frame or preserveDrawingBuffer); wire PNG/JPG/WebP.
- [ ] captureAnimation: GIF via gifenc (quantize per-frame or global palette — gifenc's quantize+applyPalette per frame is fine), MP4 via VideoEncoder(avc1.42) + mp4-muxer; WebM MediaRecorder fallback replaying captured frames to a canvas at fps; AbortSignal cancels cleanly (dispose renderer).
- [ ] ExportPanel: format select (HTML/PNG/JPG/WebP/GIF/MP4), scale select for stills, size preset for video (1080p/720p/preview), progress (frame N/M) + cancel; disabled+notice for url content (media formats only — HTML stays); animation formats disabled when preset none. Download names mockup-<device>-<preset>.<ext>.
- [ ] e2e: still PNG blob magic bytes + dimensions (scale 2 doubles size); WebP and JPG type checks; GIF: bytes start GIF89a, >1 frame marker count; MP4/WebM: short 10-frame encode returns non-empty blob with expected mime (skip-with-log if codec genuinely unavailable in the test browser — but chromium supports avc via WebCodecs; assert it runs there).
- [ ] Suites green; commit "feat: media export — stills, GIF, MP4".

### Task 4: Light theme + dark/light/auto toggle

**Files:** Create src/app/theme.js, tests/theme.test.js, e2e/theme.spec.js. Modify src/app/app.css (palettes), src/app/App.jsx (toggle UI in top bar).

**Interfaces:** `resolveTheme(setting, systemPrefersDark) => "dark"|"light"` (pure); `applyTheme(setting)` sets document.documentElement.dataset.theme + persists localStorage `ma-theme`; `initTheme()` reads storage (default "auto") and subscribes to matchMedia("(prefers-color-scheme: dark)") changes when auto.

- [ ] TDD resolveTheme (auto+dark→dark, auto+light→light, explicit wins).
- [ ] app.css: move all colors to custom properties on :root[data-theme="dark"] and :root[data-theme="light"]; light palette per spec §4 (accessible contrast — labels ≥ 4.5:1 on panels).
- [ ] Toggle UI: three-state control (Dark/Light/Auto) in the top bar next to Photoreal; wire initTheme on app start.
- [ ] e2e: click Light → data-theme="light" + panel background changes + persists across reload; Auto + emulated colorScheme dark/light follows OS (Playwright emulateMedia); existing dark visuals unaffected by default when OS dark.
- [ ] Suites green; commit "feat: light theme + dark/light/auto toggle".

---

## Verification protocol

Per-task reviewer gate as v1 (brief + report + diff package; global constraints above are the lens). Final whole-branch review (most capable model) may run suites and MUST do a visual pass: screenshot laptop/phone in both renderers and judge realism against spec §1 (upright lid, visible thickness), not just test greenness.
