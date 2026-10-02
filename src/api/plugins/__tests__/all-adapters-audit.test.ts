import { afterEach, describe, expect, it, vi } from 'vitest'
import { disconnectProviderAdapter, providerAdapters, connectProviderAdapter } from '../adapters'
import { toolRegistry } from '../../mcp'

const originalFetch = globalThis.fetch

afterEach(async () => {
  globalThis.fetch = originalFetch
  await Promise.all(Object.keys(providerAdapters).map(disconnectProviderAdapter))
  vi.restoreAllMocks()
})

describe('registered adapter contract audit', () => {
  it('connects every registered provider with a simulated successful provider response', async () => {
    globalThis.fetch = vi.fn(async (_input, init) => {
      const body = typeof init?.body === 'string' ? init.body : ''
      const data = body.includes('query') ? { data: { viewer: { id: 'user-1' }, me: { id: 'user-1' } } } : {}
      return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch

    const failures: string[] = []
    for (const providerId of Object.keys(providerAdapters)) {
      try {
        const connection = await connectProviderAdapter(providerId, { apiKey: `audit-${providerId}`, baseUrl: providerId === 'supabase' ? 'https://audit.supabase.co' : undefined })
        expect(connection.tools.length, providerId).toBeGreaterThan(0)
        for (const tool of connection.tools) expect(toolRegistry.getToolByName(tool.name)?.serverId).toBe(`plugin:${providerId}`)
      } catch (error) {
        failures.push(`${providerId}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    expect(failures).toEqual([])
  })
})
