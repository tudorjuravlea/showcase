# Code-Based Device Mockups: Rendering, Animating, and Applying Your UI to Angled Phones, Tablets, and Laptops

## TL;DR
- **There is no single library that does everything.** Pick by output: for **live interactive HTML prototypes on an angled device**, use CSS 3D transforms (real iframes, a `devices.css` frame plus `perspective`/`rotateX`/`rotateY`, tilt via `react-parallax-tilt` or Framer Motion); for **polished animated marketing video**, use **React Three Fiber + drei + a GLTF device model rendered through Remotion's `@remotion/three` to deterministic MP4**; for **quick static angled images**, use pre-rendered PNG device frames with a perspective/homography warp (Homography.js/Sharp) or a CSS-3D screenshot.
- **The realism tradeoff is fundamental.** CSS 3D gives you real, interactive HTML on the screen but only fake glare (gradient overlays) and no true reflections/environment lighting. Three.js/WebGL gives you PBR materials, HDRI environment maps, real reflections and contact shadows - but putting live HTML on the screen is awkward (drei's `<Html transform occlude>` has real limitations).
- **Maintenance is a real hazard here.** Several popular packages are effectively frozen: `devices.css` (picturepan2 and marvelapp), `html5-device-mockups`, `react-device-frameset`, and the `deviceframe` CLI have not had meaningful releases in years. The actively maintained, modern stack is **R3F + drei + Remotion**, plus `react-parallax-tilt` and `frames-cli`, all under active development in 2025–2026.

## Key Findings

**By approach, here is what to reach for:**

1. **CSS 3D transforms** - Best for real, clickable HTML/iframe content on an angled screen. You get the DOM for free (forms work, videos play, prototypes are interactive), but lighting is faked with gradient overlays and there are no true reflections. Frame assets come from CSS device libraries (`devices.css`, `react-device-frameset`) or you build your own.
2. **Three.js / react-three-fiber (R3F) + drei** - Best for photorealism: PBR metal/glass materials, HDRI environment maps for natural glare/glow, `MeshReflectorMaterial` for screen/floor reflections, `ContactShadows`/`AccumulativeShadows` for grounding. Live HTML on the screen is possible via drei `<Html transform occlude>` but is fiddly; video and image textures are easy and reliable.
3. **Pre-rendered / 2D warping** - Best for fast, cheap static images and simple pipelines: take a flat PNG device bezel with a known screen quad, warp your screenshot into it with a projective (homography) transform (Homography.js in JS, Sharp+affine or OpenCV/skimage in Node/Python), composite, done. No 3D engine needed.
4. **Video-export pipelines** - Remotion (`@remotion/three`) is the standout for deterministic, frame-perfect MP4 output of R3F scenes; browser `MediaRecorder`+`captureStream` and CCapture.js are the pure-client options; Puppeteer/Playwright headless capture covers CSS-3D DOM mockups.

## Details

### Approach 1 - CSS 3D transforms (real HTML on screen)

This is the only approach that keeps your UI as **live, interactive DOM**. You place your content (a `<div>`, an `<iframe>` of a prototype, a `<video>`) inside a device frame element and rotate the whole thing with `transform: perspective(1200px) rotateY(-25deg) rotateX(10deg)` plus `transform-style: preserve-3d`.

**Frame asset libraries (2D/CSS):**

- **`devices.css` (picturepan2)** - Pure-CSS/SCSS device frames (iPhone X/8, iPad Pro, MacBook Pro, iMac, Apple Watch, Surface, Google Pixel). MIT, by Yan Zhu; 2.4k stars and 245 forks per its GitHub repo header (github.com/picturepan2/devices.css). The standard HTML structure uses a `.device` > `.device-frame` > `.device-screen` (`<img>`) pattern, so you drop a screenshot or an absolutely-positioned iframe into `.device-screen`. **Maintenance: effectively frozen** - open issue #11 ("Support iPhone 12, Samsung S20, Google Pixel 5, etc.", opened by giuseppecampanelli on Oct 20, 2020) is still open with no assignee.
- **`marvelapp/devices.css`** - The original "13 pure CSS mobile devices" (iPhone 8/X, iPad, MacBook Pro, Galaxy S5/Note 8, Nexus 5, Lumia, HTC One). MIT. You include `devices.min.css` and copy the generated HTML; content goes in the `.screen` div. **Maintenance: frozen** (older device set, no recent activity). Repo: github.com/marvelapp/devices.css. A resizable fork exists at github.com/philipkiely/devices.css.
- **`html5-device-mockups` (pixelsign)** - Image-based (not pure CSS) mockups: 86 device images, multiple colors/orientations, maintains aspect ratio on scale, a `.screen` container for content, and explicitly supports embedding a JavaScript app or YouTube video inside the device. Installable via `npm i html5-device-mockups`. **Maintenance: old** (jQuery-slim era demo), usable but not actively developed. Repo: github.com/pixelsign/html5-device-mockups.

**React wrappers:**

- **`react-device-frameset` (zheeeng)** - The most useful React option. Wraps Marvel's Devices.css as a `<DeviceFrameset device="iPhone 8" color="gold" landscape>` component that accepts arbitrary children (so your live UI renders on the screen), plus a `<DeviceSelector>` and `<DeviceEmulator>`. Devices: iPhone X/8/8 Plus/5s/5c/4s, Galaxy Note 8, Nexus 5, Lumia 920, Galaxy S5, HTC One, iPad Mini, MacBook Pro. MIT. Per reactlibraries.com's listing: 123.0K downloads/month, 108 GitHub stars, 17 forks, 1 contributor, and last release v1.3.4 "almost 3 years ago." **Maintenance flag: stale, single maintainer, dated device set.** Repo: github.com/zheeeng/react-device-frameset.
- **`react-device-frame` (kimolalekan)** and **`react-device-frames`** - Minor/older alternatives; `react-device-frame` was never fully published to npm. Not recommended over `react-device-frameset`.

**Tilt / rotation / animation on top of CSS frames:**

- **`vanilla-tilt.js` (micku7zu)** - Zero-dependency 3D tilt via `requestAnimationFrame`; `data-tilt` attribute plus options for `max` tilt degrees, `perspective`, `scale`, `speed`, `startX/startY` (static angle), `gyroscope`, and a built-in `glare`/`max-glare` effect. Forked from the jQuery Tilt.js. Good for hover-driven tilt with fake glare on a device frame. MIT.
- **`react-parallax-tilt` (mkosir)** - The maintained React choice: "Lightweight 2.9kB, zero dependencies" per its GitHub README, with latest v1.7.328 published just days before August 2026 per npm. `<Tilt glareEnable glareMaxOpacity={...} tiltMaxAngleX tiltMaxAngleY scale gyroscope>` - built-in glare simulation, glare position/border-radius control, and gyroscope support for mobile. This is the recommended tilt wrapper for React. Repo: github.com/mkosir/react-parallax-tilt.
- **Framer Motion (now "motion")** - For keyframed/entrance/scroll-driven device motion. Use `motion.div` with `whileHover={{ rotateX, rotateY }}`, `style={{ transformStyle: "preserve-3d", perspective }}`, and `useMotionValue`/`useSpring`/`useTransform` to drive smooth cursor-following tilt. Combine with `useScroll` for scroll-driven rotation. Great for entrance animations and physics-based settling.
- **GSAP** - For complex timelines (keyframed device choreography, ScrollTrigger-driven rotation). Pairs with either CSS 3D or Three.js.
- **`react-spring`** - Physics-based springs; historically the pmndrs animation companion to R3F, also usable for DOM 3D transforms.

**Faking glare/glow/reflection in CSS:** There are no real reflections. You overlay a semi-transparent linear-gradient "sheen" element (often `mix-blend-mode: screen` or `overlay`) positioned over the screen, sometimes animated with the tilt angle (that's exactly what vanilla-tilt's `glare` and react-parallax-tilt's glare do). Screen "glow" is a `box-shadow`/`filter: blur()` colored halo behind the device. Reflections can be faked with a CSS-mirrored, gradient-masked copy of the screenshot below the device.

**Interactive HTML caveat:** iframes and DOM inside a `perspective`/`preserve-3d` transform stay fully interactive and crisp (vector, not rasterized), which is the killer feature of this approach. The limitation is purely visual realism.

### Approach 2 - Three.js / react-three-fiber + drei (photorealistic)

This is what tools like Rotato approximate. You load a GLTF/GLB device model, apply your screenshot/video as a texture on the screen mesh, light the scene with an HDRI environment map, and animate camera or model rotation.

**Core stack:**

- **react-three-fiber** (`@react-three/fiber`) - React renderer for Three.js. `@react-three/fiber@9` pairs with React 19; `@8` with React 18. Actively maintained by pmndrs. Zero runtime overhead over Three.js.
- **drei** (`@react-three/drei`) - The helper library that makes this practical. Relevant helpers:
  - **`<Environment>`** - Sets up an HDRI cubemap for image-based lighting; presets from HDRI Haven are built in (docs warn presets are for dev, use your own `files` in production). This is what produces natural, non-flat glare and glow on glossy device bodies and glass.
  - **`<MeshReflectorMaterial>`** - Extends `MeshStandardMaterial` to add real reflections (renders the scene from the surface's perspective to a texture), with `blur`, `mixStrength`, `mixBlur`, `resolution`, `mirror`, `depthScale`. Use it for a reflective floor under the device or a glossy screen. Note: known artifact issues when combined with HDRI env maps + metalness (drei issue #2392).
  - **`<ContactShadows>` / `<AccumulativeShadows>`** - Soft grounding shadows beneath the device. `<ContactShadows frames={1}>` bakes once for static scenes.
  - **`<Stage>`** - One-liner professional lighting + environment + shadows for quick showcase setups.
  - **`<PresentationControls>`** - Constrained, springy drag-to-rotate (exactly the "tilt the device" interaction), used in the well-known Three.js Journey MacBook portfolio lesson.
  - **`<Html>`** - Puts real DOM on a mesh (see caveats below).
  - **`useGLTF`, `useTexture`, `useVideoTexture`** - Asset loading.
- **`@react-three/postprocessing`** - Bloom/glow, depth of field, color grading for that extra marketing polish.
- **`gltfjsx`** - CLI that converts a GLTF model into a JSX component so you can target the screen mesh precisely.

**Applying your content to the screen mesh:**

- **Static image:** `const tex = useTexture('/screenshot.png')` → `<meshBasicMaterial map={tex} />` on the screen mesh (use `meshBasicMaterial` so the UI isn't darkened by lighting, or a `meshStandardMaterial` with `emissiveMap` for a lit-screen look).
- **Video:** `useVideoTexture('/demo.mp4')` (drei) or, in Remotion, `useOffthreadVideoTexture`/`useVideoTexture` from `@remotion/three`, assigned as `map` on a `meshBasicMaterial`.
- **Live HTML/interactive prototype:** drei `<Html transform occlude position={...}>` renders actual DOM positioned in 3D via CSS `matrix3d`. It works for a "computer screen in your scene," but the limitations are real: the default `occlude` is binary (element fully hides/shows, opacity 0/1) rather than pixel-masked; `occlude="blending"` enables true depth occlusion but requires a custom `material` and has performance costs; many markers with occlusion tank FPS; and syncing the HTML exactly to the screen quad is fiddly (a recurring support question on the three.js forum for the "laptop screen" demo). For genuinely interactive prototypes, CSS-3D (Approach 1) is usually the better tool; use `<Html>` when you specifically need HTML embedded inside an otherwise-3D scene.

**Faking vs rendering glare/glow/reflections:**
- **Glare/glow:** Real, from the HDRI `<Environment>` reflecting off the PBR material (`metalness`/`roughness`/`clearcoat`). Add `@react-three/postprocessing` Bloom for screen glow.
- **Reflections:** Real, via `MeshReflectorMaterial` (planar) or the environment map (on the body/glass).
- **Shadows:** Real, via `ContactShadows`/shadow maps.

**Device 3D model assets (GLTF/GLB):**
- **pmndrs Market (market.pmnd.rs)** - "Download CC0 models, textures and HDRI's that are web-ready." Includes a **MacBook** model at market.pmnd.rs/model/macbook (used in the Three.js Journey portfolio lesson). Assets branded CC0; site code MIT. **Caveat:** CC0 covers copyright but not trademark/trade-dress - a CC0 model of a branded Apple device may still carry Apple trademark considerations for commercial use; the market API is self-described as unfinished/subject to change.
- **Sketchfab** - Per Sketchfab's Download API page, a library of over 1 million free models available under Creative Commons licenses, in glTF/GLB/USDZ formats; large iPhone/device libraries. Check each model's individual license and note the same trademark caveat for branded devices.
- **Polyhaven** - CC0 HDRIs (for `<Environment>` lighting) and models; used in community MacBook demos for realistic HDRI lighting.
- **Apple Design Resources** - Apple publishes device bezel/frame art (and product images) but under restrictive terms aimed at showing their products accurately in *your* app marketing - not free 3D GLB models, and not for arbitrary reuse. Community frame collections (e.g. jamesjingyi/mockup-device-frames, Meta/Facebook Design device frames) aggregate 2D frames with attribution notes. Treat all Apple/branded assets as trademark-sensitive.

**Animation in R3F:** `useFrame` for per-frame rotation (interactive/preview), `@react-spring/three` or GSAP timelines for entrance/keyframed motion, drei `useScroll`/`ScrollControls` (or Theatre.js `@theatre/r3f`) for scroll-driven camera fly-throughs and device reveals. **Important for video export:** when rendering with Remotion you must NOT use `useFrame` (it runs on its own clock and causes flicker) - drive everything from `useCurrentFrame()` instead.

### Approach 3 - Pre-rendered device frames + perspective/homography warp (static)

The cheapest, most reliable path for static angled images and simple server pipelines. You have a flat PNG of an angled device with a transparent screen area (or a known screen quad), and you warp your rectangular screenshot to fit that quad with a projective transform, then composite.

- **Homography.js (Eric-Canas)** - Lightweight JS/Node library for Affine, Projective, or Piecewise-Affine warps over any Image or HTMLElement from a small set of reference points; output can be persistent `ImageData` for drawing to canvas, mixing, or download. Ideal for "warp screenshot into the four screen corners" in the browser or Node. MIT.
- **Sharp (lovell/sharp)** - Fast Node image library. It does **not** have a built-in 4-point perspective/homography transform (open feature request issue #2095); you can do affine but for true keystone you pair it with a homography step (Homography.js, or compute the matrix yourself) or use OpenCV. Good for the final composite/resize.
- **Python (OpenCV / scikit-image `transform`)** - `skimage.transform` or `cv2.getPerspectiveTransform` + `warpPerspective` for the homography; standard, well-documented approach if your pipeline is Python.
- **Device frame PNG sources with screen coordinates:**
  - **jonnyjackson26/device-frames-media** - PNGs of common Apple/Android phone frames plus **masks and an `index.json` with exact screen quad `{x,y,width,height}` and frame size per device/color** - purpose-built for programmatic compositing. Actively expanding via GitHub Actions.
  - **viticci/frames-cli (`frames`)** - CLI that frames screenshots AND screen recordings with official Apple bezels, auto-detects device, supports video (`frames video recording.mp4`) with quality presets, batch/merge, and proportional multi-device layout. Modern and maintained.
  - **c0bra/deviceframe (`dframe`)** - Older CLI that wraps screenshots/URLs in frames downloaded from a CDN. **Maintenance flag: stale**; prefer frames-cli.
  - **f2prateek/device-frame-generator**, **jamesjingyi/mockup-device-frames** (Sketch/Figma frames), and Meta Design device frames - additional 2D frame sources.

Faking glare on a flat composite: overlay a pre-baked glare/gloss PNG layer, or a gradient, over the composited screen.

### Approach 4 - Rendering to output (video/image export)

**For static images:**
- **CSS-3D/DOM mockups:** Puppeteer/Playwright `page.screenshot()` after laying out the device. WebGL in headless needs ANGLE (`--use-angle=gl`).
- **Three.js:** `canvas.toDataURL()`/`toBlob()` for PNG - but you must create the renderer with `preserveDrawingBuffer: true`, OR read synchronously in the same frame you render (WebGL spec: reading after the render function returns is undefined behavior when `preserveDrawingBuffer` is false; but that flag "can cause significant performance loss," so same-frame read is preferred). For offscreen/headless, render to a `WebGLRenderTarget` and pull pixels with `readRenderTargetPixels` into a `Uint8Array` (remember rows come back bottom-to-top; flip them) → `ImageData` → 2D canvas → `toBlob`. Note `readRenderTargetPixels` is a GPU→CPU bottleneck (can dominate render time).

**For video:**
- **Remotion + `@remotion/three` - the recommended pipeline for R3F mockups.** `<ThreeCanvas>` integrates R3F into Remotion's deterministic, frame-by-frame render; animations are driven by `useCurrentFrame()` (never `useFrame()`), and `<Sequence>` inside must use `layout="none"`. It renders each frame via headless Chromium (Puppeteer) and encodes with FFmpeg, so frame 42 is always identical - exactly what you want for clean MP4/WebM (including transparent WebM). There's an official starter, `remotion-dev/template-three`, that features "a 3D phone with a video inside," and drop-in device components exist (RemotionUI's `device-mockup-zoom` scene: "Phone or browser mockup with slow zoom reveal," installed via `npx remotion-ui@latest add device-mockup-zoom`). Set `Config.setChromiumOpenGlRenderer('angle')` (and `chromiumOptions: { gl: 'angle' }` for SSR/Lambda). **License flag (important):** Remotion is source-available, not permissive OSS - free for individuals, non-profits, and for-profit teams up to 3 people; a paid Company License is required for for-profit companies of 4+. Per Remotion's official pricing (remotion.dev/docs/license): "Remotion for Creators (Seats) – $25 per Seat per month, no minimum"; "Remotion for Automators (Server Renders and Client-Side Renders) – $0.01 per render, $100 per month minimum"; and "The Enterprise License has the same per-render pricing, but requires a minimum spend of $500 per month." Budget for this if you're a company.
- **CCapture.js (spite)** - Client-side canvas capture that decouples from real time by hooking `requestAnimationFrame`/`Date.now`/`setTimeout` to a fixed timestep, so you get smooth output even if each frame takes seconds. Legacy master outputs WebM, PNG/JPEG TAR sequences, and GIF; MIT. **Maintenance flag:** the master README still reflects the 2012–2016 codebase; a WebCodecs/MP4 "ground-up rewrite" is advertised on the project's demo site but its release/branch status is unclear - verify before relying on MP4 output.
- **Browser `MediaRecorder` + `canvas.captureStream()`** - Native, no deps (captureStream is Baseline "widely available" since January 2020), but **real-time only**: it records on the wall clock and drops frames if rendering can't keep up (W3C-documented "choppy output," "highly inconsistent frame rates"), and the canvas must be origin-clean. Fine for quick screen-grabs of a live animation, not for guaranteed-smooth marketing renders.
- **Puppeteer/Playwright for DOM/CSS-3D mockups** - Two modes: deterministic **screenshot-per-frame** (seek to frame → screenshot → pipe to FFmpeg; e.g. the `html5-animation-video-renderer` approach, "no frameskips") or real-time **screencast** (`puppeteer-screen-recorder`, community-maintained, CDP-based, up to 60fps). For true determinism there's `puppeteer-capture` using the experimental CDP `HeadlessExperimental.beginFrame`. Apache-2.0 core libs.

## Recommendations

**(a) Live interactive HTML prototype on an angled device - use CSS 3D transforms.**
- Stack: your prototype in an `<iframe>` (or React component) → placed in a device frame from **`react-device-frameset`** (React) or hand-rolled with **`devices.css`** → wrap in a container with `perspective` + `preserve-3d` → tilt/animate with **`react-parallax-tilt`** (hover/gyro) or **Framer Motion** (`useScroll`/`useSpring` for scroll- and cursor-driven rotation).
- Fake glare with an animated gradient overlay (built into react-parallax-tilt/vanilla-tilt); add a blurred colored `box-shadow` for glow.
- Rationale: only this approach keeps the UI clickable, crisp, and stateful. Accept that lighting is faked.
- If the dated device set of `react-device-frameset` matters, build a custom frame with a modern bezel PNG and a positioned iframe - you keep interactivity without depending on a frozen library.

**(b) Polished, marketing-style animated video - use R3F + drei, rendered through Remotion.**
- Stack: GLTF device model (**pmndrs Market** MacBook, or a Sketchfab/Polyhaven model - mind trademarks) → screen content as texture (`useTexture` for stills, `useOffthreadVideoTexture` for video) → **`<Environment>`** HDRI for glare/glow, **`MeshReflectorMaterial`** floor + **`ContactShadows`** for grounding, **postprocessing Bloom** for screen glow → animate with `useCurrentFrame()`-driven transforms → export deterministic MP4/transparent WebM via **`@remotion/three`**.
- Rationale: this is the only fully code-based path that reproduces Rotato-style realism (real reflections, environment glare, soft shadows) with reliable, reproducible video output.
- Budget/licensing: factor in Remotion's Company License if you're a for-profit team of 4+. If you must stay fully permissive/free, render client-side with **CCapture.js** (verify its MP4 rewrite status, or accept WebM/PNG-sequence→FFmpeg).

**(c) Quick static angled mockup images - use pre-rendered frames + homography warp.**
- Stack: grab a device frame PNG + screen quad from **jonnyjackson26/device-frames-media** (has `index.json` with screen coordinates) → warp your screenshot with **Homography.js** (JS/Node) or OpenCV (Python) → composite/resize with **Sharp** → overlay a glare PNG if desired. Or, for Apple bezels including video, just use **`frames-cli`**.
- Rationale: no 3D engine, no GPU, fully scriptable, seconds per image. The tradeoff is fixed camera angles (whatever the PNG provides).

**Benchmarks / thresholds that would change these:**
- If you need **both** interactivity **and** realism, there is no clean answer today - prototype drei `<Html occlude="blending">` on your specific model; if FPS or sync is unacceptable (likely for complex UIs), fall back to CSS-3D and drop the realism, or record a video of the prototype and texture it onto a 3D model (Approach b).
- If your team crosses **4 people (for-profit)**, Remotion needs a paid license - re-evaluate CCapture.js/MediaRecorder or a Puppeteer screenshot-per-frame pipeline.
- If you need **many device SKUs / newest devices**, the frozen CSS libraries and pmndrs/Sketchfab model availability become the constraint - a 2D frame-PNG pipeline (Approach c) is easiest to keep current.

## Caveats
- **Maintenance honesty:** `devices.css` (both picturepan2 and marvelapp), `html5-device-mockups`, `react-device-frameset` (last release ~3 years ago, single maintainer), and the `deviceframe` CLI are stale/frozen. They still function but lack current devices. The R3F/drei/Remotion stack and `react-parallax-tilt`, `frames-cli`, and `jonnyjackson26/device-frames-media` are the actively maintained pieces.
- **Trademark/trade-dress:** "Free" or CC0 3D models and frames of Apple/Samsung/Google devices clear copyright but not trademark or product trade dress. For commercial marketing this is usually tolerated when showing your app on a recognizable device, but it is a legal consideration independent of the asset license - verify per project.
- **drei `<Html>` occlusion** is not pixel-perfect masking by default (binary opacity); `occlude="blending"` gives real depth occlusion but needs a custom material, may not work with `meshBasicMaterial`/`shaderMaterial`, and costs performance.
- **Export gotchas:** Three.js PNG export needs `preserveDrawingBuffer: true` or a same-frame read; `MediaRecorder` is real-time and drops frames; CCapture.js MP4 support depends on an unverified rewrite; headless WebGL needs ANGLE. Remotion is the safe default for reproducible video but is not free for larger companies.
- **Drift:** device model availability and package release dates change fast; re-check npm "last publish" and each model's license badge at build time. Version/download figures cited here (e.g., `react-parallax-tilt` v1.7.328, `react-device-frameset` download counts) are point-in-time snapshots.