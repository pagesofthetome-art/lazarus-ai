import { expect, test } from '@playwright/test'

test('app recovery stops a native operation whose startup outlived the frontend', async ({ page }) => {
  let release!: () => void
  let stopCalls = 0
  const nativeFinished = new Promise<void>(resolve => { release = resolve })
  await page.exposeFunction('remoteNativeProof', async (command: string) => {
    if (command === 'remote_server_status') return { running: false, lifecycleBusy: true }
    if (command === 'stop_remote_server') { stopCalls += 1; await nativeFinished; return null }
    throw new Error('Unsupported proof command')
  })
  await page.addInitScript(() => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {
      invoke: (command: string) => (window as unknown as { remoteNativeProof: (name: string) => Promise<unknown> }).remoteNativeProof(command),
    } })
  })
  await page.goto('/e2e/remote-memory-proof.html')
  await expect(page.getByRole('status')).toContainText('Recovering an unfinished Remote operation')
  await expect.poll(() => stopCalls).toBe(1)
  release()
  await expect(page.getByRole('status')).toContainText('was stopped during recovery')
  await expect(page.locator('#remote-state')).toHaveText('{"enabled":false,"qrVisible":false}')
})

test('stop waits for a pending native start and never publishes its QR', async ({ page }) => {
  const calls: string[] = []
  let running = false
  let release!: () => void
  const started = new Promise<void>(resolve => { release = resolve })
  await page.exposeFunction('remoteNativeProof', async (command: string) => {
    calls.push(command)
    if (command === 'start_remote_server') { await started; running = true }
    else if (command === 'stop_remote_server') running = false
    else if (command !== 'remote_server_status') throw new Error('Unsupported proof command')
    return { running, port: 11435, passcode: 'fixture', passcodeExpiresAt: 1, lanUrl: '', mobileUrl: '' }
  })
  await page.addInitScript(() => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {
      invoke: (command: string) => (window as unknown as { remoteNativeProof: (name: string) => Promise<unknown> }).remoteNativeProof(command),
    } })
  })
  await page.goto('/e2e/remote-memory-proof.html')
  await page.getByRole('button', { name: 'Start proof remote session' }).click()
  await expect.poll(() => calls.includes('start_remote_server')).toBe(true)
  await page.getByRole('button', { name: 'Stop proof remote session' }).click()
  expect(calls).not.toContain('stop_remote_server')
  release()
  await expect(page.locator('#stop-result')).toHaveText('Stop completed')
  await expect(page.locator('#remote-state')).toHaveText('{"enabled":false,"qrVisible":false}')
  expect(calls.filter(command => command === 'stop_remote_server')).toHaveLength(1)
  expect(calls).not.toContain('remote_qr_code')
  expect(running).toBe(false)
})

test('reload revokes a native session that outlived the frontend', async ({ page }) => {
  // This mock lives outside the page, so a real reload discards Zustand but
  // intentionally retains the native-side session state and invocation log.
  let running = false
  const calls: string[] = []
  await page.exposeFunction('remoteNativeProof', async (command: string) => {
    calls.push(command)
    const status = { running, port: 11435, passcode: 'fixture', passcodeExpiresAt: 1, lanUrl: '', mobileUrl: '' }
    if (command === 'start_remote_server') { running = true; return status }
    if (command === 'remote_server_status') return status
    if (command === 'revoke_remote_memory') return null
    if (command === 'remote_qr_code') return { qr_png_base64: '', url: '', passcode: '' }
    throw new Error('Unsupported proof command')
  })
  await page.addInitScript(() => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {
      invoke: (command: string) => (window as unknown as { remoteNativeProof: (name: string) => Promise<unknown> }).remoteNativeProof(command),
    } })
  })
  await page.goto('/e2e/remote-memory-proof.html')
  await page.getByRole('button', { name: 'Start proof remote session' }).click()
  await expect(page.locator('#remote-state')).toContainText('"qrVisible":true')
  await page.reload()
  // The production app-mount hook must recover without opening settings.
  await expect(page.getByRole('status')).toContainText('Restart Remote Access and reconnect')
  expect(calls.filter(command => command === 'revoke_remote_memory')).toHaveLength(1)
  await expect(page.locator('#remote-state')).toHaveText('{"enabled":true,"qrVisible":false}')
})

for (const fail of [false, true]) {
  test(`actual sensitive control ${fail ? 'reports unconfirmed native failure' : 'requests Remote revocation'}`, async ({ page }, testInfo) => {
    await page.addInitScript(({ fail }) => {
      const calls: string[] = []
      Object.defineProperty(window, 'remoteProofCalls', { value: calls })
      Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {
        invoke: async (command: string) => {
          calls.push(command)
          if (fail && ['revoke_remote_memory', 'stop_remote_server'].includes(command)) throw new Error('Synthetic native failure')
          if (command === 'start_remote_server') return { port: 11435, passcode: 'fixture', passcodeExpiresAt: 1, lanUrl: '', mobileUrl: '' }
          if (command === 'remote_qr_code') return { qr_png_base64: '', url: '', passcode: '' }
          if (command === 'revoke_remote_memory') return null
          throw new Error('Unsupported proof command')
        },
      } })
    }, { fail })
    await page.goto('/e2e/remote-memory-proof.html')
    await page.getByRole('button', { name: 'Add Memory', exact: true }).click()
    await page.getByPlaceholder('What should I remember?').fill('Remote proof preference')
    await page.getByPlaceholder('Details… (required)').fill('Synthetic remembered preference')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByRole('button', { name: 'Start proof remote session' }).click()
    await expect(page.locator('#remote-state')).toContainText('"qrVisible":true')
    await page.getByLabel('Sensitive: exclude from AI requests').check()
    await expect(page.getByRole('status')).toContainText(fail ? 'could not be confirmed' : 'Restart Remote Access and reconnect')
    await expect(page.locator('#remote-state')).toHaveText('{"enabled":true,"qrVisible":false}')
    expect(await page.evaluate(() => (window as unknown as { remoteProofCalls: string[] }).remoteProofCalls)).toContain('revoke_remote_memory')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: testInfo.outputPath('remote-memory-notice.png'), fullPage: true })
  })
}
