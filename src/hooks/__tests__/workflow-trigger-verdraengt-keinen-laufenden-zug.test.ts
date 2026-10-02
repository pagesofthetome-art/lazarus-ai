/**
 * @vitest-environment jsdom
 *
 * bau/review-wfgate.md Runde 2, R2-1 (blockierend): the "run workflow
 * <name>" trigger registered its OWN `AgentRunState` in `activeAgentRuns`
 * BEFORE the standard re-entry guard (`activeAgentRuns.has(convId)`, further
 * down in `sendAgentMessage`) ever ran. A workflow message sent to a
 * conversation that already had a live agent turn running overwrote that
 * turn's entry: `stopAgent` then found only the workflow's `AgentRunState`,
 * and the displaced turn's own `finally` deleted ITS entry back out of the
 * map on completion, orphaning the running turn's abort handle entirely
 * (unreachable by Stop from that point on).
 *
 * This test drives a real streaming agent turn (task-A) via a controllable
 * SSE body, sends "run workflow ..." to the SAME conversation while it is
 * still streaming, and checks: the workflow is refused (no side effects, no
 * chat messages of its own), the ORIGINAL run stays the one entry in
 * `activeAgentRuns`, and it is still genuinely stoppable afterward (Stop
 * actually reaches the still-open SSE stream).
 *
 * Run: npx vitest run src/hooks/__tests__/workflow-trigger-verdraengt-keinen-laufenden-zug.test.ts
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

import { useAgentChat, __activeAgentRunConvIdsForTests } from '../useAgentChat'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProviderStore } from '../../stores/providerStore'
import { useAgentModeStore } from '../../stores/agentModeStore'
import { useAgentWorkflowStore } from '../../stores/agentWorkflowStore'
import { useAgentTaskStore } from '../../stores/agentTaskStore'
import { useAgentLoopStore } from '../../stores/agentLoopStore'
import { useGenerationStore } from '../../stores/generationStore'
import { useTodoStore } from '../../stores/todoStore'
import { useToolAuditStore } from '../../stores/toolAuditStore'
import { DEFAULT_SETTINGS } from '../../lib/constants'
import { __resetRunStopsForTests } from '../../lib/run-stop'
import { toolRegistry, registerBuiltinTools } from '../../api/mcp'
import { log } from '../../lib/logger'

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

function guardWorkflow() {
  return {
    id: 'guard-wf-r2-1',
    name: 'Guard Displace Workflow',
    description: '',
    icon: 'Zap',
    steps: [{ id: 's1', type: 'memory_save' as const, label: 'save', memorySave: { type: 'reference' as const, titleTemplate: 't', contentTemplate: 'c', tags: [] } }],
    variables: {},
    isBuiltIn: false,
    createdAt: 0,
    updatedAt: 0,
  }
}

beforeEach(() => {
  registerBuiltinTools(toolRegistry)
  __resetRunStopsForTests()
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useAgentTaskStore.setState({ byConv: {} })
  useAgentLoopStore.setState({ loops: {} })
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useAgentModeStore.setState({ agentModeActive: {} })
  useTodoStore.setState({ byConversation: {}, updatedAt: {} })
  useToolAuditStore.setState({ entries: {} })
  useAgentWorkflowStore.setState({ workflows: [guardWorkflow()] })
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS, cavemanMode: 'off' },
  })
  useProviderStore.setState((s) => ({
    providers: { ...s.providers, openai: { ...s.providers.openai, enabled: true } },
  }))
  useModelStore.setState({ models: [], activeModel: MODEL })
})
afterEach(() => vi.restoreAllMocks())

describe('R2-1: ein "run workflow" mitten in einem laufenden Agentenzug derselben Unterhaltung', () => {
  it('wird abgewiesen, ohne den laufenden Zug zu verdraengen, und der laeuft danach immer noch stoppbar', async () => {
    const convId = seed()
    const streamA = controllableSSE()
    let callsA = 0

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (!url.includes('/chat/completions')) return new Response('{}', { status: 200 })
      const body = String(init?.body ?? '')
      if (body.includes('task-A')) {
        callsA++
        return new Response(streamA.readable, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      }
      throw new Error('unexpected request body during this test: ' + body.slice(0, 200))
    })
    const logSpy = vi.spyOn(log, 'info')

    const { result } = renderHook(() => useAgentChat())

    let runA!: Promise<void>
    await act(async () => {
      runA = result.current.sendAgentMessage('task-A')
      await tick()
    })

    expect(callsA).toBe(1)
    expect(__activeAgentRunConvIdsForTests()).toEqual([convId])

    // NEGATIVKONTROLLE fuer R2-1 selbst: vor dem Fix haette dieser Aufruf
    // `activeAgentRuns.set(convId, workflowRunState)` OHNE Pruefung
    // ausgefuehrt und damit den laufenden Zug aus dem Register verdraengt.
    await act(async () => {
      await result.current.sendAgentMessage('run workflow Guard Displace Workflow')
      await tick()
    })

    expect(logSpy).toHaveBeenCalledWith('agent.duplicate_send_blocked', expect.objectContaining({ convId }))
    const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!
    expect(conv.messages.some((m) => m.content.includes('Running workflow'))).toBe(false)
    // Genau EIN Eintrag, und es ist immer noch der urspruengliche Zug, nicht
    // durch den Ablauf ersetzt worden.
    expect(__activeAgentRunConvIdsForTests()).toEqual([convId])

    // Stoppbarkeit: Stop muss den urspruenglichen, noch offenen SSE-Strom
    // wirklich erreichen, nicht einen verwaisten Griff.
    await act(async () => {
      result.current.stopAgent(convId)
      streamA.done()
      await runA
      await tick()
    })

    expect(__activeAgentRunConvIdsForTests()).toEqual([])
  })
})
