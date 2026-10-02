// R9 (3.0.1): parking a displaced OpenAI-compatible API key in the OS
// keychain so it survives an app restart, instead of only the session-only
// `displaced.apiKey` field F3 built. Mocks `invoke` at the `api/backend`
// boundary (secretParkSet/Get/Delete), the same layer providerStore.keychain.test.ts
// mocks for the four fixed provider slots.
//
// Run: npx vitest run src/lib/__tests__/parked-key.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { secretParkSet, secretParkGet, secretParkDelete } = vi.hoisted(() => ({
  secretParkSet: vi.fn(),
  secretParkGet: vi.fn(),
  secretParkDelete: vi.fn(),
}))

vi.mock('../../api/backend', () => ({ secretParkSet, secretParkGet, secretParkDelete }))

import { slugifyBackendId, isKeychainMissing, parkApiKeyForBackend, restoreParkedApiKeyForBackend } from '../parked-key'

beforeEach(() => {
  secretParkSet.mockReset()
  secretParkGet.mockReset()
  secretParkDelete.mockReset()
})

describe('slugifyBackendId', () => {
  it('lowercases a plain name into a valid backend id', () => {
    expect(slugifyBackendId('LM Studio')).toBe('lm-studio')
  })

  it('collapses non [a-z0-9] runs into one hyphen and trims the ends', () => {
    expect(slugifyBackendId('  My. Custom / Server!! ')).toBe('my-custom-server')
  })

  it('truncates to 64 characters', () => {
    const long = 'a'.repeat(100)
    const id = slugifyBackendId(long)
    expect(id).not.toBeNull()
    expect(id!.length).toBeLessThanOrEqual(64)
  })

  it('is null for a name with nothing sluggable', () => {
    expect(slugifyBackendId('!!!')).toBeNull()
    expect(slugifyBackendId('')).toBeNull()
  })
})

describe('isKeychainMissing', () => {
  it('recognises both stub/test-switch strings secret.rs can return', () => {
    expect(isKeychainMissing(new Error('keychain unavailable (LAZARUS_NO_KEYCHAIN test mode)'))).toBe(true)
    expect(isKeychainMissing(new Error('keychain unsupported on this platform'))).toBe(true)
  })

  it('does not treat a refused backend id as a missing keychain', () => {
    expect(isKeychainMissing(new Error('refused: invalid backend id'))).toBe(false)
  })
})

describe('parkApiKeyForBackend', () => {
  it('parks the key under the slugified backend id and reports success', async () => {
    secretParkSet.mockResolvedValue(undefined)
    const ok = await parkApiKeyForBackend('LM Studio', 'sk-secret-value')
    expect(ok).toBe(true)
    expect(secretParkSet).toHaveBeenCalledWith('lm-studio', 'sk-secret-value')
  })

  it('reports failure, without throwing, when the keychain is unavailable', async () => {
    secretParkSet.mockRejectedValue(new Error('keychain unavailable (web build)'))
    const ok = await parkApiKeyForBackend('Jan', 'sk-secret-value')
    expect(ok).toBe(false)
  })

  it('reports failure, without throwing, when the backend id is refused', async () => {
    secretParkSet.mockRejectedValue(new Error('refused: invalid backend id'))
    const ok = await parkApiKeyForBackend('Jan', 'sk-secret-value')
    expect(ok).toBe(false)
  })

  it('does nothing when there is no key to park', async () => {
    const ok = await parkApiKeyForBackend('Jan', '')
    expect(ok).toBe(false)
    expect(secretParkSet).not.toHaveBeenCalled()
  })

  it('does nothing when the name has no valid slug', async () => {
    const ok = await parkApiKeyForBackend('!!!', 'sk-secret-value')
    expect(ok).toBe(false)
    expect(secretParkSet).not.toHaveBeenCalled()
  })
})

describe('restoreParkedApiKeyForBackend', () => {
  it('returns the parked value and deletes the entry afterwards', async () => {
    secretParkGet.mockResolvedValue('sk-restored-value')
    secretParkDelete.mockResolvedValue(undefined)
    const value = await restoreParkedApiKeyForBackend('LM Studio')
    expect(value).toBe('sk-restored-value')
    expect(secretParkGet).toHaveBeenCalledWith('lm-studio')
    expect(secretParkDelete).toHaveBeenCalledWith('lm-studio')
  })

  it('returns null, and never deletes, when nothing was parked', async () => {
    secretParkGet.mockResolvedValue(null)
    const value = await restoreParkedApiKeyForBackend('Jan')
    expect(value).toBeNull()
    expect(secretParkDelete).not.toHaveBeenCalled()
  })

  it('returns null when the keychain is unavailable, without throwing', async () => {
    secretParkGet.mockRejectedValue(new Error('keychain unsupported on this platform'))
    const value = await restoreParkedApiKeyForBackend('Jan')
    expect(value).toBeNull()
  })

  it('still returns the value even if the best-effort cleanup delete fails', async () => {
    secretParkGet.mockResolvedValue('sk-restored-value')
    secretParkDelete.mockRejectedValue(new Error('refused: invalid backend id'))
    const value = await restoreParkedApiKeyForBackend('LM Studio')
    expect(value).toBe('sk-restored-value')
  })
})

describe('NEGATIVE CONTROL: the key value never reaches a log call', () => {
  it('a refused park logs the backend id at most, never the api key', async () => {
    const logSpy = vi.fn()
    vi.doMock('../logger', () => ({ log: { error: logSpy, warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
    vi.resetModules()
    const { secretParkSet: freshSet } = await import('../../api/backend') as unknown as { secretParkSet: ReturnType<typeof vi.fn> }
    freshSet.mockRejectedValue(new Error('refused: invalid backend id'))
    const { parkApiKeyForBackend: freshPark } = await import('../parked-key')
    await freshPark('Jan', 'sk-should-never-be-logged')
    for (const call of logSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('sk-should-never-be-logged')
    }
    vi.doUnmock('../logger')
  })
})

describe('NEGATIVE CONTROL: without the keychain-missing guard, a refused id would be swallowed silently', () => {
  it('is distinguished from a real keychain absence, so a caller bug is not mistaken for "no keychain here"', () => {
    // If isKeychainMissing matched everything (the bug this guards against),
    // a `refused:` failure from an invalid backend id would be indistinguishable
    // from a genuinely absent keychain, hiding a real programming error behind
    // the ordinary, expected fallback path.
    const refused = new Error('refused: invalid backend id')
    const missing = new Error('keychain unavailable (LAZARUS_NO_KEYCHAIN test mode)')
    expect(isKeychainMissing(refused)).toBe(false)
    expect(isKeychainMissing(missing)).toBe(true)
  })
})
