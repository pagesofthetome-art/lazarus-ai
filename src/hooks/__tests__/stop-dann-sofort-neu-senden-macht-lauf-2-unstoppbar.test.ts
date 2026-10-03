/**
 * @vitest-environment jsdom
 *
 * Blocker 2 (review-lanes.md, Runde 3): Stop, dann sofort erneut senden auf
 * DERSELBEN Unterhaltung, macht den neuen Lauf unstoppbar.
 *
 * `activeAgentRuns` selbst war seit `25dd6a72` schon identitaetsgeprueft
 * (`if (activeAgentRuns.get(convId) === runState)`), aber drei Nachbarzeilen
 * im selben `finally` von `useAgentChat.ts` waren es nicht:
 * `useGenerationStore.getState().clearAborter(convId)`,
 * `useGenerationStore.getState().setGenerating(convId, false)` und
 * `drainApprovals(convId)`. Der Ablauf, den dieser Test nachstellt:
 *
 *   1. Lauf A startet, registriert seinen Abbrecher unter `convId` in
 *      `generationStore.aborters` (Zeile 784).
 *   2. Nutzer drueckt Stop. `stopAgent` bricht A's `AbortController` ab und
 *      loescht A sofort aus `activeAgentRuns`, aber NICHT aus
 *      `generationStore.aborters`, das raeumt erst A's eigenes `finally` auf.
 *   3. Nutzer sendet SOFORT neu, bevor A's `finally` gelaufen ist (unter
 *      Last braucht `endTurnDurably` 323-545 ms, siehe stores/durability.ts).
 *      Lauf B registriert SEINEN Abbrecher unter demselben `convId`,
 *      ueberschreibt A's Eintrag in `generationStore.aborters`.
 *   4. A's Stream fehlert jetzt erst wirklich (der abgebrochene Fetch
 *      schlaegt fehl), A's `finally` laeuft.
 *
 * Ohne Identitaetspruefung wischt A's `finally` in Schritt 4 B's gerade erst
 * registrierten Abbrecher weg (`clearAborter`) und dreht B's `generating`
 * zurueck auf false, obwohl B noch laeuft. Der reale Schaden: der Stop-Knopf
 * (`useChat.ts`'s `stopGeneration`, alle fuenf B1-Ausloeser gehen ueber
 * `generationStore.abortConversation`, das genau diesen Abbrecher aufruft)
 * findet fuer B keinen Abbrecher mehr und tut NICHTS. B laeuft unbezahlbar
 * weiter.
 *
 * Dieser Test faehrt exakt diesen Pfad: nach dem verspaeteten `finally` von A
 * muss B's Abbrecher noch da sein, B's `generating`-Flag muss noch true
 * sein, UND ein echter zweiter Stop (`useGenerationStore.abortConversation`,
 * derselbe Weg wie `stopAllBackgroundWork`/`stopGeneration`) muss B's
 * laufenden Fetch tatsaechlich abbrechen.
 *
 * Run: npx vitest run src/hooks/__tests__/stop-dann-sofort-neu-senden-macht-lauf-2-unstoppbar.test.ts
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
import { stopAllBackgroundWork } from '../../lib/background-shutdown'
import { toolRegistry, registerBuiltinTools } from '../../api/mcp'

const MODEL = 'openai::test-agent'

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
    // Real fetch rejects a request's stream when its AbortSignal fires; this
    // mock does not do that automatically (unlike the browser), so the test
    // controls the moment by hand instead; that IS the "verspaetetes
    // finally" window Blocker 2 describes, made deterministic.
    error(err: unknown) {
      controller.error(err)
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

describe('Stop, dann sofort neu senden auf derselben Unterhaltung', () => {
  it('das verspaetete finally von Lauf 1 raeumt Lauf 2s Abbrecher/generating nicht weg, und Stop auf Lauf 2 wirkt wirklich', async () => {
    const convA = seed()

    const streamA = controllableSSE()
    const streamB = controllableSSE()
    let callsA = 0
    let callsB = 0
    let bAbortSeen = false

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (!url.includes('/chat/completions')) return new Response('{}', { status: 200 })
      const body = String(init?.body ?? '')
      const asStream = (s: ReturnType<typeof controllableSSE>) =>
        new Response(s.readable, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      // 'task-2' FIRST: the resend carries the SAME conversation's history,
      // so its body contains BOTH 'task-1' (the earlier turn, still in the
      // transcript) and 'task-2' (the new one). Checking 'task-1' first
      // would wrongly route the resend into the already-locked streamA.
      if (body.includes('task-2')) {
        callsB++
        init?.signal?.addEventListener('abort', () => { bAbortSeen = true })
        return asStream(streamB)
      }
      if (body.includes('task-1')) {
        callsA++
        return asStream(streamA)
      }
      throw new Error('unexpected request body: ' + body.slice(0, 200))
    })

    const { result } = renderHook(() => useAgentChat())

    // Run 1: send, let it reach the point where it has registered its
    // aborter and is reading the stream.
    let runA!: Promise<void>
    await act(async () => {
      runA = result.current.sendAgentMessage('task-1')
      await tick()
      await tick()
    })
    expect(callsA).toBe(1)
    expect(useGenerationStore.getState().aborters[convA]).toBeDefined()

    // Stop run 1: deletes it from activeAgentRuns and aborts its
    // AbortController synchronously, but generationStore.aborters[convA]
    // still holds run 1's (now-stale) aborter; only run 1's OWN finally
    // clears that, and it has not run yet (the stream has not errored).
    let runB!: Promise<void>
    await act(async () => {
      result.current.stopAgent(convA)
      // Immediate resend on the SAME conversation, before run 1's finally
      // has had a chance to run.
      runB = result.current.sendAgentMessage('task-2')
      await tick()
      await tick()
    })
    expect(callsB).toBe(1)
    // Run 2 now owns the aborter slot.
    const aborterAfterResend = useGenerationStore.getState().aborters[convA]
    expect(aborterAfterResend).toBeDefined()
    expect(useGenerationStore.getState().generating[convA]).toBe(true)

    // NOW run 1's stream actually fails (the abort finally reaches the
    // fetch/reader), so its `finally` runs LATE, after run 2 is already
    // registered, the exact race Blocker 2 describes.
    await act(async () => {
      streamA.error(new DOMException('The operation was aborted.', 'AbortError'))
      await runA.catch(() => {})
      await tick()
      await tick()
    })

    // Run 2 must be untouched by run 1's late cleanup.
    expect(useGenerationStore.getState().aborters[convA]).toBe(aborterAfterResend)
    expect(useGenerationStore.getState().generating[convA]).toBe(true)

    // The real-world proof: a Stop now (via stopAllBackgroundWork, the exact
    // path sign-out/window-close/app-quit use, which reaches the run only
    // through generationStore.abortConversation) must actually reach run 2's
    // fetch.
    await act(async () => {
      stopAllBackgroundWork()
      await tick()
    })
    expect(bAbortSeen).toBe(true)
    expect(isRunStopped(convA)).toBe(true)

    // Let run 2 unwind so the test does not leave a dangling promise.
    await act(async () => {
      streamB.error(new DOMException('The operation was aborted.', 'AbortError'))
      await runB.catch(() => {})
      await tick()
    })
  })
})
