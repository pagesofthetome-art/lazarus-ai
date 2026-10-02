import { expect, test } from '@playwright/test'

test('imported project memories retain visible scope and stay out of unscoped requests', async ({ page }) => {
  await page.goto('/e2e/memory-sensitive-proof.html')
  const entries = [
    { title: 'Alpha', content: 'Private Alpha fixture', scope: 'project-a' },
    { title: 'Beta', content: 'Private Beta fixture', scope: 'project-b' },
    { title: 'Global', content: 'Private global fixture' },
  ]
  await page.locator('input[type=file]').setInputFiles({
    name: 'memory.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ entries })),
  })
  await expect(page.getByText('Imported 3 memories.')).toBeVisible()
  await expect(page.getByText('Project: project-a', { exact: true })).toBeVisible()
  await expect(page.getByText('Project: project-b', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('Project: project-a', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Preview AI memory context' }).click()
  await expect(page.locator('#result')).toContainText('Private global fixture')
  await expect(page.locator('#result')).not.toContainText('Alpha')
  await expect(page.locator('#result')).not.toContainText('Beta')
})
