import { expect, test, type Page } from '@playwright/test'

async function signIn(page: Page, id: string) {
  await page.evaluate(async owner => {
    const path = '/src/stores/cloudAuthStore.ts'
    const { useCloudAuthStore } = await import(path) as typeof import('../src/stores/cloudAuthStore')
    useCloudAuthStore.getState().setSignedIn({ id: owner }, { licenseActive: false, tier: null, access: true, quota: null })
  }, id)
}
async function add(page: Page, title: string) {
  await page.getByRole('button', { name: 'Add Memory', exact: true }).click()
  await page.getByPlaceholder('What should I remember?').fill(title)
  await page.getByPlaceholder('Details… (required)').fill(`Private ${title}`)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
}
test('actual collection controls isolate two owners and retain local data through reload', async ({ page }, testInfo) => {
  await page.goto('/e2e/memory-sensitive-proof.html')
  await add(page, 'Local original')
  await signIn(page, 'owner-a')
  await page.getByRole('button', { name: 'Use account memories', exact: true }).click()
  await expect(page.getByText('Local original', { exact: true })).toHaveCount(0)
  await add(page, 'Owner A original')
  await signIn(page, 'owner-b')
  await expect(page.getByText('Local original', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Use account memories', exact: true }).click()
  await expect(page.getByText('Owner A original', { exact: true })).toHaveCount(0)
  await add(page, 'Owner B original')
  await signIn(page, 'owner-a')
  await page.getByRole('button', { name: 'Use account memories', exact: true }).click()
  await expect(page.getByText('Owner A original', { exact: true })).toBeVisible()
  await expect(page.getByText('Owner B original', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Preview AI memory context' }).click()
  await expect(page.locator('#result')).toContainText('Owner A original')
  await expect(page.locator('#result')).not.toContainText('Owner B original')
  await page.getByRole('button', { name: 'Use local memories', exact: true }).click()
  await expect(page.getByText('Local original', { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(async () => {
    const path = '/src/lib/idbStorage.ts'
    const { idbStorage } = await import(path) as typeof import('../src/lib/idbStorage')
    const raw = await idbStorage.getItem('locally-uncensored-memory')
    return raw?.includes('Owner A original') && raw.includes('Owner B original') && raw.includes('Local original')
  })).toBe(true)
  await page.reload()
  await expect(page.getByText('Local original', { exact: true })).toBeVisible()
  await expect(page.getByText('Owner A original', { exact: true })).toHaveCount(0)
  await signIn(page, 'owner-a')
  await page.getByRole('button', { name: 'Use account memories', exact: true }).click()
  await expect(page.getByText('Owner A original', { exact: true })).toBeVisible()
  await signIn(page, 'owner-b')
  await page.getByRole('button', { name: 'Use account memories', exact: true }).click()
  await expect(page.getByText('Owner B original', { exact: true })).toBeVisible()
  await expect(page.getByText('Owner A original', { exact: true })).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: testInfo.outputPath('memory-collections.png'), fullPage: true })
})
