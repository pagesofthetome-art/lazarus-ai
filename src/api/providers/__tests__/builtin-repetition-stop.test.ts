import { afterEach, describe, expect, it, vi } from 'vitest'

const transport = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('../../backend', () => ({
  localFetch: vi.fn(async () => new Response('{}', { status: 404 })),
  localFetchStream: (...args: unknown[]) => transport.fetch(...args),
  isPrivateOrLanHost: () => true,
  isDirectFetchAllowed: () => true,
  hostnameOf: (url: string) => new URL(url).hostname,
  ensureProxyAllowsHost: vi.fn(), backendCall: vi.fn(), isTauri: () => false,
}))
vi.mock('../../builtin-ensure', () => ({
  ensureBuiltinEngineAlive: vi.fn(), explainDeadEngine: (e: unknown) => e,
  explainEngineTransportMessage: (s: string) => s, isManagedBuiltinSlot: () => false,
}))

import { OpenAIProvider } from '../openai-provider'

afterEach(() => vi.clearAllMocks())

describe('built-in provider stops broken decoding at the transport', () => {
  it.each(['content', 'reasoning_content'])('aborts endless %s without waiting for EOF', async field => {
    let signal: AbortSignal | undefined
    transport.fetch.mockImplementation(async (_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined
      return new Response(new ReadableStream({
        start(controller) {
          const event = JSON.stringify({ choices: [{ delta: { [field]: '?'.repeat(256) } }] })
          controller.enqueue(new TextEncoder().encode(`data: ${event}\n\n`))
          signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true })
        },
      }))
    })
    const provider = new OpenAIProvider({
      id: 'openai', name: 'Built-in Engine', enabled: true, apiKey: '',
      baseUrl: 'http://127.0.0.1:8127/v1', isLocal: true, managed: true,
    })
    const run = async () => {
      for await (const chunk of provider.chatStream('test-local-model', [{ role: 'user', content: 'Hello' }])) {
        expect(chunk.content).not.toContain('?'.repeat(256))
      }
    }
    await expect(run()).rejects.toThrow('Generation stopped because the local model repeated question marks continuously.')
    expect(signal?.aborted).toBe(true)
    expect(transport.fetch).toHaveBeenCalledTimes(1)
  })
})
