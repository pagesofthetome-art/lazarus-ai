/**
 * @vitest-environment jsdom
 *
 * Opus review, round 2, Blocker 6 (release blocker): `engineOptedOut` is new
 * in 3.0.1. A blob written by an older build has no such key at all, and the
 * plain `{ ...current, ...p }` merge left the fresh-install default `false`
 * standing for it, which is the ONE value that shows the missing-engine
 * notice. That moved Blocker 1's false positive from the new customer (round
 * 1) onto the EXISTING customer who actually receives the update: anyone who
 * picked Ollama or LM Studio on a build before 3.0.1 has `openai.managed:
 * false` with no `displaced.managed` in their real, already-saved blob,
 * exactly the shape a round-1 fix could not tell apart from the R13D
 * eviction. This measures the fix against the REAL store and REAL
 * localStorage, seeded with the shape `Onboarding.tsx`'s pre-3.0.1 Ollama
 * branch actually wrote, then rehydrated the way a real app restart does.
 *
 * Run: npx vitest run src/stores/__tests__/engine-opted-out-migration.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../api/providers/client-cache', () => ({ clearProviderCache: vi.fn() }))

import { useProviderStore } from '../providerStore'

const KEY = 'lu-providers'

function seed(state: Record<string, unknown>) {
  window.localStorage.setItem(KEY, JSON.stringify({ state, version: 1 }))
}

beforeEach(() => {
  window.localStorage.removeItem(KEY)
})
afterEach(() => {
  window.localStorage.removeItem(KEY)
})

describe('engineOptedOut backfill on a blob written before the flag existed', () => {
  it('(a) a real 3.0.0 Ollama blob with no engineOptedOut key: no notice, backfilled true', async () => {
    // The exact shape Onboarding.tsx's pre-3.0.1 Ollama branch left behind:
    // `setProviderConfig('openai', { enabled: false, managed: false })`
    // merged over the shipped default, no `engineOptedOut` key at all
    // because the field did not exist yet.
    seed({
      providers: {
        ollama: { id: 'ollama', name: 'Ollama', enabled: true, baseUrl: 'http://localhost:11434', apiKey: '', isLocal: true },
        openai: { id: 'openai', name: 'Lazarus Engine', enabled: false, baseUrl: 'http://127.0.0.1:8127/v1', apiKey: '', isLocal: true, managed: false },
        anthropic: { id: 'anthropic', name: 'Anthropic', enabled: false, baseUrl: 'https://api.anthropic.com', apiKey: '', isLocal: false },
        'lu-cloud': { id: 'lu-cloud', name: 'retired hosted service', enabled: false, baseUrl: 'https://models.example.invalid/v1', apiKey: '', isLocal: false },
      },
      hideBackendSelector: false,
      // No `engineOptedOut` key: this is what makes it a pre-3.0.1 blob.
    })
    await useProviderStore.persist.rehydrate()
    const state = useProviderStore.getState()
    expect(state.providers.openai.managed).toBe(false)
    expect(state.engineOptedOut).toBe(true)
  })

  it('(b) a blob with no engineOptedOut key but managed: true stays false: nothing to backfill, Lazarus Engine was never displaced', async () => {
    seed({
      providers: {
        ollama: { id: 'ollama', name: 'Ollama', enabled: false, baseUrl: 'http://localhost:11434', apiKey: '', isLocal: true },
        openai: { id: 'openai', name: 'Lazarus Engine', enabled: true, baseUrl: 'http://127.0.0.1:8127/v1', apiKey: '', isLocal: true, managed: true },
        anthropic: { id: 'anthropic', name: 'Anthropic', enabled: false, baseUrl: 'https://api.anthropic.com', apiKey: '', isLocal: false },
        'lu-cloud': { id: 'lu-cloud', name: 'retired hosted service', enabled: false, baseUrl: 'https://models.example.invalid/v1', apiKey: '', isLocal: false },
      },
      hideBackendSelector: false,
    })
    await useProviderStore.persist.rehydrate()
    expect(useProviderStore.getState().engineOptedOut).toBe(false)
  })

  it('(c) a blob WITH engineOptedOut: false and an evicted slot keeps firing: the real R13D case', async () => {
    // A 3.0.1 blob, written by a build that already knows the field, records
    // the true answer: the R13D eviction really happened, not a deliberate
    // pick. The backfill must not override an EXPLICIT false with true.
    seed({
      providers: {
        ollama: { id: 'ollama', name: 'Ollama', enabled: false, baseUrl: 'http://localhost:11434', apiKey: '', isLocal: true },
        openai: { id: 'openai', name: 'LM Studio', enabled: true, baseUrl: 'http://localhost:1234/v1', apiKey: '', isLocal: true, managed: false, displaced: { name: 'Jan', baseUrl: 'http://localhost:1337/v1', isLocal: true, managed: false } },
        anthropic: { id: 'anthropic', name: 'Anthropic', enabled: false, baseUrl: 'https://api.anthropic.com', apiKey: '', isLocal: false },
        'lu-cloud': { id: 'lu-cloud', name: 'retired hosted service', enabled: false, baseUrl: 'https://models.example.invalid/v1', apiKey: '', isLocal: false },
      },
      hideBackendSelector: false,
      engineOptedOut: false,
    })
    await useProviderStore.persist.rehydrate()
    expect(useProviderStore.getState().engineOptedOut).toBe(false)
  })

})
