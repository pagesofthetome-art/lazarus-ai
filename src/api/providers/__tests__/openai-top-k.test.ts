/**
 * F3 (3.0.1, T4 Nebenfund): the sampling popup's top_k slider reached the
 * request body for local/self-hosted OpenAI-compatible endpoints for
 * temperature and top_p, but never for top_k, the field simply was not on
 * OpenAIChatRequest and nothing ever assigned it. The slider promised an
 * effect the server never saw.
 *
 * Run: npx vitest run src/api/providers/__tests__/openai-top-k.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ProviderConfig, ChatStreamChunk } from '../types'
import type { OpenAIChatRequest } from '../openai-provider'
import type { FetchArgs } from '../../__tests__/provider-test-support'

const streamBody = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n'

type CapturedInit = { method?: string; headers?: Record<string, string>; body?: string }

let sent: { url: string; body: OpenAIChatRequest }[]

function answer(url: string, init: CapturedInit) {
  if (typeof init.body !== 'string') throw new Error('request had no JSON body')
  const body = JSON.parse(init.body) as OpenAIChatRequest
  sent.push({ url, body })
  if (body.stream) return new Response(streamBody, { status: 200 })
  return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })
}

async function makeProvider(config: ProviderConfig) {
  vi.resetModules()
  sent = []
  vi.doMock('../../backend', () => ({
    localFetch: vi.fn(async (url: string, init: CapturedInit) => answer(url, init)),
    localFetchStream: vi.fn(async (url: string, init: CapturedInit) => answer(url, init)),
    backendCall: vi.fn(),
    isPrivateOrLanHost: (host: string) => host === 'localhost' || host === '127.0.0.1',
    isDirectFetchAllowed: () => true,
    hostnameOf: (url: string) => new URL(url).hostname,
    ensureProxyAllowsHost: vi.fn(),
    isTauri: () => false,
  }))
  vi.doMock('../../builtin-ensure', () => ({
    ensureBuiltinEngineAlive: vi.fn(),
    explainDeadEngine: (e: unknown) => e,
    explainEngineTransportMessage: (m: string) => m,
    isManagedBuiltinSlot: () => false,
  }))
  const mod = await import('../openai-provider')
  return new mod.OpenAIProvider(config)
}

const OWN_ENDPOINT: ProviderConfig = {
  id: 'openai', name: 'My Server', apiKey: '', enabled: true,
  baseUrl: 'http://127.0.0.1:5001/v1', isLocal: true,
}

async function drain(gen: AsyncGenerator<ChatStreamChunk>) {
  for await (const _ of gen) { /* the fetch only fires on the first next() */ }
}

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (url: FetchArgs[0], init: FetchArgs[1]) =>
      answer(String(url), { body: typeof init?.body === 'string' ? init.body : undefined }),
  )
})
afterEach(() => {
  vi.doUnmock('../../backend')
  vi.doUnmock('../../builtin-ensure')
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('F3: top_k reaches an own OpenAI-compatible endpoint', () => {
  it('chatStream sends top_k alongside temperature and top_p', async () => {
    const p = await makeProvider(OWN_ENDPOINT)
    await drain(p.chatStream('m', [{ role: 'user', content: 'hi' }], {
      temperature: 0.7, topP: 0.9, topK: 40,
    }))
    expect(sent[0].body.temperature).toBe(0.7)
    expect(sent[0].body.top_p).toBe(0.9)
    expect(sent[0].body.top_k).toBe(40)
  })

  it('chatWithTools sends top_k too, not just the streaming path', async () => {
    const p = await makeProvider(OWN_ENDPOINT)
    await p.chatWithTools('m', [{ role: 'user', content: 'hi' }], [], { topK: 20 })
    expect(sent[0].body.top_k).toBe(20)
  })

  it('omits the local-only top_k extension for remote OpenAI-compatible endpoints', async () => {
    const p = await makeProvider({ id: 'openai', name: 'Remote provider', apiKey: '', enabled: true, baseUrl: 'https://models.example.invalid/v1', isLocal: false })
    await drain(p.chatStream('m', [{ role: 'user', content: 'hi' }], { topK: 40 }))
    expect('top_k' in sent[0].body).toBe(false)
  })

  it('omits top_k entirely when the caller did not set it, same as top_p', async () => {
    const p = await makeProvider(OWN_ENDPOINT)
    await drain(p.chatStream('m', [{ role: 'user', content: 'hi' }], {}))
    expect('top_k' in sent[0].body).toBe(false)
  })
})
