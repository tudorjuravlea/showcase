# Demo assets

`showcase-demo.mp4` and `showcase-demo.gif` were generated entirely from
content authored in this repo. No third-party app, footage, or brand asset
was used.

1. `scripts/demo-app.html` is a self-contained fake weather-app screen
   ("Cloudline"), 644x1332, with CSS/JS animation: a card sliding in near the
   top, a forecast list scrolling mid-screen, and an air-quality bar filling
   near the bottom.
2. That page was recorded with Playwright (Chromium, 644x1332 viewport, ~8s)
   to a `.webm`, then transcoded to h264 `.mp4` with ffmpeg.
3. The recording was run through the showcase CLI
   (`node bin/showcase.mjs <recording.mp4> --out docs/demo/showcase-demo.mp4`)
   to produce the cinematic device-mockup video.
4. `showcase-demo.gif` is that mp4 downsampled with ffmpeg's
   palettegen/paletteuse filters (340px wide, 8fps, trimmed to ~7.8s) to stay
   under 3MB for embedding in the README.
