# Examples and Demos

Verified links to live examples and demos for the three recommended device-mockup stacks. Each entry: name - URL - what it shows. Items flagged **[unverified]** could not be confirmed to load.

## (a) CSS 3D transforms stack - live interactive HTML prototypes on angled devices

- **react-device-frameset (zheeeng) - official demo** - https://react-device-frameset.zheeeng.me/ - Live demo site for the React component; renders live HTML inside CSS device frames (iPhone X/8, Galaxy Note 8, MacBook Pro, etc.), with a device selector.
- **react-device-frameset - GitHub repo** - https://github.com/zheeeng/react-device-frameset - Source, README with usage; `DeviceFrameset`, `DeviceSelector`, `DeviceEmulator` components. Powered by Marvel devices.css.
- **react-device-frameset - CodeSandbox examples index** - https://codesandbox.io/examples/package/react-device-frameset - Collection of community sandboxes using the component ("react-device-frameset Demo", "simulator", etc.).
- **devices.css (picturepan2) - official demo** - https://picturepan2.github.io/devices.css/ - Pure-CSS modern devices (iPhone 14 Pro/14, MacBook Pro, iPad Pro, iMac, Apple Watch Ultra, HomePod, Surface). Copy HTML from the demo; drop a screenshot/video into `.device-screen`.
- **devices.css (picturepan2) - GitHub repo** - https://github.com/picturepan2/devices.css/ - Source and SCSS; homepage listed as devicescss.xyz.
- **marvelapp/devices.css - official demo** - https://marvelapp.github.io/devices.css/ - Demo page titled "13 Pure CSS Mobile Devices from @marvelapp"; iPhone X/8/8 Plus/5S/5C, Galaxy Note 8, Nexus, Lumia, iPad, etc. Copy generated HTML, put content in `.screen`.
- **marvelapp/devices.css - GitHub repo** - https://github.com/marvelapp/devices.css/ - Source; this is the CSS that react-device-frameset is built on.
- **html5-device-mockups (pixelsign) - official demo** - https://pixelsign.github.io/html5-device-mockups/ - Image-based mockups (86 different device images, multiple color schemes and orientations, per the README); the screen container can hold screenshots, JS apps, a YouTube embed, or an iframe. Made by Tomi Hiltunen, Angelos Arnis and Benjamin Bortels.
- **html5-device-mockups - GitHub repo** - https://github.com/pixelsign/html5-device-mockups - Source and README (3.7k stars, 401 forks); npm `html5-device-mockups`.
- **react-parallax-tilt (mkosir) - Storybook demo** - https://mkosir.github.io/react-parallax-tilt/ - Interactive Storybook of the tilt component (default story).
- **react-parallax-tilt - Glare effect story** - https://mkosir.github.io/react-parallax-tilt/?path=%2Fstory%2Freact-parallax-tilt--glare-effect - Tilt with glare highlight.
- **react-parallax-tilt - Parallax effect (glare + scale) story** - https://mkosir.github.io/react-parallax-tilt/?path=%2Fstory%2Freact-parallax-tilt--parallax-effect-glare-scale - Combined parallax, glare and scale.
- **react-parallax-tilt - GitHub repo** - https://github.com/mkosir/react-parallax-tilt - Source, props reference (glare, scale, perspective, gyroscope).
- **vanilla-tilt.js (micku7zu) - official demo** - https://micku7zu.github.io/vanilla-tilt.js/ - Landing page with live tilt demos; zero-dependency 3D tilt library.
- **vanilla-tilt.js - GitHub repo** - https://github.com/micku7zu/vanilla-tilt.js/ - Source, options (max, perspective, glare, scale, gyroscope).
- **Motion (Framer Motion) - Tilt card example (JS)** - https://motion.dev/examples/js-tilt-card - Official interactive 3D tilt card that follows the pointer, using `animate` + frame API + transformPerspective/preserve-3d.
- **Motion - Tilt card step-by-step tutorial (React)** - https://motion.dev/tutorials/react-tilt-card - React tutorial using `motion` component + `useSpring` for a cursor-following 3D tilt.
- **Motion - Tilt card live example (embed)** - https://examples.motion.dev/js/tilt-card - Standalone running example of the tilt card.
- **framer-motion rotating 3D card - CodeSandbox** - https://codesandbox.io/s/framer-motion-rotating-3d-card-wqs3nf - Rotating 3D card built with framer-motion.
- **iframe inside CSS 3D-rotated device frame - CodePen (nctbrtc)** - https://codepen.io/nctbrtc/pen/ZEEqBKY - Live `<iframe>` inside a CSS 3D-angled phone (`transform: rotateX/rotateY/rotateZ`, `perspective: 1000px`) with selectable perspective views; CSS-only transforms, JS only for controls.
- **iframe in 3D device frame - CodePen (RillingDev)** - https://codepen.io/RillingDev/pen/vLRNvb - "Phone-Styled IFrame": iframe in a phone with three rotate perspective views.
- **3D iframe-based previews - CodePen (lerouxb)** - https://codepen.io/lerouxb/pen/WNRLdP - Grid of live website iframes in perspective mobile mockups.
- **HTML/CSS devices perspective + iframe - CodePen (biernacki)** - https://codepen.io/biernacki/pen/jLNEWQ - iframes in perspective mobile/tablet/laptop mock-ups with animation.

## (b) React Three Fiber + drei + Remotion stack - photorealistic animated video

- **drei Html laptop demo "Mixing HTML and WebGL w/ occlusion" (0xca0a) - CodeSandbox** - https://codesandbox.io/s/mixing-html-and-webgl-w-occlusion-9keg6 - The canonical drei demo: an interactive website mapped onto a 3D laptop screen with `<Html transform occlude>`; widely cited on the three.js forum and pmndrs/drei issues.
- **drei `<Html>` component - official docs** - http://drei.docs.pmnd.rs/misc/html - Docs for the `transform` prop (applies matrix3d transforms) and `occlude` (incl. `occlude="blending"`); this is what maps DOM onto angled 3D surfaces.
- **Three.js Journey - "Mixing HTML and WebGL" lesson** - https://threejs-journey.com/lessons/mixing-html-and-webgl - Paid lesson covering the same laptop-screen HTML technique.
- **Three.js Journey - "Fun and Simple Portfolio with R3F" lesson** - https://threejs-journey.com/lessons/fun-and-simple-portfolio-with-r3f - Bruno Simon's R3F portfolio lesson that uses the pmndrs MacBook model; references market.pmnd.rs/model/macbook.
- **pmndrs market - MacBook model** - https://market.pmnd.rs/model/macbook - Web-ready CC0 MacBook model download used in the R3F portfolio lesson.
- **pmndrs market - GitHub repo** - https://github.com/pmndrs/market - Source for the CC0 asset marketplace; also ships R3F starters.
- **drei - ContactShadows docs/demo** - https://drei.docs.pmnd.rs/staging/contact-shadows - Official docs with props (opacity, scale, blur, far, resolution) and embedded example.
- **drei - full component list (npm)** - https://www.npmjs.com/package/@react-three/drei - Documents Environment, MeshReflectorMaterial, ContactShadows, PresentationControls and Stage props used to build studio-quality device scenes.
- **Remotion - template-three (GitHub)** - https://github.com/remotion-dev/template-three - Minimal Remotion + React Three Fiber boilerplate; features a 3D phone with a swappable video inside its screen (`ThreeCanvas`, `useVideoTexture`).
- **Remotion template-three - StackBlitz preview** - https://stackblitz.com/github/remotion-dev/template-three - Runs the template-three boilerplate in-browser.
- **Remotion - @remotion/three docs** - https://www.remotion.dev/docs/three - Documents the template-three phone-with-video example and setup.
- **RemotionUI - Device Mockup Zoom component** - https://remotionui.com/docs/components/device-mockup-zoom - Phone/browser mockup with slow Ken Burns zoom reveal; `npx remotion-ui@latest add device-mockup-zoom`. Scrubable live preview at https://remotionui.com/ .
- **Threepipe interactive 3D device mockup (Codrops) - GitHub** - https://github.com/repalash/threepipe-device-mockup-codrops - Open-source MacBook + iPhone mockup showcase; drag-and-drop images onto device screens.
- **Threepipe device mockup - Codrops tutorial** - https://tympanus.net/codrops/2024/08/07/interactive-3d-device-showcase-with-threepipe/ - Tutorial with an embedded CodePen live demo (Rotato-like, open source).
- **joshuaKnauber/mockups - GitHub** - https://github.com/joshuaKnauber/mockups - Open-source Three.js website for making 3D design mockups (Rotato-like).
- **anatolykopyl/vue-three-d-mockup - GitHub** - https://github.com/anatolykopyl/vue-three-d-mockup - 3D phone mockup component (Vue + Three.js) with image/video on screen.
- **shahdinsalman23/react-macbookpro - GitHub** - https://github.com/shahdinsalman23/react-macbookpro - R3F + Tailwind interactive MacBook Pro with scroll-based rotation, HDRI environment, custom textures.
- **dimitriosgkegkas 3D MacBook portfolio - live demo** - https://dimitriosgkegkas.github.io/portfolio/ - Deployed R3F/Three.js interactive MacBook interface with a functional terminal.

## (c) Pre-rendered frames + homography warp stack - static images

- **Homography.js (Eric-Canas) - GitHub repo** - https://github.com/Eric-Canas/Homography.js/ - Library for Affine/Projective/Piecewise-Affine warps over any Image or HTMLElement from a set of reference points; README has code samples and CDN usage. No interactive live demo page found (see note).
- **Homography.js - npm** - https://www.npmjs.com/package/homography - Package page with usage and CDN snippets.
- **jonnyjackson26/device-frames-media - GitHub** - https://github.com/jonnyjackson26/device-frames-media - PNG device frames (Apple + Android) plus masks and template JSON (screen x/y/width/height) for compositing screenshots into bezels.
- **device-frames-media - hosted assets (GitHub Pages)** - https://jonnyjackson26.github.io/device-frames-media/ - Hosted frame/mask PNGs and index referenced in the repo's JSON.
- **viticci/frames-cli - GitHub** - https://github.com/viticci/frames-cli - Apple Frames CLI: frames screenshots/screen recordings with official product bezels; batch mode, colors, ffmpeg for video; bundled agent skill.
- **MacStories - Apple Frames 4 + CLI launch** - https://www.macstories.net/stories/introducing-apple-frames-4-a-revamped-shortcut-support-for-frame-colors-proportional-scaling-and-the-apple-frames-cli-for-developers/ - Announcement/docs for the shortcut and CLI, device coverage.
- **MacStories - Apple Frames CLI video framing** - https://www.macstories.net/stories/apple-frames-cli-now-with-support-for-framing-screen-recordings/ - Follow-up on framing screen recordings.
- **Apple Design Resources - Product Bezels** - https://developer.apple.com/design/resources/ - Official Apple device bezels (PSD + PNG) for iPhone, iPad, Mac, Watch mockups.

## Notes and caveats
- **Homography.js live demo: not found / [unverified].** The candidate `eric-canas.github.io/Homography.js` could not be confirmed to exist; the README contains only static example images/GIFs and a benchmark page (`test/benchmark.html`), no interactive "drag reference points to warp" demo. Use the GitHub repo and npm page instead.
- CodeSandbox and StackBlitz pages sometimes require sign-in or a moment to boot; the sandbox slugs above are the canonical/most-cited ones. (Direct automated fetch of CodeSandbox is blocked by bot detection, but the `9keg6` and `wqs3nf` slugs are corroborated by multiple independent references.)
- Three.js Journey lessons are behind a paywall; only lesson landing pages are public.
- **Apple product bezels - usage restrictions.** Apple's App Store Marketing Resources and Identity Guidelines state: "Use Apple product images 'as is' and without modification. Modifications include adding reflections, shadows, highlights… cropping, tilting, or obstructing any part of the images; animating, flipping, or spinning the images." Apple's Site Terms of Use further state that "no part of the Site and no Content may be copied, reproduced, republished… for any commercial enterprise, without Apple's express prior written consent." This means tilting/angling an Apple bezel (the whole point of an angled mockup) technically violates the guidelines - use non-Apple frames (jonnyjackson26/device-frames-media, marvelapp/devices.css) for angled/animated commercial work.
- The RemotionUI "Device Mockup Zoom" is a copy-into-your-repo component (installed via CLI), not an npm runtime import.