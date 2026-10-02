/**
 * R9 (3.0.1): the JS-side contract for the three new keychain commands
 * (`secret_park_set`/`_get`/`_delete`, src-tauri/src/commands/secret.rs). Mocks
 * `@tauri-apps/api/core`'s `invoke` directly, same pattern as
 * local-fetch-cancel.test.ts, one level below providerStore.keychain.test.ts's
 * mock of the whole `api/backend` module.
 *
 * Run: npx vitest run src/api/__tests__/secret-park-commands.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

import { secretParkSet, secretParkGet, secretParkDelete } from '../backend'
import { isRecord } from '../../types/json-guards'

function tauriMode(on: boolean) {
  const existing: unknown = Reflect.get(globalThis, 'window')
  const w: Record<string, unknown> = isRecord(existing) ? existing : {}
  Reflect.set(globalThis, 'window', w)
  if (on) w.__TAURI_INTERNALS__ = {}
  else { delete w.__TAURI_INTERNALS__; delete w.__TAURI__ }
}

beforeEach(() => {
  vi.clearAllMocks()
  tauriMode(true)
})

afterEach(() => {
  tauriMode(false)
})

describe('secretParkSet', () => {
  it('calls secret_park_set with backendId (camelCase) and value', async () => {
    invokeMock.mockResolvedValue(undefined)
    await secretParkSet('lm-studio', 'sk-secret-value')
    expect(invokeMock).toHaveBeenCalledWith('secret_park_set', { backendId: 'lm-studio', value: 'sk-secret-value' })
  })

  it('rejects with "keychain unavailable" on the web build, without calling invoke', async () => {
    tauriMode(false)
    await expect(secretParkSet('lm-studio', 'sk-secret-value')).rejects.toThrow(/keychain unavailable/)
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('propagates a Rust refusal untouched (never rewrites the error text)', async () => {
    invokeMock.mockRejectedValue(new Error('refused: invalid backend id'))
    await expect(secretParkSet('BAD ID', 'sk-secret-value')).rejects.toThrow(/refused:/)
  })
})

describe('secretParkGet', () => {
  it('calls secret_park_get with backendId and returns the value', async () => {
    invokeMock.mockResolvedValue('sk-restored-value')
    const value = await secretParkGet('lm-studio')
    expect(invokeMock).toHaveBeenCalledWith('secret_park_get', { backendId: 'lm-studio' })
    expect(value).toBe('sk-restored-value')
  })

  it('returns null when nothing was parked', async () => {
    invokeMock.mockResolvedValue(null)
    expect(await secretParkGet('jan')).toBeNull()
  })

  it('rejects with "keychain unavailable" on the web build, without calling invoke', async () => {
    tauriMode(false)
    await expect(secretParkGet('lm-studio')).rejects.toThrow(/keychain unavailable/)
    expect(invokeMock).not.toHaveBeenCalled()
  })
})

describe('secretParkDelete', () => {
  it('calls secret_park_delete with backendId', async () => {
    invokeMock.mockResolvedValue(undefined)
    await secretParkDelete('lm-studio')
    expect(invokeMock).toHaveBeenCalledWith('secret_park_delete', { backendId: 'lm-studio' })
  })

  it('rejects with "keychain unavailable" on the web build, without calling invoke', async () => {
    tauriMode(false)
    await expect(secretParkDelete('lm-studio')).rejects.toThrow(/keychain unavailable/)
    expect(invokeMock).not.toHaveBeenCalled()
  })
})

describe('NEGATIVE CONTROL: the three commands stay on their own namespace', () => {
  it('never calls the plain secret_set/get/delete commands used by the four fixed slots', async () => {
    invokeMock.mockResolvedValue(null)
    await secretParkSet('lm-studio', 'x').catch(() => {})
    await secretParkGet('lm-studio').catch(() => {})
    await secretParkDelete('lm-studio').catch(() => {})
    const calledCommands = invokeMock.mock.calls.map((c) => c[0])
    expect(calledCommands).toEqual(['secret_park_set', 'secret_park_get', 'secret_park_delete'])
    expect(calledCommands).not.toContain('secret_set')
    expect(calledCommands).not.toContain('secret_get')
    expect(calledCommands).not.toContain('secret_delete')
  })
})
