---
name: showcase
description: Turn a screen recording or app/prototype export into a cinematic device-mockup video or self-contained hero web page. Use when the user says "showcase this", "make a video of <file/prototype>", asks for a "device mockup video", or drops a screen recording they want presented.
---

# Showcase

Thin wrapper around the Showcase CLI. The CLI holds all the logic (defaults,
activity analysis, rendering); this skill just resolves the input and calls it.

## Steps

1. **Resolve the input file.** If the user names a file or drops one, use it.
   If ambiguous (multiple candidates, or no file mentioned), ask which file
   before proceeding. Accepts video (`.mp4 .mov .m4v .webm .mkv .avi`) or
   image (`.png .jpg .jpeg .webp .gif`). Stills work too, not just video.
2. **cd to your Showcase clone.** This skill ships inside the repo at
   `skills/showcase/`. If it was installed as a symlink into
   `~/.claude/skills/`, the repo root is two levels above this file's
   directory (`realpath` this SKILL.md, then go up past `showcase/` and
   `skills/`). If it was installed as a copy, locate the clone or ask the
   user where it is. Run `npm install` there once if `node_modules` is
   missing.
3. **Run the CLI:**
   ```
   node bin/showcase.mjs "<input path>" [flags]
   ```
   Map any user preferences to flags (below); otherwise omit flags and let
   the CLI apply its defaults.
4. **Send the resulting file to the user** when the command exits 0. All CLI
   output goes to **stderr**, both progress and the final
   `showcase: wrote <path>` line; stdout stays empty except for the one-time
   Chromium install's own progress on a first run. Read the path off stderr,
   or pass `--out` yourself and use that path. Mention which
   device/look/duration were used if they weren't explicit, and offer to try
   a different look or device.

## Flags

`--device phone|tablet|laptop|browser` `--look auto|reference|hero-drift|close-up-pan|orbit-loop|flat-lay-rise|hero-rise`
`--duration N` `--fps N` `--size N` `--background #hex|name` `--frame gold|silver|graphite|black` `--out path` `--html` `--contained`

`--background` sets the scene backdrop (default: cinematic black). Takes a
hex value like `#FFCC00` or a CSS color name, and applies to the MP4
(letterbox padding included), the poster, and the HTML export.

`--duration` is plain seconds: `--duration 10`, not `10s`. Ranges are
enforced: duration 1–120, fps 5–60, size 240–2160.

`--contained` keeps the whole device in frame the entire time, with no
full-bleed close-up ever. Use it for slides, columns, and embeds where the
video sits inside a fixed box rather than filling the screen. Reach for it
whenever the user mentions a deck, slide, or column layout.

Omitting `--look` entirely defaults to `reference` for both video and image.
`auto` is a separate, explicitly-selectable value: it resolves to the
`auto-action` look for video and `hero-drift` for images. Passing
`--look auto-action` is rejected.

## Defaults (when a flag is omitted)

| Setting | Default |
|---|---|
| device | `phone` |
| look | `reference` (for both video and image) |
| duration | the FULL content length, clamped 6–120s (images: 10s) |
| fps | 30 |
| size | 1080 (`--size` = short side; the frame's aspect matches the device screen, so the other axis is derived from it: phone portrait 1080 gives 1080×2352, browser gives 1786×1080) |
| orientation | auto-detected from content aspect (portrait/landscape) |

## Looks

- **reference**: the signature choreography (tilt, close-up push, pull-back, screen-filling ending). Default for both video and image. The ending holds the whole-device framing, then SNAPS in over ~0.6s (the same real time on any clip length), slightly past its mark and back. It lands exactly on screen-fit and goes no further. Because the output frame carries the screen's aspect, that point shows 100% of the screen, edge to edge and uncropped, with the metal band out of frame entirely. The screen's rounded corners are squared off just before the snap, so the final frames are 100% content with no backdrop anywhere, corners included.
- **auto-action** (reached via `--look auto` on video): camera visits the on-screen action (via motion analysis), dwells, pulls back, ends on a full hero shot.
- **hero-drift**: slow 3/4-tilt float plus slight rotation, gentle push-in then settle. Reached via `--look auto` on images.
- **close-up-pan**: starts tight on a screen corner, slow pull-back and pan to full hero.
- **orbit-loop**: seamless slow orbit around the device, loopable.
- **flat-lay-rise**: starts flat under an overhead camera, rises and tilts to hero angle.
- **hero-rise**: device enters from the bottom of frame, zooms out, settles to hero.

## `--html` export

Emits a single self-contained HTML file (no network requests, content video
embedded as a data URI) that plays the intro look once, then idles with a
gentle float and mouse-hover-follow loop. Good for embedding in a page or
sending as a standalone artifact instead of a video file. Warns if the
embedded content pushes the file past ~25MB.

## Requirements

- `ffmpeg`/`ffprobe` are provisioned by `npm install` (the optional
  `ffmpeg-static`/`ffprobe-static` packages); a PATH ffmpeg is only the
  fallback when those aren't installed.
- Video inputs need actual *localized* motion to drive `auto-action`. A static
  recording, or one whose motion is uniform across the whole screen, yields no
  activity segments and the look falls back to `hero-drift`. That still makes
  a good video, just without the action beats.
- Portrait vs. landscape is auto-detected from the input; `laptop`/`browser`
  devices are always landscape regardless of content aspect.
