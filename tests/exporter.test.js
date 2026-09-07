// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { buildExportHtml } from '../src/export/exporter.js'
import { defaultScene, mergeScene } from '../src/core/scene.js'
import runtimeCssScript from '../src/export/generated/runtime.iife.js?raw'
import runtimeGlScript from '../src/export/generated/runtime-gl.iife.js?raw'

describe('buildExportHtml', () => {
  it('produces a full standalone HTML document', () => {
    const html = buildExportHtml(defaultScene())
    expect(html).toMatch(/^<!doctype html>/i)
  })

  it('embeds the scene JSON, including the device name', () => {
    const scene = mergeScene(defaultScene(), { device: 'tablet' })
    const html = buildExportHtml(scene)
    expect(html).toContain('"device":"tablet"')
  })

  it('embeds the runtime and mounts it against the scene', () => {
    const html = buildExportHtml(defaultScene())
    expect(html).toContain('Showcase.mount')
  })

  it('has no ES module import statements anywhere in the output', () => {
    const html = buildExportHtml(defaultScene())
    expect(html).not.toMatch(/(^|[^\w])import\s+[\w{*]/)
  })

  // media.js (gifenc, mp4-muxer) is editor-only — see
  // docs/superpowers/specs/2026-09-01-mockupanimate-v2-design.md §3, "New
  // deps allowed... editor-only; NOT in export HTML runtimes". Neither
  // runtime-entry.js nor runtime-gl-entry.js imports src/export/media.js
  // (confirmed by grep), so this asserts the built bundles they produce
  // never actually pull those deps in.
  it('the standalone runtime bundles never include the media-export dependencies', () => {
    for (const bundle of [runtimeCssScript, runtimeGlScript]) {
      expect(bundle).not.toContain('gifenc')
      expect(bundle).not.toContain('mp4-muxer')
      expect(bundle).not.toContain('GIFEncoder')
      expect(bundle).not.toContain('ArrayBufferTarget')
    }
  })

  it('inlines image content as a data URI for image scenes', () => {
    const scene = mergeScene(defaultScene(), {
      content: { type: 'image', src: 'data:image/png;base64,AAAA' },
    })
    const html = buildExportHtml(scene)
    expect(html).toContain('data:image/png;base64,AAAA')
  })

  it('escapes "</script>" inside the embedded scene JSON so it cannot break out of the inline script', () => {
    const scene = mergeScene(defaultScene(), {
      content: { type: 'url', src: 'https://evil.example/</script><script>alert(1)</script>' },
    })
    const html = buildExportHtml(scene)
    expect(html).not.toContain('</script><script>alert(1)')
  })

  it('embeds the larger three.js-inclusive gl runtime bundle for webgl scenes, not the css bundle', () => {
    const cssScene = mergeScene(defaultScene(), { renderer: 'css' })
    const glScene = mergeScene(defaultScene(), {
      renderer: 'webgl',
      content: { type: 'image', src: 'data:image/png;base64,AAAA' },
    })
    const cssHtml = buildExportHtml(cssScene)
    const glHtml = buildExportHtml(glScene)
    // The gl runtime bundles three.js (hundreds of KB); the css runtime does
    // not, so a size gap this large can only mean the right bundle was
    // picked — a robust check that doesn't depend on minified internals.
    expect(glHtml.length).toBeGreaterThan(cssHtml.length * 5)
  })

  // The runtime bundles are inlined verbatim into <script>...</script>, with
  // no escaping pass of their own. If a future dependency bump (e.g. three.js)
  // ever emitted the literal "</script" inside a string, the exported file
  // would silently break at that byte. Guard both bundles.
  it('neither inlined runtime bundle contains a "</script" sequence', () => {
    expect(runtimeCssScript).not.toContain('</script')
    expect(runtimeGlScript).not.toContain('</script')
  })

  it('resets the UA body margin and centers the device on the page', () => {
    const html = buildExportHtml(defaultScene())
    expect(html).toContain('html,body{margin:0;}')
    expect(html).toMatch(/body\{[^}]*justify-content:center/)
  })

  it('paints a non-transparent style.background across the exported page', () => {
    const html = buildExportHtml(mergeScene(defaultScene(), { style: { background: '#123456' } }))
    expect(html).toMatch(/body\{[^}]*background:#123456/)
  })

  it('omits a page background for a transparent scene', () => {
    const html = buildExportHtml(defaultScene()) // default background: 'transparent'
    expect(html).not.toMatch(/body\{[^}]*background:/)
  })

  it('drops a style.background that is not a plain CSS color, rather than emitting it into the <style>', () => {
    const html = buildExportHtml(
      mergeScene(defaultScene(), { style: { background: 'red;}</style><script>alert(1)</script>' } })
    )
    // It still travels inside the (escaped) scene JSON — what matters is that
    // it never reaches the <style> block, where it could close the tag.
    const styleBlock = html.slice(html.indexOf('<style>'), html.indexOf('</style>'))
    expect(styleBlock).not.toContain('alert(1)')
    expect(styleBlock).not.toContain('red;}')
  })

  it('wraps a scroll-rotate scene in a tall, scrollable page so the effect works standalone', () => {
    const html = buildExportHtml(
      mergeScene(defaultScene(), { animation: { preset: 'scroll-rotate' } })
    )
    expect(html).toContain('class="ma-scroll-stage"')
    expect(html.match(/class="ma-scroll-spacer"/g)).toHaveLength(2)
    expect(html).toContain('.ma-scroll-spacer{height:100vh;}')
    expect(html).toContain('id="ma-root"')
  })

  it('does not add the scroll shell for a non-scroll preset', () => {
    const html = buildExportHtml(mergeScene(defaultScene(), { animation: { preset: 'orbit' } }))
    expect(html).not.toContain('ma-scroll-stage')
  })
})
