import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const backing = new Map<string, string>()
const localStorageShim = {
  getItem: (key: string) => backing.get(key) ?? null,
  setItem: (key: string, value: string) => void backing.set(key, String(value)),
  removeItem: (key: string) => void backing.delete(key),
  clear: () => backing.clear(),
  key: (index: number) => [...backing.keys()][index] ?? null,
  get length() { return backing.size },
} as Storage

const KEY = 'chat-settings'
const CURRENT = 24

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

describe('settingsStore removes the retired product mode', () => {
  beforeEach(() => backing.clear())
  afterEach(() => vi.unstubAllGlobals())

  it('migrates older profiles and preserves unrelated settings', async () => {
    seed({ appMode: 'cloud', temperature: 0.42 }, CURRENT - 1)
    const store = await freshStore()
    expect(store.getState().settings.temperature).toBe(0.42)
    expect('appMode' in store.getState().settings).toBe(false)
  })

  it('strips a stale mode field even from a profile already at the current version', async () => {
    seed({ appMode: 'cloud', temperature: 0.61 }, CURRENT)
    const store = await freshStore()
    expect(store.getState().settings.temperature).toBe(0.61)
    expect('appMode' in store.getState().settings).toBe(false)
    const persisted = JSON.parse(backing.get(KEY)!) as { state: { settings: Record<string, unknown> } }
    expect('appMode' in persisted.state.settings).toBe(false)
  })

  it('still rebuilds built-in personas while migrating', async () => {
    seed({ appMode: 'cloud' }, CURRENT - 1)
    const store = await freshStore()
    expect(store.getState().personas.length).toBeGreaterThan(0)
    expect(store.getState().personas.some((persona) => persona.isBuiltIn)).toBe(true)
  })
})
