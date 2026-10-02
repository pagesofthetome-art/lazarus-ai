import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_VERSION = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'), 'utf8'),
).version as string

/** Seed the app as an existing local-mode install with current release notes seen. */
export async function seedOnboardingDone(page: Page): Promise<void> {
  await page.addInitScript((version: string) => {
    window.localStorage.setItem(
      'chat-settings',
      JSON.stringify({ state: { settings: { onboardingDone: true, appMode: 'local' }, _version: 10 }, version: 10 }),
    )
    window.localStorage.setItem(
      'lu_release_notes',
      JSON.stringify({ state: { lastNotesVersion: version }, version: 0 }),
    )
  }, APP_VERSION)
}
