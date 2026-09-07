# MockupAnimate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local web app that places screenshots or live prototype URLs on generic 3D-posed, animated device frames and exports self-contained animated HTML files.

**Architecture:** One JSON scene spec consumed by two renderers — a layered-DOM CSS 3D renderer (interactive, default) and a procedural Three.js renderer (photoreal) — plus a shared rAF timeline engine and an exporter that inlines a prebundled runtime + scene + assets into a single .html file. React/Vite editor UI manipulates the scene spec.

**Tech Stack:** Vite, React 18, Three.js (direct, NOT react-three-fiber — the renderer must run framework-free in exports), Vitest, Playwright.

**Spec:** docs/superpowers/specs/2026-09-01-mockupanimate-design.md (read it first; it is the contract)

## Global Constraints

- Exported HTML must be fully self-contained (no network requests except iframe URLs for `content.type === "url"`).
- Core modules (`src/core/*`, `src/render/*`) must NOT import React — they run in exported files.
- Generic/unbranded device designs only (no Apple logos, no branded trade-dress details).
- Animation presets must render identically in editor preview and exported file (same timeline engine).
- Node 20+, npm. All tests green before every commit. Commit per task.
- Scene spec field names exactly as defined in the spec's JSON example.

## File Structure

```
package.json, vite.config.js, index.html
src/core/scene.js        — defaultScene(), validateScene(scene), mergeScene(scene, patch)
src/core/devices.js      — DEVICES: {phone, tablet, laptop, browser} parametric specs
src/core/timeline.js     — Timeline class (rAF tween), EASINGS map
src/core/presets.js      — PRESETS: {name: {tick(t, baseScene) => partialPose, ...}}
src/render/css/cssRenderer.js — createCssRenderer(container) => {render(scene), setPose(pose), destroy()}
src/render/css/device.css
src/render/webgl/glRenderer.js — createGlRenderer(container) => same interface
src/export/exporter.js   — buildExportHtml(scene, opts) => string
src/export/runtime-entry.js     — bundles core + css renderer to window.MockupAnimate
src/export/runtime-gl-entry.js  — bundles gl renderer (+three) additionally
src/export/generated/    — runtime.iife.js, runtime-gl.iife.js (built via `npm run build:runtime`, imported by exporter with ?raw)
src/app/App.jsx, src/app/panels/{ContentPanel,PosePanel,AnimationPanel}.jsx, src/app/Preview.jsx
tests/*.test.js (Vitest), e2e/*.spec.js (Playwright)
```

---

### Task 1: Scaffold + scene model + device specs + CSS 3D renderer + minimal editor

**Files:** Create package.json, vite.config.js, index.html, src/core/scene.js, src/core/devices.js, src/render/css/cssRenderer.js, src/render/css/device.css, src/app/App.jsx, src/app/Preview.jsx, src/app/panels/ContentPanel.jsx, src/app/panels/PosePanel.jsx, tests/scene.test.js, tests/devices.test.js, e2e/editor.spec.js

**Interfaces produced (later tasks rely on these exact names):**
- `defaultScene()` → full scene object per spec JSON; `mergeScene(scene, patch)` → new scene (deep merge, no mutation); `validateScene(scene)` → `{ok: boolean, errors: string[]}`.
- `DEVICES` — for each device: `{ name, width, height, cornerRadius, bezel: {top,right,bottom,left}, screenRadius, layers: [{id, depth}] , hasNotch, lidAngle? }` in abstract units where phone width = 300. Layers ordered back→front: `shell`, `body`, `screen`, `glass`.
- `createCssRenderer(containerEl)` returns `{ render(scene), setPose(pose), destroy() }`. `render` rebuilds DOM for device/content/style changes; `setPose` only updates transforms (cheap, called per animation frame). Root device element gets class `ma-device`; pose applied as `transform: perspective(1200px) translate3d(...) rotateX(...) rotateY(...) rotateZ(...) scale(...)` on `.ma-device`, with each layer at `translateZ(depth + pose.explode * 60 * layerIndex)`.
- Laptop: `.ma-lid` element rotated `rotateX(-(180 - lidAngle))` around bottom edge (`transform-origin: bottom`); screen content lives in the lid.

**Steps:**
- [ ] Scaffold Vite React app (`npm create vite@latest . -- --template react`, then add vitest + @playwright/test; playwright config runs against `vite preview` or dev server).
- [ ] TDD scene.js: tests — defaultScene matches spec shape; mergeScene deep-merges pose patch without mutating input; validateScene rejects unknown device and explode outside 0..1.
- [ ] TDD devices.js: tests — all four devices present with required keys; layers ordered back→front; phone/tablet support orientation swap helper `deviceDims(device, orientation)` → {width, height}.
- [ ] Implement cssRenderer + device.css: phone, tablet, laptop drawn as pure CSS (rounded rects, bezels, camera dot, laptop base + hinged lid); browser window: chrome bar with 3 dots + URL pill, content below. Content: `<img>` (object-fit: cover) for image, `<iframe>` for url. Glare overlay div (diagonal linear-gradient, mix-blend-mode: screen) when style.glare; drop shadow via filter/pseudo-element when style.shadow.
- [ ] Minimal editor: App holds scene in useState; ContentPanel (file input + drag-drop → FileReader → data URI; URL text field), device picker + orientation toggle; PosePanel sliders for rotateX/Y/Z (-60..60), scale (0.5..1.5), explode (0..1), lidAngle (0..130, laptop only); Preview mounts createCssRenderer in a ref'd div, calls render on scene change (useEffect). Drag on preview updates rotateY/rotateX.
- [ ] Playwright e2e: app loads; selecting each device shows `.ma-device`; moving rotateY slider changes the transform style attribute; dropping a fixture PNG shows it inside `.ma-screen img`.
- [ ] All tests green; commit "feat: scaffold, scene model, device specs, CSS 3D renderer, minimal editor".

### Task 2: Timeline engine + animation presets + exploded reveal + style effects

**Files:** Create src/core/timeline.js, src/core/presets.js, src/app/panels/AnimationPanel.jsx, tests/timeline.test.js, tests/presets.test.js. Modify src/app/App.jsx, src/app/Preview.jsx.

**Interfaces produced:**
- `new Timeline({duration, easing, loop, onTick(t), onDone})` with `.play()`, `.pause()`, `.seek(t)`, `.destroy()`; `t` eased 0..1. `EASINGS`: linear, ease-in, ease-out, ease-in-out, spring (overshoot approximation). Injectable clock: constructor accepts `{now, raf}` for deterministic tests.
- `PRESETS` (exact keys): `none`, `rotate-in`, `orbit`, `float`, `exploded-reveal`, `hover-tilt`, `scroll-rotate`. Each: `{ mode: "timeline"|"pointer"|"scroll", tick(t, scene) => partialPose }`. `rotate-in`: from rotateY -90/opacity handled via pose only (rotateY -90 → scene.pose.rotateY). `orbit`: rotateY continuous 360 (loop). `float`: gentle sin translateY ± rotateX. `exploded-reveal`: explode 1 → scene value with settle. `hover-tilt`: pointer x/y → ±15° (mode pointer, editor wires pointermove). `scroll-rotate`: scroll progress → rotateY -45..45 (mode scroll).
- `runAnimation(scene, applyPose)` helper in presets.js: wires Timeline/pointer/scroll for a scene, returns `{stop()}` — used by both Preview and export runtime.

**Steps:**
- [ ] TDD timeline with fake clock: tick sequence eased correctly, loop wraps, seek works, destroy cancels.
- [ ] TDD presets: every preset key exists; tick(0)/tick(0.5)/tick(1) return finite numbers; exploded-reveal tick(1) returns explode === scene.pose.explode target.
- [ ] AnimationPanel: preset gallery (buttons), duration slider (300–8000ms), easing select, loop + autoplay toggles, Play/Replay button. Preview uses runAnimation + `setPose` (not full render) per tick.
- [ ] Playwright: pick rotate-in, press Play, assert `.ma-device` transform changes between two sampled moments; pick orbit + loop and assert it keeps changing.
- [ ] Green; commit "feat: timeline engine, animation presets, exploded view".

### Task 3: Self-contained HTML export (CSS renderer)

**Files:** Create src/export/exporter.js, src/export/runtime-entry.js, vite.runtime.config.js, src/export/generated/.gitkeep, tests/exporter.test.js, e2e/export.spec.js. Modify package.json (script `build:runtime`), src/app/App.jsx (Export button).

**Interfaces:**
- Consumes: createCssRenderer, runAnimation, defaultScene/mergeScene.
- Produces: `buildExportHtml(scene)` → complete HTML string: inline `<style>`, inline runtime IIFE (`?raw` import of generated/runtime.iife.js), `<script>window.MockupAnimate.mount(document.getElementById('ma-root'), SCENE_JSON)</script>`. `runtime-entry.js` defines `window.MockupAnimate = { mount(el, scene) }` which creates renderer + runAnimation.
- `npm run build:runtime` = `vite build --config vite.runtime.config.js` (lib mode, IIFE, output to src/export/generated/). Run it in `predev`/`prebuild` so `?raw` import always resolves.

**Steps:**
- [ ] Configure runtime build; verify generated/runtime.iife.js appears and defines window.MockupAnimate when loaded in a bare page.
- [ ] TDD exporter: output contains `<!doctype html>`, the scene JSON (device name), the runtime marker string `MockupAnimate.mount`, and no `import ` statements; image data URI present for image scenes.
- [ ] Export button: builds HTML, triggers download via Blob + a[download], filename `mockup-<device>-<preset>.html`.
- [ ] Playwright: click Export, capture download, write to temp, open with `page.goto(file://...)`, assert `.ma-device` exists and (for rotate-in autoplay) transform changes over time; assert zero failed network requests.
- [ ] Green; commit "feat: self-contained HTML export".

### Task 4: WebGL renderer (procedural Three.js) + Photoreal toggle + WebGL export

**Files:** Create src/render/webgl/glRenderer.js, src/export/runtime-gl-entry.js, tests/glrenderer.test.js. Modify vite.runtime.config.js (second bundle), src/export/exporter.js (renderer==="webgl" → embed runtime-gl), src/app/Preview.jsx + App.jsx (renderer toggle; url-content forces css with notice).

**Interfaces:**
- `createGlRenderer(containerEl)` → same `{render, setPose, destroy}` contract as cssRenderer. Procedural build from same DEVICES specs: body = RoundedBoxGeometry (or extruded rounded-rect shape), screen = plane with `MeshBasicMaterial({map: texture from content image})`, body `MeshPhysicalMaterial({metalness .8, roughness .35})`. Lighting: `THREE.PMREMGenerator` + `RoomEnvironment` (three/addons — no external files). Shadow: radial-gradient canvas texture on ground plane. Explode: layer groups translate on z by `explode * 0.6 * index`. Laptop lid = hinged group. Browser device: not supported → renderer throws `UnsupportedDeviceError`; UI keeps it CSS-only.
- Exporter: webgl scenes embed runtime-gl.iife.js (includes three) and call the same `MockupAnimate.mount` (runtime-gl registers both renderers, picks by scene.renderer).

**Steps:**
- [ ] Implement glRenderer; unit-test the pure geometry-spec mapping (exported helper `glLayout(device, orientation)` returning body/screen dimensions) — no WebGL context needed in unit tests.
- [ ] Wire toggle in editor; pose sliders and presets drive setPose identically (degrees→radians inside renderer).
- [ ] Extend runtime build + exporter; TDD exporter picks gl bundle for webgl scenes.
- [ ] Playwright (chromium has WebGL): toggle Photoreal with an image scene → canvas appears, no console errors; export webgl file and open standalone → canvas renders, animation ticks.
- [ ] Green; commit "feat: WebGL photoreal renderer and export".

### Task 5: Polish + full-matrix verification

**Files:** Modify src/app/* (layout/styling pass: dark UI, three-panel layout per spec), src/render/css/device.css (visual refinement). Create e2e/matrix.spec.js.

**Steps:**
- [ ] Editor visual polish: dark theme, panel layout (left content/device, center preview on subtle dot-grid, right pose/style/animation), toasts for bad image + X-Frame-Options hint for url mode, WebGL-unavailable disable state.
- [ ] Matrix e2e: for each device × renderer (css: all 4; webgl: phone/tablet/laptop) × presets (rotate-in, orbit, exploded-reveal): render, screenshot, assert no console errors and device element/canvas visible. Store screenshots in e2e/__screenshots__ for the human review gate.
- [ ] Fix everything the matrix surfaces; green; commit "polish: editor UI + full matrix verification".

---

## Verification protocol (applies after every task)

Dispatch a reviewer subagent (spec + plan + `git diff` scope) to check: interface contracts above are honored verbatim, tests actually assert behavior (not just "renders"), no React imports in core/render/export runtime code, export files self-contained. Reviewer findings that are real → implementer (or fix inline) before next task.
