# Third-party notices

Showcase is MIT-licensed (see [LICENSE](LICENSE)). It builds on the
following third-party software.

## Bundled into generated output

The generated WebGL renderer runtimes (`src/export/generated/runtime-gl.iife.js`
and `src/showcase/generated/showcase-runtime.iife.js`), and therefore every
standalone HTML file this tool exports with the WebGL renderer, contain a
bundled copy of:

- **three.js**, MIT License, Copyright (c) 2010-2026 three.js authors.
  https://github.com/mrdoob/three.js
  The MIT license and this copyright notice apply to the three.js code inside
  the bundled runtime and inside any HTML file exported by Showcase.

## Runtime dependencies (npm)

- **three**: MIT, three.js authors
- **react**, **react-dom**: MIT, Meta Platforms, Inc. (editor UI only; not
  part of exported HTML)
- **gifenc**: MIT, Matt DesLauriers (GIF export)
- **mp4-muxer**: MIT, Vanilagy (in-browser MP4 export)

## External tools

- **ffmpeg / ffprobe**: used as external command-line tools by the showcase
  CLI for probing and encoding. ffmpeg is licensed under LGPL/GPL depending on
  the build. The showcase CLI prefers the static binaries provided by the
  optional **ffmpeg-static** / **ffprobe-static** npm packages (falling back
  to `ffmpeg`/`ffprobe` on PATH when those aren't installed). These are GPL
  builds of ffmpeg downloaded from GitHub Releases at `npm install` time, not
  stored in or distributed with this repository.
- **Chromium** (via **Playwright**, MIT, Microsoft): used headlessly by the
  showcase CLI and the e2e tests. Downloaded by Playwright's own installer,
  not distributed with this repository.

Development-only dependencies (Vite, Vitest, Playwright, oxlint, jsdom) carry
their own licenses (MIT/Apache-2.0) and are not part of any shipped artifact.
