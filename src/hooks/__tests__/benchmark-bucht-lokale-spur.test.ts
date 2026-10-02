/**
 * @vitest-environment jsdom
 *
 * Runde 4 (review-lanes.md Blocker 1+6, Schritt 1 "andere Verbraucher der
 * lokalen Spur"): `useBenchmark`'s `runBenchmark` fires the same
 * `provider.chatStream` a visible chat turn does, prompt after prompt,
 * straight against the model under test. Before this it was invisible to
 * `lib/run-lanes.ts`: a local chat conversation running at the same time as
 * a benchmark of a local model raced it for the same engine, the VRAM-swap
 * race the lane exists to prevent, just triggered from Settings instead of
 * the composer.
 *
 * This file proves the fix against the real `lib/run-lanes.ts` module
 * (nothing about admit/release/queue is mocked): a benchmark of a local
 * model queues behind an already-running local conversation and only starts
 * once that conversation releases; a benchmark of a cloud model starts
 * immediately, same as any other cloud run; and Stop on a still-queued
 * benchmark dequeues it instead of leaving it to fire later, unattended,
 * once its turn eventually comes.
 *
 * NEGATIVE CONTROL (run by hand on 18.09., reverted after, confirmed green
 * again): removed the `runInLane(...)` wrap and called the loop directly.
 * "a benchmark of a local model queues behind a running local conversation"
 * went red with `expected 'started' to be 'queued'` (the second admit no
 * longer had anything to queue behind, because the benchmark's own call
 * never registered with run-lanes.ts at all).
 *
 * Run: npx vitest run src/hooks/__tests__/benchmark-bucht-lokale-spur.test.ts
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBenchmark, BENCHMARK_LANE_ID } from '../useBenchmark'
import { useBenchmarkStore } from '../../stores/benchmarkStore'
import { admit, release, localLaneHolder, queuedRunIds, __resetRunLanesForTests } from '../../lib/run-lanes'

const chatStream = vi.fn(() => (async function* () {})())
let resolveMeasure: ((v: unknown) => void) | null = null

vi.mock('../../api/providers', () => ({
  getProviderForModel: (name: string) => ({
    provider: { chatStream },
    modelId: name.includes('::') ? name.split('::')[1] : name,
  }),
}))

vi.mock('../../lib/benchmark-run', () => ({
  measureRun: vi.fn(() => new Promise((resolve) => { resolveMeasure = resolve })),
}))

beforeEach(() => {
  __resetRunLanesForTests()
  useBenchmarkStore.setState({ results: {}, isRunning: false, currentModel: null, currentStep: 0, totalSteps: 0, error: null })
  chatStream.mockClear()
  resolveMeasure = null
})

describe('runBenchmark bucht die lokale Spur', () => {
  it('ein lokales Modell wartet, waehrend eine echte Unterhaltung die Spur haelt', async () => {
    // A real chat conversation holds the local lane already.
    admit('local', 'conv-chat', () => {})
    expect(localLaneHolder()).toBe('conv-chat')

    const { result } = renderHook(() => useBenchmark())
    let laufend: Promise<void> | undefined
    act(() => {
      laufend = result.current.runBenchmark('qwen3:8b')
    })
    await Promise.resolve()

    // The benchmark's own call queued instead of racing the running chat.
    expect(queuedRunIds()).toContain(BENCHMARK_LANE_ID)
    expect(chatStream).not.toHaveBeenCalled()

    // The chat finishes; the benchmark is promoted and starts firing prompts.
    // `release` only returns the next run's `start` thunk, the caller (here:
    // this test, standing in for the chat's own `runInLane`) has to call it.
    act(() => { release('conv-chat')?.() })
    for (let i = 0; i < 10; i++) await Promise.resolve()

    expect(chatStream).toHaveBeenCalled()
    resolveMeasure?.({ tokensPerSec: 1, timeToFirstToken: 1, totalTime: 1, totalTokens: 1, thinkTokens: 0, finishReason: 'stop', correct: true })
    act(() => { result.current.stopBenchmark() })
    await laufend
  })

  it('ein Cloud-Modell startet sofort, ohne auf die lokale Spur zu warten', async () => {
    admit('local', 'conv-chat', () => {})

    const { result } = renderHook(() => useBenchmark())
    let laufend: Promise<void> | undefined
    act(() => {
      laufend = result.current.runBenchmark('lu-cloud::some/model')
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(chatStream).toHaveBeenCalled()
    resolveMeasure?.({ tokensPerSec: 1, timeToFirstToken: 1, totalTime: 1, totalTokens: 1, thinkTokens: 0, finishReason: 'stop', correct: true })
    act(() => { result.current.stopBenchmark() })
    await laufend
    release('conv-chat')
  })

  it('Stop auf einem noch wartenden Benchmark nimmt ihn aus der Warteschlange', async () => {
    admit('local', 'conv-chat', () => {})

    const { result } = renderHook(() => useBenchmark())
    let laufend: Promise<void> | undefined
    act(() => {
      laufend = result.current.runBenchmark('qwen3:8b')
    })
    await Promise.resolve()
    expect(queuedRunIds()).toContain(BENCHMARK_LANE_ID)

    act(() => { result.current.stopBenchmark() })
    await laufend

    expect(queuedRunIds()).not.toContain(BENCHMARK_LANE_ID)
    expect(chatStream).not.toHaveBeenCalled()
    release('conv-chat')
  })
})
