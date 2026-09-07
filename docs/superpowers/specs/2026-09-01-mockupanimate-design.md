# MockupAnimate — Design Spec

Date: 2026-09-01
Status: Approved by Tudor (chat, 2026-09-01)

## Purpose

A local web app for producing animated device mockups as **HTML, not video**.
The user drops in a screenshot (or a live prototype URL), places it on a
generic device frame (phone, tablet, laptop, browser window), poses it in 3D
(angle, rotation, exploded view, laptop lid angle), applies an animation
preset, and exports a **single self-contained .html file** for use in slide
decks, portfolios, and web pages. Video export is out of scope for v1 (screen
recording covers it; a deterministic pipeline is v2).

## Core architecture: one scene model, two renderers

### Scene spec (JSON)

The single source of truth. Both renderers and the exporter consume it.

```json
{
  "version": 1,
  "device": "phone",              // phone | tablet | laptop | browser
  "orientation": "portrait",      // portrait | landscape (phone/tablet only)
  "content": {
    "type": "image",              // image | url
    "src": "data:image/png;..."   // data URI, or https URL for iframe
  },
  "pose": {
    "rotateX": 10, "rotateY": -25, "rotateZ": 0,   // degrees
    "translateX": 0, "translateY": 0, "translateZ": 0, // px (CSS) / scene units (GL)
    "scale": 1,
    "explode": 0,                 // 0..1, layer separation factor
    "lidAngle": 110               // laptop only, degrees (0 = closed)
  },
  "style": {
    "shadow": true,
    "glare": true,
    "glow": false,
    "background": "transparent"   // transparent | css color
  },
  "animation": {
    "preset": "rotate-in",        // none | rotate-in | orbit | float | exploded-reveal | hover-tilt | scroll-rotate
    "duration": 2000,             // ms
    "easing": "ease-out",
    "loop": false,
    "autoplay": true
  },
  "renderer": "css"               // css | webgl
}
```

### Renderer 1 — CSS 3D (default, "Interactive")

- Devices are **layered DOM**: back shell → body frame → screen content →
  glass/glare overlay, inside a `perspective` + `preserve-3d` container.
- Exploded view = each layer gets `translateZ(layerIndex * explode * gap)`.
- Content: `<img>` for screenshots, `<iframe>` for live URLs — iframes stay
  fully interactive (the killer feature; per research doc, Approach 1).
- Glare = gradient overlay; glow = blurred box-shadow; shadow = a skewed,
  blurred pseudo-element under the device. All faked, all cheap.

### Renderer 2 — WebGL (Three.js, "Photoreal")

- Devices are built **procedurally** (RoundedBoxGeometry body, inset screen
  plane, notch/camera details) from the same parametric device specs — no
  downloaded GLB models, no Apple trademark exposure, visual consistency with
  the CSS renderer.
- Screenshot applied as a texture on the screen plane (`MeshBasicMaterial`
  so UI colors are not darkened). Live-URL content is not supported in WebGL
  mode; the editor falls back to CSS mode with a notice.
- Realism: environment lighting (Three.js RoomEnvironment — no external HDRI
  files), physical materials on the body (metalness/roughness), soft contact
  shadow plane, optional floor reflection.
- Exploded view = mesh groups translate along their local Z.

### Parametric device specs

One shared module (`devices.js`) defines each device as data: outer
dimensions, corner radius, bezel widths, screen inset, notch, layer stack.
Both renderers derive geometry/DOM from it. Devices in v1: generic phone,
generic tablet, generic laptop (lidAngle pose param), browser window
(CSS-drawn chrome; browser window is CSS-renderer-only in v1 — a flat chrome
frame gains little from WebGL).

### Animation engine

A small custom timeline module (`timeline.js`, rAF-based tween with standard
easings, ~100 lines) interpolates pose values over time. Presets are
functions from `t (0..1)` to a partial pose. The same engine runs in the
editor preview and in exported files, for both renderers — a preset looks
identical everywhere. `hover-tilt` maps pointer position to rotateX/Y;
`scroll-rotate` maps scroll progress of the embed's container.

### Editor (React + Vite)

- **Left panel:** content drop-zone (file drop / paste / URL field), device
  picker, orientation toggle.
- **Center:** live preview; drag-to-rotate updates pose; renderer toggle
  (Interactive / Photoreal).
- **Right panel:** pose sliders (rotate X/Y/Z, scale, explode, lidAngle),
  style toggles, animation preset gallery with duration/easing/loop controls,
  Export button.
- State = the scene spec object; every control reads/writes it directly.

### Export

`export.js` assembles one self-contained `.html`:
- Inlined: runtime (renderers + timeline + device specs), scene JSON, image
  content as data URI, CSS.
- WebGL exports additionally inline the Three.js build (~size warning shown).
- Embed behaviors honored: autoplay, loop, hover-tilt, scroll trigger.
- URL-content exports keep the iframe pointing at the live URL (not inlined).

## Error handling

- Bad image file → toast, keep previous content.
- URL that refuses to be framed (X-Frame-Options) → detectable only as a
  blank iframe; show a persistent hint in the editor when type=url.
- WebGL unavailable → editor disables Photoreal toggle; exported WebGL file
  shows a static fallback message.

## Testing / verification

- Vitest unit tests: timeline easing/interpolation, device spec integrity,
  export assembles valid standalone HTML containing the scene JSON.
- Playwright: editor loads; changing device/pose updates preview; export
  file opens standalone and animates; screenshot-based visual checks for
  each device in both renderers.
- Verification agents review each increment against this spec before the
  next begins.

## Build increments

1. Scaffold + scene model + parametric device specs + CSS 3D renderer +
   minimal editor (device picker, pose sliders, image drop) — static posing
   works end-to-end.
2. Animation engine + all presets + exploded view + style effects.
3. Self-contained HTML export (CSS renderer).
4. WebGL renderer + Photoreal toggle + WebGL export.
5. Polish + full matrix verification (devices × renderers × presets),
   browser-window chrome frame, URL/iframe content mode.

## Out of scope (v1)

Video export, custom keyframe editor, branded device frames, multi-device
scenes (more than one device per scene), mobile-editor UX, project
save/load beyond export (scene JSON is embedded in exports and can be
re-imported later — v2).
