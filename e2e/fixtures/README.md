# e2e/fixtures/showcase-sample.mp4

Fully synthetic, self-owned test fixture for `bin/showcase.mjs`'s e2e smokes
(`e2e/showcase.spec.js`) and for manually exercising
`scripts/analyze-activity.mjs`. Generated entirely from ffmpeg `lavfi`
sources, with no recorded, downloaded, or otherwise derived third-party
footage.

Profile: 644x1332 (portrait), h264/yuv420p, 30fps, 4s, ~13KB.

Content: a dark, static backdrop with three small colored squares, each one
active in its own ~1.3s time window and sliding side to side within its own
band (top / middle / bottom). This gives localized, moving action that
`scripts/analyze-activity.mjs` segments into three distinct activity regions,
rather than one continuous or full-frame change.

## Regenerating

```sh
ffmpeg -y \
  -f lavfi -i "color=c=0x14181f:s=644x1332:d=4:r=30" \
  -f lavfi -i "color=c=0xE04B4B:s=140x140:d=4:r=30" \
  -f lavfi -i "color=c=0x4BE0A0:s=140x140:d=4:r=30" \
  -f lavfi -i "color=c=0x4BA0E0:s=140x140:d=4:r=30" \
  -filter_complex "[0:v][1:v]overlay=x='252+200*sin(2*PI*0.8*t)':y=80:enable='between(t,0,1.3)'[tmp1];[tmp1][2:v]overlay=x='252+200*sin(2*PI*0.8*(t-1.6))':y=596:enable='between(t,1.6,2.8)'[tmp2];[tmp2][3:v]overlay=x='252+200*sin(2*PI*0.8*(t-3.1))':y=1112:enable='between(t,3.1,4.0)'[outv]" \
  -map "[outv]" -c:v libx264 -pix_fmt yuv420p -crf 28 -preset veryfast -movflags +faststart -t 4 e2e/fixtures/showcase-sample.mp4
```

Note: the three moving squares are separate `overlay` filters, not
`drawbox`. The `x`/`y` expressions of `drawbox` are evaluated once at filter
init rather than per frame, so a `drawbox`-only graph produces a box that
looks like it's animating in the filter string but is actually frozen in
the output. The `x`/`y` of `overlay` are re-evaluated every frame.
