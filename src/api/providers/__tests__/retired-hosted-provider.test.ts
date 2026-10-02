import { afterEach, describe, expect, it, vi } from 'vitest'
import { RetiredHostedProvider } from '../retired-hosted-provider'
import type { ProviderClient } from '../types'

afterEach(() => vi.restoreAllMocks())

describe('the legacy hosted provider tombstone', () => {
  it('fails closed before any network request and cannot list hosted models', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    const provider: ProviderClient = new RetiredHostedProvider()
    const stream = provider.chatStream('old-model', [{ role: 'user', content: 'hello' }])

    await expect(stream.next()).rejects.toMatchObject({ status: 410, code: 'retired' })
    expect(await provider.listModels()).toEqual([])
    expect(await provider.checkConnection()).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })
})
