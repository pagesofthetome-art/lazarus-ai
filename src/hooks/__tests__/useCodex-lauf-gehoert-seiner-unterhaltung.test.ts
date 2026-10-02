/**
 * @vitest-environment jsdom
 *
 * Nachbesserung 8 (review-lanes.md, Runde 3): dieser Test war ein reiner
 * Quelltextpin (Regex auf eine vollstaendige `for`-Schleifen-Zeile), der
 * Implementierungsdetails prueft statt Verhalten, und bei jedem harmlosen
 * Umbau der Schleifenbedingung rot wuerde, ohne dass etwas kaputt ist. Der
 * Bericht der vorigen Runde begruendete das mit "die Nachbardateien machen
 * es auch so", was der Pruefer zu Recht als keine Begruendung zurueckwies.
 *
 * Ersetzt durch einen echten Verhaltensbeweis fuer den Wiedereintritts-
 * Riegel, den Nachbesserung 5 dieser Runde in useCodex.ts nachgezogen hat
 * (`activeCodexRuns`, dieselbe Form wie `activeAgentRuns` in
 * useAgentChat.ts): ein Prompt, zweimal schnell hintereinander gesendet auf
 * DERSELBEN Unterhaltung, darf nur EINMAL tatsaechlich lossenden, und ein
 * Doppelklick OHNE bestehende Unterhaltung darf nur EINE Unterhaltung
 * erzeugen statt zwei.
 *
 * `resolveChatWorkspaceSlug` ist die erste echte Abhaengigkeit hinter dem
 * Riegel (Zeile ~428 in useCodex.ts, vor jedem Provider-/Speicher-Zugriff),
 * also der fruehestmoegliche Beobachtungspunkt: haelt der Riegel, wird sie
 * fuer den zweiten Aufruf nie erreicht.
 *
 * Run: npx vitest run src/hooks/__tests__/useCodex-lauf-gehoert-seiner-unterhaltung.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const slugCalls = { count: 0 }
vi.mock('../../api/workspace-slug', () => ({
  // Throws after counting: the guard is what this test proves, not the rest
  // of the send pipeline. A fast, deterministic failure here also exercises
  // the wrapping try/catch Nachbesserung 5 added around the whole body (the
  // safety net that keeps a thrown error from leaving the conversation
  // permanently locked out of sending).
  resolveChatWorkspaceSlug: async () => {
    slugCalls.count++
    throw new Error('workspace slug unavailable (test)')
  },
}))

import { useCodex } from '../useCodex'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useCodexStore } from '../../stores/codexStore'

function silenceUnhandled(p: Promise<unknown>) {
  p.catch(() => {})
  return p
}

beforeEach(() => {
  slugCalls.count = 0
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useCodexStore.setState({ sendsInFlight: 0, threads: {}, workingDirectory: '' })
  useModelStore.setState({ models: [], activeModel: 'ollama::qwen3:14b' })
})
afterEach(() => vi.restoreAllMocks())

describe('a Codex run in useCodex.ts is gated by its OWN conversation, not a shared hook-instance flag', () => {
  it('two fast sends on the SAME existing conversation only let the first one through', async () => {
    const { result } = renderHook(() => useCodex())
    const convId = useChatStore.getState().createConversation('ollama::qwen3:14b', '', 'codex')
    useChatStore.getState().setActiveConversation(convId)

    let p1!: Promise<unknown>
    let p2!: Promise<unknown>
    act(() => {
      p1 = silenceUnhandled(result.current.sendInstruction('first'))
      // Immediate second send, no await in between: the exact double-submit
      // shape (two Enters before React re-renders Send into Stop).
      p2 = silenceUnhandled(result.current.sendInstruction('second'))
    })
    await act(async () => { await Promise.allSettled([p1, p2]) })

    // Only the FIRST call ever reached past the guard.
    expect(slugCalls.count).toBe(1)
    // Still exactly one conversation: the second call did not create its own.
    expect(useChatStore.getState().conversations.length).toBe(1)
  })

  it('a double-click with NO existing conversation creates exactly ONE, not two', async () => {
    const { result } = renderHook(() => useCodex())
    expect(useChatStore.getState().activeConversationId).toBeNull()

    let p1!: Promise<unknown>
    let p2!: Promise<unknown>
    act(() => {
      p1 = silenceUnhandled(result.current.sendInstruction('first'))
      p2 = silenceUnhandled(result.current.sendInstruction('second'))
    })
    await act(async () => { await Promise.allSettled([p1, p2]) })

    expect(useChatStore.getState().conversations.length).toBe(1)
    expect(slugCalls.count).toBe(1)
  })

  it('COUNTER-CHECK: a run in a DIFFERENT conversation is not blocked by this one', async () => {
    const { result } = renderHook(() => useCodex())
    const convA = useChatStore.getState().createConversation('ollama::qwen3:14b', '', 'codex')
    useChatStore.getState().setActiveConversation(convA)

    let pA!: Promise<unknown>
    act(() => { pA = silenceUnhandled(result.current.sendInstruction('task-A')) })

    // Switch to a brand-new conversation B before A's send has settled.
    const convB = useChatStore.getState().createConversation('ollama::qwen3:14b', '', 'codex')
    useChatStore.getState().setActiveConversation(convB)

    let pB!: Promise<unknown>
    act(() => { pB = silenceUnhandled(result.current.sendInstruction('task-B')) })

    await act(async () => { await Promise.allSettled([pA, pB]) })

    // Both reached the same dependency: A's run in flight did not block B's.
    expect(slugCalls.count).toBe(2)
  })

  it('the guard does not leak: a failed send frees the conversation for the next one', async () => {
    const { result } = renderHook(() => useCodex())
    const convId = useChatStore.getState().createConversation('ollama::qwen3:14b', '', 'codex')
    useChatStore.getState().setActiveConversation(convId)

    await act(async () => {
      await result.current.sendInstruction('first').catch(() => {})
    })
    expect(slugCalls.count).toBe(1)

    // A second, later send on the SAME conversation must go through, the
    // wrapping try/catch Nachbesserung 5 added is exactly what keeps the
    // thrown error above from locking this conversation out forever.
    await act(async () => {
      await result.current.sendInstruction('second').catch(() => {})
    })
    expect(slugCalls.count).toBe(2)
  })
})
