/**
 * @vitest-environment jsdom
 *
 * B2 Commit 5: stopAgent (and stopCodex) stop the CONVERSATION THE CALLER
 * NAMES, not whichever one happens to be active right now.
 *
 * Before this commit `stopAgent()` took no argument at all and always
 * re-read `useChatStore.getState().activeConversationId` itself. The one
 * caller in the app (`useChat.ts`'s `stopGeneration`) always meant the
 * active conversation anyway, so this was never observably wrong today,
 * but it made "which conversation gets stopped" an assumption baked into
 * `stopAgent`, not a fact its caller stated. This test proves the new,
 * explicit contract: passing a DIFFERENT conversation id than the active one
 * stops THAT one.
 *
 * Run: npx vitest run src/hooks/__tests__/stopAgent-nimmt-die-benannte-unterhaltung.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../api/cloud/supabase', () => ({
  getAccessToken: async () => 'session-token-abc',
}))
vi.mock('../../api/rag', () => ({
  retrieveContext: async () => ({ context: { chunks: [], query: '', documentIds: [] }, scoredChunks: [] }),
  generateEmbeddings: async () => [[0.1, 0.2]],
}))
vi.mock('../../lib/ttsBridge', () => ({ autoSpeak: () => {} }))
vi.mock('../../api/vram-handoff', () => ({ requestGenerationCancel: () => {} }))
vi.mock('../useMemory', () => ({
  useMemory: () => ({ extractAndSave: async () => {} }),
  extractMemoriesFromPair: async () => {},
}))

import { useAgentChat } from '../useAgentChat'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProviderStore } from '../../stores/providerStore'
import { useAgentModeStore } from '../../stores/agentModeStore'
import { useAgentTaskStore } from '../../stores/agentTaskStore'
import { useAgentLoopStore } from '../../stores/agentLoopStore'
import { useGenerationStore } from '../../stores/generationStore'
import { useTodoStore } from '../../stores/todoStore'
import { useToolAuditStore } from '../../stores/toolAuditStore'
import { DEFAULT_SETTINGS } from '../../lib/constants'
import { __resetRunStopsForTests, isRunStopped } from '../../lib/run-stop'

const MODEL = 'openai::test-agent'

const sse = (payload: object) =>
  new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`, {
    status: 200, headers: { 'content-type': 'text/event-stream' },
  })
const textZug = () => sse({ choices: [{ delta: { content: 'weiter beim naechsten Mal' } }] })

function seed(): string {
  const convId = useChatStore.getState().createConversation(MODEL, '')
  useChatStore.getState().setActiveConversation(convId)
  useAgentModeStore.getState().setAgentModeActive(convId, true)
  return convId
}

beforeEach(async () => {
  const { registerBuiltinTools, toolRegistry } = await import('../../api/mcp')
  registerBuiltinTools(toolRegistry)
  __resetRunStopsForTests()
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useAgentTaskStore.setState({ byConv: {} })
  useAgentLoopStore.setState({ loops: {} })
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useAgentModeStore.setState({ agentModeActive: {} })
  useTodoStore.setState({ byConversation: {}, updatedAt: {} })
  useToolAuditStore.setState({ entries: {} })
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS, cavemanMode: 'off' },
  })
  useProviderStore.setState((s) => ({
    providers: { ...s.providers, openai: {
      ...s.providers.openai,
      enabled: true,
      isLocal: false,
      managed: false,
      baseUrl: 'https://provider.test/v1',
    } },
  }))
  useModelStore.setState({ models: [], activeModel: MODEL })
})
afterEach(() => vi.restoreAllMocks())

describe('stopAgent(conversationId) stops the named run', () => {
  it('stops A by id while B is the active/visible conversation', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (!url.includes('/chat/completions')) return new Response('{}', { status: 200 })
      return textZug()
    })

    const { result } = renderHook(() => useAgentChat())
    const convA = seed()
    // useAgentChat has no slash parser of its own, that lives in
    // useChat.ts's sendMessage, which seeds `opts.loop` for pass 1. Passed
    // directly here, the same way that call site does.
    await act(async () => {
      await result.current.sendAgentMessage('zaehle weiter', undefined, {
        loop: { pass: 1, intervalMs: 1000, task: 'zaehle weiter', startedAt: Date.now() },
      })
    })
    expect(useAgentLoopStore.getState().loops[convA]).toBeDefined()

    const convB = seed() // switches the active conversation to B

    // Explicitly name A, even though B is the one currently visible.
    act(() => { result.current.stopAgent(convA) })

    expect(isRunStopped(convA)).toBe(true)
    expect(useAgentLoopStore.getState().loops[convA]).toBeUndefined()
    // B was never touched.
    expect(isRunStopped(convB)).toBe(false)
  })

  it('COUNTER-CHECK: omitting the id falls back to the active conversation, unchanged from before', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (!url.includes('/chat/completions')) return new Response('{}', { status: 200 })
      return textZug()
    })

    const { result } = renderHook(() => useAgentChat())
    const convA = seed()
    await act(async () => { await result.current.sendAgentMessage('/loop 1s zaehle weiter') })

    act(() => { result.current.stopAgent() })

    expect(isRunStopped(convA)).toBe(true)
  })
})
