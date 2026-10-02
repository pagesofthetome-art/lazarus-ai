import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('guide shows local/cloud boundaries and safe warning guidance on desktop and phone', async ({ page }, testInfo) => {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname !== 'lu-docs.test') return route.abort()
    const path = url.pathname === '/guide/' ? 'docs/guide/index.html'
      : url.pathname === '/assets/lu.css' ? 'docs/assets/lu.css' : null
    if (!path) return route.fulfill({ status: 404, body: '' })
    await route.fulfill({ contentType: path.endsWith('.css') ? 'text/css' : 'text/html', body: await readFile(path) })
  })
  await page.goto('http://lu-docs.test/guide/')
  const privacy = page.getByRole('region', { name: 'Local by default, with optional network features' })
  await expect(privacy).toBeVisible()
  await expect(privacy).toContainText('Hosted requests leave your machine')
  await page.screenshot({ path: testInfo.outputPath('guide-privacy-desktop.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await privacy.scrollIntoViewIfNeeded()
  const overview = privacy.getByRole('link', { name: 'the cloud overview' })
  await expect(overview).toHaveAttribute('href', '/cloud/')
  await overview.focus()
  await expect(overview).toBeFocused()
  expect(await privacy.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  const antivirus = page.getByRole('region', { name: 'Antivirus flags the app' })
  await antivirus.scrollIntoViewIfNeeded()
  await expect(antivirus).toBeVisible()
  await expect(antivirus).toContainText('Keep protection enabled')
  await expect(antivirus).toContainText('Do not add a blanket folder exclusion')
  expect(await antivirus.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('guide-security-mobile.png') })
})
