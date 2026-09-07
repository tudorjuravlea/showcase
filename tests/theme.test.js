// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resolveTheme, applyTheme, setTheme, initTheme, THEME_STORAGE_KEY } from '../src/app/theme.js'

// jsdom doesn't implement matchMedia — stub it per-test so applyTheme/setTheme
// can read "does the OS prefer dark" and (for setTheme) subscribe to changes.
function stubMatchMedia(matches) {
  const listeners = new Set()
  const mql = {
    matches,
    media: '(prefers-color-scheme: dark)',
    addEventListener: vi.fn((_, listener) => listeners.add(listener)),
    removeEventListener: vi.fn((_, listener) => listeners.delete(listener)),
  }
  window.matchMedia = vi.fn(() => mql)
  return mql
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

describe('resolveTheme (pure)', () => {
  it('auto + system dark -> dark', () => {
    expect(resolveTheme('auto', true)).toBe('dark')
  })

  it('auto + system light -> light', () => {
    expect(resolveTheme('auto', false)).toBe('light')
  })

  it('explicit dark wins regardless of system', () => {
    expect(resolveTheme('dark', true)).toBe('dark')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('explicit light wins regardless of system', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('light', false)).toBe('light')
  })
})

describe('applyTheme', () => {
  it('sets data-theme to the explicit setting and persists the setting', () => {
    stubMatchMedia(false)
    applyTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
  })

  it('resolves "auto" against the current system preference', () => {
    stubMatchMedia(true)
    applyTheme('auto')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('auto')

    stubMatchMedia(false)
    applyTheme('auto')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('auto')
  })
})

describe('setTheme subscription lifecycle', () => {
  it('subscribes to system changes only when setting is auto', () => {
    const mql = stubMatchMedia(true)
    setTheme('auto')
    expect(mql.addEventListener).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes when switching away from auto to an explicit setting', () => {
    const mql = stubMatchMedia(true)
    setTheme('auto')
    setTheme('dark')
    expect(mql.removeEventListener).toHaveBeenCalledTimes(1)
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('resubscribes when switching back to auto', () => {
    const mql = stubMatchMedia(true)
    setTheme('auto')
    setTheme('dark')
    setTheme('auto')
    expect(mql.addEventListener).toHaveBeenCalledTimes(2)
  })

  it('a system change while auto re-applies the resolved theme', () => {
    const mql = stubMatchMedia(true)
    setTheme('auto')
    expect(document.documentElement.dataset.theme).toBe('dark')

    mql.matches = false
    const listener = mql.addEventListener.mock.calls[0][1]
    listener()
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('does not leak a listener across repeated explicit settings', () => {
    const mql = stubMatchMedia(false)
    setTheme('light')
    setTheme('dark')
    setTheme('light')
    expect(mql.addEventListener).not.toHaveBeenCalled()
    expect(mql.removeEventListener).not.toHaveBeenCalled()
  })
})

describe('initTheme', () => {
  it('defaults to auto when nothing is stored', () => {
    stubMatchMedia(false)
    initTheme()
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('auto')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('reads and applies a previously stored explicit setting', () => {
    stubMatchMedia(true)
    localStorage.setItem(THEME_STORAGE_KEY, 'light')
    initTheme()
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('subscribes to system changes when the stored setting is auto', () => {
    const mql = stubMatchMedia(true)
    localStorage.setItem(THEME_STORAGE_KEY, 'auto')
    initTheme()
    expect(mql.addEventListener).toHaveBeenCalledTimes(1)
  })
})
