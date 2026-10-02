/**
 * @vitest-environment jsdom
 *
 * Runde 4 (review-lanes.md Blocker 1+6): useCodex.ts's runInstruction (over
 * its sendInstruction wrapper) must run through `runInLane` on the local
 * lane, same as useChat.ts and useAgentChat.ts. Two Coding-Agent
 * conversations on the built-in engine (n_parallel=1) may not both reach
 * their provider call at once: the second must queue.
 *
 * `resolveChatWorkspaceSlug` is used as the gate, the same technique as
 * `useCodex-lauf-gehoert-seiner-unterhaltung.test.ts`: it is the first real
 * dependency behind the guard, so holding its promise open keeps a run's
 * body "in flight" (and so still holding the local lane) without having to
 * fake the entire provider/streaming pipeline underneath it.
 *
 * Run: npx vitest run src/hooks/__tests__/useCodex-lokale-spur-reiht-zweiten-lauf-ein.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

type Gate = { resolve: () => void; reject: (e: unknown) => void }
const gates: Gate[] = []
const slugCalls: string[] = []

vi.mock('../../api/workspace-slug', () => ({
  resolveChatWorkspaceSlug: vi.fn(async (convId: string) => {
    slugCalls.push(convId)
    await new Promise<void>((resolve, reject) => { gates.push({ resolve, reject }) })
    // Never actually resolves successfully in this test, rejecting is the
    // fastest, most deterministic way to end a run via the outer safety-net
    // catch (Nachbesserung 5, review-lanes.md) once the lane-admission
    // question has already been observed. What matters here is WHEN the
    // call happens, not what it returns.
    throw new Error('workspace slug unavailable (test)')
  }),
}))
vi.mock('../../lib/ttsBridge', () => ({ autoSpeak: () => {} }))
vi.mock('../../api/vram-handoff', () => ({ requestGenerationCancel: () => {} }))
vi.mock('../../lib/run-lane-of-model', () => ({
  laneOf: () => 'local',
  currentLaneFacts: () => ({ openaiSlotIsLocal: true, ollamaBaseIsLocal: true }),
}))

import { useCodex } from '../useCodex'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useCodexStore } from '../../stores/codexStore'
import { useGenerationStore } from '../../stores/generationStore'
import { __resetRunLanesForTests, localLaneHolder, queuedRunIds } from '../../lib/run-lanes'

const MODEL = 'openai::local-builtin-model'

function silenceUnhandled(p: Promise<unknown>) {
  p.catch(() => {})
  return p
}

const tick = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  gates.length = 0
  slugCalls.length = 0
  __resetRunLanesForTests()
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useCodexStore.setState({ sendsInFlight: 0, threads: {}, workingDirectory: '' })
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useModelStore.setState({ activeModel: MODEL })
})
afterEach(() => vi.restoreAllMocks())

describe('runInstruction reiht einen zweiten lokalen Coding-Lauf ein', () => {
  it('die zweite Unterhaltung erreicht ihre eigene Abhaengigkeit erst nach der ersten', async () => {
    const { result } = renderHook(() => useCodex())
    const convA = useChatStore.getState().createConversation(MODEL, '', 'codex')
    useChatStore.getState().setActiveConversation(convA)

    let pA!: Promise<unknown>
    act(() => { pA = silenceUnhandled(result.current.sendInstruction('task-A')) })
    await tick()

    // A holds the local lane and reached its own first real dependency.
    expect(slugCalls).toEqual([convA])
    expect(localLaneHolder()).toBe(convA)

    const convB = useChatStore.getState().createConversation(MODEL, '', 'codex')
    useChatStore.getState().setActiveConversation(convB)

    let pB!: Promise<unknown>
    act(() => { pB = silenceUnhandled(result.current.sendInstruction('task-B')) })
    await tick()

    // B queued behind A instead of racing it for the one local slot: its
    // own body never even started, so its dependency was never called.
    expect(slugCalls).toEqual([convA])
    expect(queuedRunIds()).toEqual([convB])

    // Let A's gate fail, so A's run ends (through the safety-net catch),
    // releasing the local lane.
    await act(async () => {
      gates[0].reject(new Error('workspace slug unavailable (test)'))
      await pA.catch(() => {})
      await tick()
    })

    // A released the lane; B's body now runs and reaches its own dependency.
    expect(slugCalls).toEqual([convA, convB])
    expect(localLaneHolder()).toBe(convB)

    await act(async () => {
      gates[1].reject(new Error('workspace slug unavailable (test)'))
      await pB.catch(() => {})
      await tick()
    })

    expect(localLaneHolder()).toBeNull()
    expect(queuedRunIds()).toEqual([])
  })
})
