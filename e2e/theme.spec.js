import { test, expect } from '@playwright/test'

// Each Playwright test gets a fresh browser context (no shared localStorage),
// so "no stored preference" is simply the state before any test interacts
// with the theme toggle.

test('defaults to auto with no stored preference', async ({ page }) => {
  await page.goto('/')
  const stored = await page.evaluate(() => localStorage.getItem('ma-theme'))
  expect(stored).toBe('auto')
})

test('auto (default) resolves to dark when the OS prefers dark, matching the original dark palette', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('.ma-panel-column-left')).toHaveCSS('background-color', 'rgb(22, 23, 29)')
})

test('clicking Light sets data-theme, changes a panel background, and persists across reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  const panel = page.locator('.ma-panel-column-left')
  await expect(panel).toHaveCSS('background-color', 'rgb(22, 23, 29)') // dark panel bg beforehand

  await page.locator('#ma-theme-light').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(panel).toHaveCSS('background-color', 'rgb(247, 248, 250)') // light panel bg
  // The UA scheme has to follow the app's explicit choice, or native
  // checkboxes/selects keep rendering dark (per the OS) on a light UI.
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light')
  await expect(page.locator('#ma-theme-light')).toHaveAttribute('aria-pressed', 'true')

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(panel).toHaveCSS('background-color', 'rgb(247, 248, 250)')
  const stored = await page.evaluate(() => localStorage.getItem('ma-theme'))
  expect(stored).toBe('light')
})

test('clicking Dark sets data-theme=dark and persists across reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')
  await page.locator('#ma-theme-dark').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark')

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('Auto follows the emulated OS color scheme, including live changes', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')
  // Pick dark explicitly first, then switch back to Auto so we know the
  // live subscription (not just the initial resolve) is what's driving it.
  await page.locator('#ma-theme-dark').click()
  await page.locator('#ma-theme-auto').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.locator('#ma-theme-auto')).toHaveAttribute('aria-pressed', 'true')

  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})
