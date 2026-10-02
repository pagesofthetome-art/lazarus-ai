import { expect, test } from '@playwright/test'

/**
 * Box-Test T5 vom 11.09.2026, Punkt 4: Export, Oberflaeche neu laden, dieselbe
 * Datei importieren. Der Zaehler sprang von `4 memories` auf `8 memories` und
 * `T5-bread` stand zweimal da. Dieser Lauf fuehrt genau diesen Weg durch die
 * echte Oberflaeche, mit der echten Exportdatei aus dem Download.
 */
test('the app reads its own memory export back without doubling the collection', async ({ page }, testInfo) => {
  await page.goto('/e2e/memory-sensitive-proof.html')
  const seed = Buffer.from(JSON.stringify({
    entries: [
      { id: 't5-1', type: 'user', title: 'T5-bread', content: "The tester's favourite bread is rye.", sensitive: false },
      { id: 't5-2', type: 'user', title: 'T5-box', content: 'The box runs Windows 10.', sensitive: false },
      { id: 't5-3', type: 'feedback', title: 'T5-issues', content: 'Check the repository before filing one.', sensitive: false },
      { id: 't5-4', type: 'project', title: 'T5-port', content: 'The engine listens on port 8127.', sensitive: false },
    ],
  }))
  const input = page.locator('input[type=file]')
  await input.setInputFiles({ name: 'seed.json', mimeType: 'application/json', buffer: seed })
  await expect(page.getByText('Imported 4 memories.', { exact: true })).toBeVisible()
  await expect(page.getByText('4 memories', { exact: true })).toBeVisible()

  // Die echte Exportdatei, so wie sie der Knopf `.json` auf die Platte legt.
  const pendingDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '.json', exact: true }).click()
  const stream = await (await pendingDownload).createReadStream()
  if (!stream) throw new Error('No exported JSON stream')
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const exported = Buffer.concat(chunks)

  await page.reload()
  await expect(page.getByText('4 memories', { exact: true })).toBeVisible()

  await page.locator('input[type=file]').setInputFiles({ name: 'memory.json', mimeType: 'application/json', buffer: exported })
  await expect(page.getByText('Imported 0 new memories, 4 already present.', { exact: true })).toBeVisible()
  await expect(page.getByText('4 memories', { exact: true })).toBeVisible()
  await expect(page.getByText('T5-bread', { exact: true })).toHaveCount(1)
  await page.screenshot({ path: testInfo.outputPath('memory-import-dedupe.png') })

  // Gegenpfad: dieselbe Datei mit einem Eintrag mehr. Der eine kommt an, die
  // vier bekannten nicht noch einmal.
  const gewachsen = JSON.parse(exported.toString('utf8'))
  gewachsen.entries.push({ id: 't5-5', type: 'user', title: 'T5-tea', content: "The tester's favourite tea is rooibos.", sensitive: false })
  await page.locator('input[type=file]').setInputFiles({
    name: 'memory-plus-one.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(gewachsen)),
  })
  await expect(page.getByText('Imported 1 new memory, 4 already present.', { exact: true })).toBeVisible()
  await expect(page.getByText('5 memories', { exact: true })).toBeVisible()
})
