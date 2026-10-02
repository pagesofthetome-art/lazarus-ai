import { chromium, expect } from '@playwright/test'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import process from 'node:process'

const base = process.env.LU_REMOTE_PROOF_URL
const code = process.env.LU_REMOTE_PROOF_PASSCODE
const backend = process.env.LU_REMOTE_PROOF_BACKEND
if (!base || !/^http:\/\/127\.0\.0\.1:\d+$/.test(base) || !/^\d{6}$/.test(code || '') || !['ollama', 'openai'].includes(backend)) {
  process.stdout.write('FAIL configuration\n')
  process.exit(1)
}
let browser
let stage = 'launch'
const input = createInterface({ input: process.stdin })
try {
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort())
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  stage = 'pairing'
  await page.goto(`${base}/mobile`)
  await page.locator('#auth-code').fill(code)
  await page.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(page.locator('#msg-input')).toBeVisible()
  stage = 'first reply'
  await page.locator('#msg-input').fill('Synthetic request')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.locator('#chat-area')).toContainText('synthetic reply')
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible()
  const revoked = new Promise(resolve => input.once('line', resolve))
  process.stdout.write('READY_TO_REVOKE\n')
  if (await revoked !== 'REVOKED') throw new Error('Invalid control message')
  stage = 'revoked reply'
  await page.locator('#msg-input').fill('Synthetic request after revocation')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.locator('#chat-area')).toContainText('Restart Remote Access on your desktop, then reconnect.')
  if (process.env.LU_REMOTE_PROOF_OUTPUT) {
    await page.screenshot({ path: join(process.env.LU_REMOTE_PROOF_OUTPUT, `remote-native-mobile-${backend}.png`), fullPage: true })
  }
  stage = 'revoked reload'
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('Restart Remote Access on your desktop, then reconnect.')
  await expect(page.locator('#msg-input')).toHaveCount(0)
  if (process.env.LU_REMOTE_PROOF_OUTPUT) {
    await page.screenshot({ path: join(process.env.LU_REMOTE_PROOF_OUTPUT, `remote-native-mobile-${backend}-reload.png`), fullPage: true })
  }
  process.stdout.write('PASS\n')
} catch {
  // Never print Playwright exception details, which can include the access code.
  process.stdout.write(`FAIL ${stage}\n`)
  process.exitCode = 1
} finally {
  input.close()
  await browser?.close()
}
