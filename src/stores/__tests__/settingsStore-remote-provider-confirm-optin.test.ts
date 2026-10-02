import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { codexConfirmEnabled } from '../../hooks/codexShellGate'
import type { Settings } from '../../types/settings'

const backing = new Map<string, string>()
const localStorageShim = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => backing.delete(k),
  clear: () => backing.clear(),
  key: (i: number) => [...backing.keys()][i] ?? null,
  get length() { return backing.size },
} as Storage

const KEY = 'chat-settings'
const CURRENT = 24
const PRE_RENAME = 22
const EARLIER_BUILD = 20

function seed(settings: Record<string, unknown>, version: number) {
  backing.set(KEY, JSON.stringify({
    state: { settings, personas: [], activePersonaId: 'unrestricted', _version: version },
    version,
  }))
}

async function freshStore() {
  vi.resetModules()
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('localStorage', localStorageShim)
  const mod = await import('../settingsStore')
  return mod.useSettingsStore
}

describe('remote-provider confirmation preference migration', () => {
  beforeEach(() => backing.clear())
  afterEach(() => vi.unstubAllGlobals())

  it('keeps the new default off for profiles that only had the retired shell-confirm setting', async () => {
    seed({ codexCloudConfirmShell: true, temperature: 0.42 }, EARLIER_BUILD)
    const settings = (await freshStore()).getState().settings
    expect(settings.codexRemoteConfirmOptIn).toBe(false)
    expect(settings.temperature).toBe(0.42)
  })

  it('renames and preserves the previous remote confirmation choice', async () => {
    seed({ codexCloudConfirmOptIn: true }, PRE_RENAME)
    const settings = (await freshStore()).getState().settings as Settings & {
      codexCloudConfirmOptIn?: boolean
    }
    expect(settings.codexRemoteConfirmOptIn).toBe(true)
    expect(settings.codexCloudConfirmOptIn).toBeUndefined()
    expect(codexConfirmEnabled({ confirmShell: false, remoteOptIn: settings.codexRemoteConfirmOptIn, remoteProvider: true })).toBe(true)
  })

  it('drops the retired key from a current-version profile during rehydration', async () => {
    seed({ codexCloudConfirmOptIn: true }, CURRENT)
    const settings = (await freshStore()).getState().settings as Settings & {
      codexCloudConfirmOptIn?: boolean
    }
    expect(settings.codexCloudConfirmOptIn).toBeUndefined()
  })

  it('keeps false when the previous preference was off', async () => {
    seed({ codexCloudConfirmOptIn: false }, PRE_RENAME)
    const settings = (await freshStore()).getState().settings
    expect(settings.codexRemoteConfirmOptIn).toBe(false)
  })

  it('fresh profiles use the new opt-in default', async () => {
    const settings = (await freshStore()).getState().settings
    expect(settings.codexRemoteConfirmOptIn).toBe(false)
  })
})
