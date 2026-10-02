/**
 * C10 (Testfenster-Bericht 34501513, e2e/testfenster/BERICHT.md): the "No
 * refusals" mark never showed for cloud models in the desktop picker.
 *
 * Cause: `toModelEntry()` in `../openai-provider.ts` copied provider metadata
 * from the raw `/v1/models` row into the intermediate `OpenAIModelEntry`,
 * but not `unfiltered`. Every reader downstream
 * (`listModels()` itself, then `lib/provider-model-row.ts`, then
 * `ModelRowMarks.tsx`) already read `m.unfiltered`, so the value was
 * `undefined` at every one of those places, not just the mark.
 *
 * This test drives the real adapter path (`provider.listModels()`), the same
 * This guards the real adapter path so a future literal that rebuilds the row
 * and drops a field again fails before it reaches the picker.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAIProvider } from '../openai-provider'

vi.mock('../../backend', () => ({
  localFetch: vi.fn(async () => new Response('{}', { status: 404 })),
  localFetchStream: vi.fn(), isPrivateOrLanHost: () => false,
  isDirectFetchAllowed: () => true, hostnameOf: (url: string) => new URL(url).hostname,
  ensureProxyAllowsHost: vi.fn(), backendCall: vi.fn(), isTauri: () => false,
}))

const base = 'https://models.example.invalid/v1'
const provider = () => new OpenAIProvider({
  id: 'openai', name: 'Test provider', enabled: true, isLocal: false, apiKey: '', baseUrl: base,
})

afterEach(() => vi.unstubAllGlobals())

describe('unfiltered through the real provider adapter', () => {
  it('full and partial both reach the model row', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: [
        { id: 'model-full', name: 'Full', unfiltered: 'full' },
        { id: 'model-partial', name: 'Partial', unfiltered: 'partial' },
      ],
    }))))
    const models = await provider().listModels()
    expect(models.find((m) => m.id === 'model-full')?.unfiltered).toBe('full')
    expect(models.find((m) => m.id === 'model-partial')?.unfiltered).toBe('partial')
  })

  it('a garbage value is dropped, not passed through', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: 'model-garbage', name: 'Garbage', unfiltered: 'nonsense' }],
    }))))
    const models = await provider().listModels()
    expect(models.find((m) => m.id === 'model-garbage')?.unfiltered).toBeUndefined()
  })

  it('a missing field stays undefined, nothing is invented', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: 'model-none', name: 'None' }],
    }))))
    const models = await provider().listModels()
    expect(models.find((m) => m.id === 'model-none')?.unfiltered).toBeUndefined()
  })
})
