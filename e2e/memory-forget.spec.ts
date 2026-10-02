import { expect, test } from '@playwright/test'

test('forgetting during embedding cannot restore a vector in real IndexedDB', async ({ page }) => {
  await page.goto('/e2e/memory-forget-proof.html')
  await page.getByRole('button', { name: 'Start delayed embedding' }).click()
  await expect(page.getByRole('status')).toHaveText('Embedding pending')
  await page.getByRole('button', { name: 'Forget memory' }).click()
  await expect(page.getByRole('status')).toHaveText('Memory forgotten')
  await page.getByRole('button', { name: 'Complete delayed embedding' }).click()
  await expect(page.getByRole('status')).toHaveText('{"entries":0,"vectors":0}')
})
