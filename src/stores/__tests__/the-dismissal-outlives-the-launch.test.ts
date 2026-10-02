/**
 * @vitest-environment jsdom
 *
 * "Dismiss until next launch" was a promise the code stopped keeping in 2.5.9.
 *
 * The banner and its store were written together in ad29b2c0 (2026-04-19) and
 * the label was true then: the dismissal lived in memory only. Four months
 * later a3b05a44 made it persist, for a good reason recorded in that commit
 * body: the startup scan cleared the flag on every launch, so closing the
 * banner over an untouched stale model meant nothing at all. That commit
 * touched only the store. Nobody brought the button along, and for the whole
 * of 2.5.9 to 3.0.0 the app promised a notice would come back tomorrow and
 * then never showed it again.
 *
 * The store is the one that was right, so the label follows the store. What
 * the code really does is written out below, because "persisted" alone would
 * be as thin a description as "until next launch" was: it survives a restart,
 * AND a scan that finds the same stale set again leaves it dismissed, AND a
 * scan that finds a different one brings the banner back.
 *
 * Run: npx vitest run src/stores/__tests__/the-dismissal-outlives-the-launch.test.ts
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const KEY = 'locally-uncensored-model-health'

/** What zustand wrote under that key, or null when it wrote nothing. */
function persisted(): { state?: { dismissed?: boolean; staleModels?: string[] } } | null {
  const raw = localStorage.getItem(KEY)
  return raw ? JSON.parse(raw) : null
}

/** A fresh app start: forget every module, then import the store again, which
 *  is when zustand rehydrates it from the storage left behind. */
async function relaunch() {
  vi.resetModules()
  const mod = await import('../modelHealthStore')
  return mod.useModelHealthStore
}

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
})

describe('what the dismissal really does', () => {
  it('is written to disk, not just to memory', async () => {
    const store = await relaunch()
    store.getState().setStaleModels(['phi4:14b'])
    store.getState().dismiss()
    expect(persisted()?.state?.dismissed).toBe(true)
  })

  it('is still dismissed after a restart', async () => {
    const first = await relaunch()
    first.getState().setStaleModels(['phi4:14b'])
    first.getState().dismiss()

    const second = await relaunch()
    expect(second.getState().dismissed).toBe(true)
    expect(second.getState().staleModels).toEqual(['phi4:14b'])
  })

  it('survives the startup scan that finds the SAME stale model again', async () => {
    // The branch nothing covered, and the whole point of a3b05a44: the scan
    // runs once per launch, so an unconditional clear here is what made the
    // button decorative in the first place.
    const store = await relaunch()
    store.getState().setStaleModels(['phi4:14b'])
    store.getState().dismiss()
    store.getState().setStaleModels(['phi4:14b'])
    expect(store.getState().dismissed).toBe(true)
  })

  it('COUNTER-CHECK: a different stale model brings the banner back', async () => {
    const store = await relaunch()
    store.getState().setStaleModels(['phi4:14b'])
    store.getState().dismiss()
    store.getState().setStaleModels(['phi4:14b', 'hermes3:8b'])
    expect(store.getState().dismissed).toBe(false)
  })

  it('never persists a scan that was running when the app died', async () => {
    const store = await relaunch()
    store.setState({ scanning: true })
    store.getState().dismiss()
    expect(persisted()?.state).not.toHaveProperty('scanning')
    expect((await relaunch()).getState().scanning).toBe(false)
  })
})

describe('the button says that', () => {
  const banner = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../components/layout/StaleModelsBanner.tsx'),
    'utf8',
  )

  it('no longer promises the notice comes back next launch', () => {
    // Only inside a string the user reads. The comment above the button names
    // the old wording on purpose, so the match has to be the attribute.
    expect(banner).not.toMatch(/(aria-label|title)="Dismiss until next launch"/)
  })

  it('names the one thing that really brings it back', () => {
    expect(banner).toMatch(/title="Dismiss\. It comes back only when a different model goes stale\."/)
  })
})
