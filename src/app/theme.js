// Editor-chrome theme (dark/light/auto). Pure logic + DOM/localStorage side
// effects only — no React here, so it can be unit-tested under plain jsdom
// and called once at app start without depending on component lifecycle.
// Scene/export output is unaffected: nothing here touches src/export/*, and
// exported HTML never reads document.documentElement.dataset.theme.

export const THEME_STORAGE_KEY = 'ma-theme'

const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)'

// Pure: given the user's setting and whether the OS currently prefers dark,
// what theme should actually be painted. Explicit settings always win.
export function resolveTheme(setting, systemPrefersDark) {
  if (setting === 'dark' || setting === 'light') return setting
  return systemPrefersDark ? 'dark' : 'light'
}

// Paints the resolved theme onto the document root and persists the raw
// setting (not the resolved value) so "auto" is remembered as auto.
export function applyTheme(setting) {
  const systemPrefersDark = window.matchMedia(SYSTEM_DARK_QUERY).matches
  document.documentElement.dataset.theme = resolveTheme(setting, systemPrefersDark)
  localStorage.setItem(THEME_STORAGE_KEY, setting)
}

// Module-scoped so setTheme can always tear down a previous subscription
// before deciding whether to create a new one, regardless of who's calling.
let systemQuery = null
let systemListener = null

function unsubscribeFromSystemChanges() {
  if (systemQuery && systemListener) {
    systemQuery.removeEventListener('change', systemListener)
  }
  systemQuery = null
  systemListener = null
}

function subscribeToSystemChanges() {
  systemQuery = window.matchMedia(SYSTEM_DARK_QUERY)
  systemListener = () => applyTheme('auto')
  systemQuery.addEventListener('change', systemListener)
}

// Applies + persists a new setting, and keeps the live-update subscription
// in sync: subscribed only while the setting is "auto", unsubscribed the
// moment it becomes explicit, so switching back and forth never leaks or
// duplicates listeners.
export function setTheme(setting) {
  applyTheme(setting)
  unsubscribeFromSystemChanges()
  if (setting === 'auto') subscribeToSystemChanges()
}

function getStoredTheme() {
  return localStorage.getItem(THEME_STORAGE_KEY) || 'auto'
}

// Call once at app start: reads the persisted setting (default "auto"),
// applies it, and wires up the system-change subscription if applicable.
export function initTheme() {
  setTheme(getStoredTheme())
}
