/**
 * @vitest-environment jsdom
 *
 * Runde 4 (review-lanes.md Blocker 1+6): useAgentChat.ts's sendAgentMessage
 * must run through `runInLane` on the local lane, same as plain chat. Two
 * conversations on the built-in engine (n_parallel=1) may not both fire a
 * request at once. The second must queue, show up in `queuedRunIds()`, and
 * only start once the first agent run is done.
 *
 * `laneOf`/`currentLaneFacts` are mocked to force the 'local' lane
 * regardless of model name, same technique as the useChat.ts sibling test.
 *
 * Run: npx vitest run src/hooks/__tests__/useAgentChat-lokale-spur-reiht-zweiten-agentenlauf-ein.test.ts
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
vi.mock('../../lib/run-lane-of-model', () => ({
  laneOf: () => 'local',
  currentLaneFacts: () => ({ openaiSlotIsLocal: true, ollamaBaseIsLocal: true }),
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
import { __resetRunStopsForTests } from '../../lib/run-stop'
import { __resetRunLanesForTests, localLaneHolder, queuedRunIds } from '../../lib/run-lanes'
import { toolRegistry, registerBuiltinTools } from '../../api/mcp'

const MODEL = 'openai::local-builtin-model'

function controllableSSE() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const readable = new ReadableStream<Uint8Array>({ start(c) { controller = c } })
  const enc = new TextEncoder()
  return {
    readable,
    pushContent(text: string) {
      controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`))
    },
    done() {
      controller.enqueue(enc.encode('data: [DONE]\n\n'))
      controller.close()
    },
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

function seed(): string {
  const convId = useChatStore.getState().createConversation(MODEL, '')
  useChatStore.getState().setActiveConversation(convId)
  useAgentModeStore.getState().setAgentModeActive(convId, true)
  return convId
}

beforeEach(() => {
  registerBuiltinTools(toolRegistry)
  __resetRunStopsForTests()
  __resetRunLanesForTests()
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
    providers: { ...s.providers, openai: { ...s.providers.openai, enabled: true } },
  }))
  useModelStore.setState({ models: [], activeModel: MODEL })
})
afterEach(() => vi.restoreAllMocks())

describe('sendAgentMessage reiht einen zweiten lokalen Agentenlauf ein', () => {
  it('die zweite Unterhaltung wartet sichtbar und startet erst nach der ersten', async () => {
    const convA = seed()
    const convB = seed()

    const streamA = controllableSSE()
    const streamB = controllableSSE()
    let callsA = 0
    let callsB = 0

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (!url.includes('/chat/completions')) return new Response('{}', { status: 200 })
      const body = String(init?.body ?? '')
      if (body.includes('task-A')) {
        callsA++
        return new Response(streamA.readable, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      }
      if (body.includes('task-B')) {
        callsB++
        return new Response(streamB.readable, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      }
      throw new Error('unexpected request body: ' + body.slice(0, 200))
    })

    const { result } = renderHook(() => useAgentChat())

    let runB!: Promise<void>
    await act(async () => {
      useChatStore.getState().setActiveConversation(convA)
      const runA = result.current.sendAgentMessage('task-A')
      await tick()

      expect(callsA).toBe(1)
      expect(localLaneHolder()).toBe(convA)

      useChatStore.getState().setActiveConversation(convB)
      runB = result.current.sendAgentMessage('task-B')
      await tick()

      // B queued instead of racing A for the built-in engine's one slot.
      expect(callsB).toBe(0)
      expect(queuedRunIds()).toEqual([convB])

      streamA.pushContent('final-answer-A')
      streamA.done()
      await runA
      await tick()

      // A released the lane; B's request goes out now.
      expect(callsB).toBe(1)
      expect(localLaneHolder()).toBe(convB)

      streamB.pushContent('final-answer-B')
      streamB.done()
      await runB
    })

    const finalA = useChatStore.getState().conversations.find((c) => c.id === convA)!
    const finalB = useChatStore.getState().conversations.find((c) => c.id === convB)!
    expect(finalA.messages.find((m) => m.role === 'assistant')!.content).toContain('final-answer-A')
    expect(finalB.messages.find((m) => m.role === 'assistant')!.content).toContain('final-answer-B')
    expect(localLaneHolder()).toBeNull()
    expect(queuedRunIds()).toEqual([])
  })
})
