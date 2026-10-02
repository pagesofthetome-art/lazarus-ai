/**
 * @vitest-environment jsdom
 *
 * B2 NEUER FUND: two conversations in AGENT mode, sending at once, must not
 * share ANY mutable state, AND neither may be silently dropped.
 *
 * useAgentChat.ts carried the same defect useChat.ts fixed in B2 Commit 1
 * (contentRef / thinkingRef / blocksRef as ONE set of refs per hook
 * instance, and the app mounts exactly one instance), plus an EXPLICIT
 * re-entry guard on top (`if (runningRef.current) return`, added 2026-06-16
 * against a real double-submit bug, see agent.duplicate_send_blocked). That
 * guard turned the same defect into a worse symptom for a SECOND, DIFFERENT
 * conversation: a running agent turn in conversation A made a send in
 * conversation B fail SILENTLY, no message, no error, the run simply never
 * started, instead of corrupting A's buffers.
 *
 * This test drives the real hook against two genuinely concurrent,
 * hand-interleaved SSE streams (the test controls exactly when each chunk
 * arrives), each carrying its own tool call (`todo_write`, the one builtin
 * that touches neither the Tauri side nor the network), and checks:
 *  1. B is not silently dropped by a still-running A (the re-entry guard).
 *  2. Neither conversation's stored message ever carries a text fragment or
 *     a tool-call block that could only have come from the other one.
 *
 * Run: npx vitest run src/hooks/__tests__/useAgentChat-zwei-agentenlaeufe-vermischen-nicht.test.ts
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
import { __resetRunStopsForTests } from '../../lib/run-stop'
import { toolRegistry, registerBuiltinTools } from '../../api/mcp'

const MODEL = 'lu-cloud::zai-org/GLM-5.3'

/**
 * A hand-driven SSE body: the test decides exactly when each chunk is
 * delivered, so text and tool-call deltas from two independent runs can be
 * genuinely interleaved instead of one call finishing before the next
 * starts (same shape as useChat-zwei-laeufe-vermischen-nicht.test.ts).
 */
function controllableSSE() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const readable = new ReadableStream<Uint8Array>({ start(c) { controller = c } })
  const enc = new TextEncoder()
  return {
    readable,
    pushContent(text: string) {
      controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`))
    },
    pushTool(id: string, args: object) {
      controller.enqueue(enc.encode(`data: ${JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0, id, type: 'function',
              function: { name: 'todo_write', arguments: JSON.stringify(args) },
            }],
          },
        }],
      })}\n\n`))
    },
    done() {
      controller.enqueue(enc.encode('data: [DONE]\n\n'))
      controller.close()
    },
  }
}

const finalTurn = (text: string) =>
  new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`,
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  )

/** Let pending microtasks (stream reads, tool execution) settle. */
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
    providers: { ...s.providers, 'lu-cloud': { ...s.providers['lu-cloud'], enabled: true } },
  }))
  useModelStore.setState({ models: [], activeModel: MODEL })
})
afterEach(() => vi.restoreAllMocks())

describe('two agent-mode runs on two conversations do not mix, and neither is dropped', () => {
  it("each conversation's own tool call and its own text arrive complete, and B is not silently blocked by A", async () => {
    const convA = seed()
    const convB = seed()

    const streamA1 = controllableSSE()
    const streamB1 = controllableSSE()
    let callsA = 0
    let callsB = 0

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (!url.includes('/chat/completions')) return new Response('{}', { status: 200 })
      const body = String(init?.body ?? '')
      if (body.includes('task-A')) {
        callsA++
        if (callsA === 1) {
          return new Response(streamA1.readable, { status: 200, headers: { 'content-type': 'text/event-stream' } })
        }
        return finalTurn('final-answer-A')
      }
      if (body.includes('task-B')) {
        callsB++
        if (callsB === 1) {
          return new Response(streamB1.readable, { status: 200, headers: { 'content-type': 'text/event-stream' } })
        }
        return finalTurn('final-answer-B')
      }
      throw new Error('unexpected request body: ' + body.slice(0, 200))
    })

    const { result } = renderHook(() => useAgentChat())

    await act(async () => {
      // Send in A, switch to B, send in B WHILE A IS STILL STREAMING: this is the
      // exact sequence the re-entry guard used to answer with silence.
      useChatStore.getState().setActiveConversation(convA)
      const runA = result.current.sendAgentMessage('task-A')
      useChatStore.getState().setActiveConversation(convB)
      const runB = result.current.sendAgentMessage('task-B')

      await tick()
      // Interleave content AND tool-call deltas across both runs, switching
      // the visible conversation back and forth in between: neither run may
      // read "the active conversation" for its own writes.
      useChatStore.getState().setActiveConversation(convA)
      streamA1.pushContent('Alpha-1 ')
      await tick()
      useChatStore.getState().setActiveConversation(convB)
      streamB1.pushContent('Bravo-1 ')
      await tick()
      // 'completed', not 'in_progress': an open plan item makes the agent
      // loop steer for another round (G16, lib/plan-reconcile.ts) before it
      // lets a text-only turn end the run; unrelated to what this test is
      // proving, and it would turn "2 model calls per conversation" into an
      // unpredictable number.
      streamA1.pushTool('call-A', { todos: [{ content: 'step-A', status: 'completed' }] })
      streamA1.done()
      await tick()
      streamB1.pushTool('call-B', { todos: [{ content: 'step-B', status: 'completed' }] })
      streamB1.done()

      await Promise.all([runA, runB])
      // The final content write is a coalesced requestAnimationFrame flush
      // (scheduleUIUpdate), not part of what the run's own promise awaits;
      // give it a tick to land before reading the store.
      await tick()
    })

    // 1) Neither run was silently dropped: both actually reached the model
    // and both actually ran their own tool call.
    expect(callsA).toBe(2)
    expect(callsB).toBe(2)
    expect(useTodoStore.getState().getTodos(convA)).toEqual([{ content: 'step-A', status: 'completed' }])
    expect(useTodoStore.getState().getTodos(convB)).toEqual([{ content: 'step-B', status: 'completed' }])

    // 2) Neither conversation's stored answer carries a fragment of the
    // other's text.
    const finalA = useChatStore.getState().conversations.find((c) => c.id === convA)!
    const finalB = useChatStore.getState().conversations.find((c) => c.id === convB)!
    const answerA = finalA.messages.find((m) => m.role === 'assistant' && !m.hidden)!.content
    const answerB = finalB.messages.find((m) => m.role === 'assistant' && !m.hidden)!.content

    expect(answerA).toContain('final-answer-A')
    expect(answerA).not.toContain('Bravo')
    expect(answerA).not.toContain('final-answer-B')
    expect(answerB).toContain('final-answer-B')
    expect(answerB).not.toContain('Alpha')
    expect(answerB).not.toContain('final-answer-A')

    // 3) The tool-call block landed on the assistant message it belongs to,
    // not on the other conversation's.
    const blocksA = finalA.messages.find((m) => m.role === 'assistant' && !m.hidden)!.agentBlocks ?? []
    const blocksB = finalB.messages.find((m) => m.role === 'assistant' && !m.hidden)!.agentBlocks ?? []
    const argsOf = (blocks: typeof blocksA) =>
      blocks.flatMap((b) => (b.toolCalls?.length ? b.toolCalls : b.toolCall ? [b.toolCall] : []))
        .map((c) => JSON.stringify(c.args))
    expect(argsOf(blocksA).some((a) => a.includes('step-A'))).toBe(true)
    expect(argsOf(blocksA).some((a) => a.includes('step-B'))).toBe(false)
    expect(argsOf(blocksB).some((a) => a.includes('step-B'))).toBe(true)
    expect(argsOf(blocksB).some((a) => a.includes('step-A'))).toBe(false)
  })
})
