/**
 * Harter Befund von der Box, 20.09.2026 (bau/wfprogress.md): while a workflow
 * ran "Research Topic", `llama-server`'s /slots endpoint showed one request at
 * n_decoded 30090 / n_predict 31619 on a 32768-token context, and the run
 * ended with "Workflow stopped at step 3 of 6: The model returned no content
 * for this prompt step.": the model spent its ENTIRE output budget inside
 * <think> and never reached an answer. The cause: `executePromptStep`
 * (workflow-engine.ts) built its `provider.chatStream` / `chatWithTools` /
 * `streamProviderTurn` options from `temperature` and `contextWindow` ONLY,
 * with no `maxTokens` (so the OpenAI-compatible provider's own fallback,
 * `body.max_tokens = Math.min(headroom, 32768)`, asked for the entire
 * remaining context) and no `thinking` policy at all, so an "always thinks"
 * model (GLM-5.3, Flash, Qwen3.5, see memory index) reasoned at its own default
 * depth with the whole context to spend it in.
 *
 * The fix reuses the house's own answer to this exact failure:
 * `compact-run.ts`'s auto-compaction summarizer measured the SAME thing on
 * the SAME model family and asks for `thinking: false` outright, because its
 * call, like a workflow's prompt step, is a mechanical execution of an
 * instruction, not a conversation that benefits from visible deliberation. An
 * earlier version of this fix instead requested `thinking: true` for an
 * "always thinks" model (reasoning: "that is what the catalogue says"), which
 * a counter-check found makes the failure MORE likely under a bounded
 * `maxTokens`, not less: explicit full-depth reasoning burns the cap before
 * ever answering. `thinking: false` is what actually ships.
 *
 * This drives the REAL `WorkflowEngine` over a one-step prompt workflow with
 * a mocked provider that just records the options it received, so a
 * regression (someone drops a field again, or reintroduces `thinking: true`)
 * shows up as a wrong value here instead of a silent 13-minute run on the box.
 *
 * Run: npx vitest run src/lib/__tests__/workflow-prompt-step-output-policy.test.ts
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../agent-strategy', () => ({
  resolveToolCallingStrategy: vi.fn(),
}))

import { WorkflowEngine } from '../workflow-engine'
import { APPROVE_ALL } from '../../api/agents/tool-executor'
import { useModelStore } from '../../stores/modelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { resolveToolCallingStrategy } from '../agent-strategy'
import { DEFAULT_SETTINGS } from '../constants'
import { DEFAULT_PROMPT_STEP_MAX_TOKENS } from '../workflow-engine'
import type { AgentWorkflow, WorkflowEngineCallbacks, StepResult } from '../../types/agent-workflows'
import type { ChatOptions, ChatStreamChunk } from '../../api/providers/types'

const ALWAYS_THINKS_MODEL = 'openai::always-thinks-model'
const TOGGLE_MODEL = 'openai::toggle-model'

function onePromptWorkflow(): AgentWorkflow {
  return {
    id: 'wf-prompt', name: 'test prompt', description: '', icon: 'Zap',
    steps: [{ id: 'p', type: 'prompt', label: 'Summarize', prompt: 'say something', allowedTools: [] }],
    variables: {}, isBuiltIn: false, createdAt: 0, updatedAt: 0,
  }
}

function silentCallbacks(onProgress?: (i: number, text: string) => void): WorkflowEngineCallbacks {
  return {
    onStepStart: () => {},
    onStepComplete: () => {},
    onStepError: () => {},
    onWaitingForInput: () => {},
    onComplete: () => {},
    onError: () => {},
    onStepProgress: onProgress,
  }
}

beforeEach(() => {
  useModelStore.setState({
    models: [
      {
        name: ALWAYS_THINKS_MODEL,
        model: ALWAYS_THINKS_MODEL,
        size: 0,
        type: 'text',
        provider: 'openai',
        providerName: 'Test',
        thinkMode: 'always',
        effortLevels: ['low', 'medium', 'high'],
        effortDefault: 'medium',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      {
        name: TOGGLE_MODEL,
        model: TOGGLE_MODEL,
        size: 0,
        type: 'text',
        provider: 'openai',
        providerName: 'Test',
        thinkMode: 'toggle',
        effortLevels: ['low', 'medium', 'high'],
        effortDefault: 'medium',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    ],
    activeModel: ALWAYS_THINKS_MODEL,
  })
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS },
  })
})

describe('a prompt step asks for the SAME output-limit policy a normal chat/agent turn asks for', () => {
  it('passes thinking:false + the effort ladder + maxTokens to chatStream, not just temperature/contextWindow', async () => {
    let seenOptions: ChatOptions | undefined
    vi.mocked(resolveToolCallingStrategy).mockResolvedValue({
      strategy: 'native',
      modelToUse: ALWAYS_THINKS_MODEL,
      modelId: ALWAYS_THINKS_MODEL,
      providerId: 'openai',
      provider: {
        chatStream: (_model: string, _messages: unknown, options: ChatOptions) => {
          seenOptions = options
          return (async function* (): AsyncGenerator<ChatStreamChunk> {
            yield { content: 'a short answer', done: true }
          })()
        },
        chatWithTools: vi.fn(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    })

    const engine = new WorkflowEngine(onePromptWorkflow(), 'conv-a', silentCallbacks(), APPROVE_ALL)
    await engine.run()

    // NEGATIVKONTROLLE (bau/wfprogress.md): before the fix `executePromptStep`
    // sent only `{ temperature, contextWindow, signal }`, and every one of these
    // was `undefined`/absent, and the model reasoned at its own unbounded
    // default. See bau/wfprogress.md for the counted red count on the
    // pre-fix copy.
    expect(seenOptions).toBeDefined()
    // klein 3 (review-wfprogress.md): an "always thinks" model (thinkMode
    // 'always') must NOT be sent `thinking: false`, since openai-provider.ts's
    // own measurement is that 'none'/false stops nothing for such a model
    // and can cost MORE. This is the exact `canThinkAgent`/`thinkOpt`
    // pattern useAgentChat.ts already uses for a normal turn: an 'always'
    // (or 'never') model gets NO thinking wish at all (`undefined`); the
    // bounded maxTokens plus the honest no-content message (klein 4 test
    // below) catch the failure instead.
    expect(seenOptions!.thinking).toBeUndefined()
    expect(seenOptions!.effortLevels).toEqual(['low', 'medium', 'high'])
    expect(seenOptions!.effortDefault).toBe('medium')
    // reasoningEffort itself may be undefined (the user never touched the
    // composer's slider); what matters is the LADDER travels, which is what
    // lets the provider clamp onto a real rung instead of sending nothing.
    expect('reasoningEffort' in seenOptions!).toBe(true)
    // klein 1/2 (review-wfprogress.md, "der eigentliche Boxbefund"):
    // DEFAULT_SETTINGS.maxTokens is 0, and buildSamplingRequest omits the
    // field entirely at that default (it means "auto" everywhere else),
    // so a standard user who never touched the slider used to get an
    // UNBOUNDED request (the box's measured 31619 would recur) even after
    // thinking:false. The prompt step must now supply a real ceiling of
    // its own whenever the user has not set one.
    expect(seenOptions!.maxTokens).toBe(DEFAULT_PROMPT_STEP_MAX_TOKENS)
  })

  it('a "toggle" model (may or may not think) DOES get an explicit thinking:false, same as a normal turn', async () => {
    let seenOptions: ChatOptions | undefined
    useModelStore.setState({ activeModel: TOGGLE_MODEL })
    vi.mocked(resolveToolCallingStrategy).mockResolvedValue({
      strategy: 'native',
      modelToUse: TOGGLE_MODEL,
      modelId: TOGGLE_MODEL,
      providerId: 'openai',
      provider: {
        chatStream: (_model: string, _messages: unknown, options: ChatOptions) => {
          seenOptions = options
          return (async function* (): AsyncGenerator<ChatStreamChunk> {
            yield { content: 'a short answer', done: true }
          })()
        },
        chatWithTools: vi.fn(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    })

    const engine = new WorkflowEngine(onePromptWorkflow(), 'conv-a2', silentCallbacks(), APPROVE_ALL)
    await engine.run()

    expect(seenOptions!.thinking).toBe(false)
  })

  it('a chat with its own maxTokens override carries it onto the wire, same as a normal turn', async () => {
    let seenOptions: ChatOptions | undefined
    vi.mocked(resolveToolCallingStrategy).mockResolvedValue({
      strategy: 'native',
      modelToUse: ALWAYS_THINKS_MODEL,
      modelId: ALWAYS_THINKS_MODEL,
      providerId: 'openai',
      provider: {
        chatStream: (_model: string, _messages: unknown, options: ChatOptions) => {
          seenOptions = options
          return (async function* (): AsyncGenerator<ChatStreamChunk> {
            yield { content: 'ok', done: true }
          })()
        },
        chatWithTools: vi.fn(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    })
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, maxTokens: 512 } })

    const engine = new WorkflowEngine(onePromptWorkflow(), 'conv-b', silentCallbacks(), APPROVE_ALL)
    await engine.run()

    expect(seenOptions!.maxTokens).toBe(512)
  })
})

describe('klein 3: a streaming prompt step relays its growing answer', () => {
  it('onStepProgress fires with the cumulative text as chunks arrive', async () => {
    vi.mocked(resolveToolCallingStrategy).mockResolvedValue({
      strategy: 'native',
      modelToUse: ALWAYS_THINKS_MODEL,
      modelId: ALWAYS_THINKS_MODEL,
      providerId: 'openai',
      provider: {
        chatStream: () => (async function* (): AsyncGenerator<ChatStreamChunk> {
          yield { content: 'Tea ', done: false }
          yield { content: 'has a long history.', done: true }
        })(),
        chatWithTools: vi.fn(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    })

    const progress: Array<{ i: number; text: string }> = []
    const engine = new WorkflowEngine(
      onePromptWorkflow(), 'conv-c',
      silentCallbacks((i, text) => progress.push({ i, text })),
      APPROVE_ALL,
    )
    await engine.run()

    expect(progress.length).toBeGreaterThanOrEqual(2)
    expect(progress[0]).toEqual({ i: 0, text: 'Tea ' })
    expect(progress[progress.length - 1].text).toBe('Tea has a long history.')
  })

  it('Negativkontrolle: a step with no onStepProgress callback never throws (optional callback)', async () => {
    vi.mocked(resolveToolCallingStrategy).mockResolvedValue({
      strategy: 'native',
      modelToUse: ALWAYS_THINKS_MODEL,
      modelId: ALWAYS_THINKS_MODEL,
      providerId: 'openai',
      provider: {
        chatStream: () => (async function* (): AsyncGenerator<ChatStreamChunk> {
          yield { content: 'ok', done: true }
        })(),
        chatWithTools: vi.fn(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    })
    const engine = new WorkflowEngine(onePromptWorkflow(), 'conv-d', silentCallbacks(undefined), APPROVE_ALL)
    const results = await engine.run()
    expect(results[0].status).toBe('completed')
  })
})

describe('Stop reaches a running prompt step (AbortSignal bis zum fetch)', () => {
  it('the SAME AbortSignal object engine.cancel() aborts is the one handed to chatStream', async () => {
    let seenSignal: AbortSignal | undefined
    vi.mocked(resolveToolCallingStrategy).mockResolvedValue({
      strategy: 'native',
      modelToUse: ALWAYS_THINKS_MODEL,
      modelId: ALWAYS_THINKS_MODEL,
      providerId: 'openai',
      provider: {
        chatStream: (_model: string, _messages: unknown, options: ChatOptions) => {
          seenSignal = options.signal
          return (async function* (): AsyncGenerator<ChatStreamChunk> {
            // Real providers stop yielding once the signal aborts; this stub
            // checks the SAME thing the fetch layer checks, so a Stop that
            // never reached this call would leave `aborted` false here too.
            if (options.signal?.aborted) return
            yield { content: 'first chunk', done: false }
            engineHandle.cancel()
            if (options.signal?.aborted) return
            yield { content: ' second chunk should never arrive', done: true }
          })()
        },
        chatWithTools: vi.fn(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    })

    const stopped: unknown[] = []
    const callbacks: WorkflowEngineCallbacks = { ...silentCallbacks(), onStopped: (r) => stopped.push(r) }
    const engineHandle = new WorkflowEngine(onePromptWorkflow(), 'conv-e', callbacks, APPROVE_ALL)
    const results = await engineHandle.run()

    expect(seenSignal).toBeDefined()
    expect(seenSignal!.aborted).toBe(true)
    // The stream stopped at the FIRST chunk once cancel() fired mid-loop:
    // the second chunk's text never reached the step's output.
    expect(results[0]?.output ?? '').not.toContain('second chunk')
    // B1 (review-wfprogress.md): the step finished normally (non-empty
    // output, no error) DESPITE the abort, exactly the gap that used to
    // leave no terminal callback at all. `onStopped` must fire exactly once.
    expect(stopped).toHaveLength(1)
  })
})

describe('Denk-Inhalt reist nicht als Schrittergebnis weiter (bereits gefixt, gegengeprueft)', () => {
  it('<think>...</think> is stripped from the output before it becomes last_output', async () => {
    vi.mocked(resolveToolCallingStrategy).mockResolvedValue({
      strategy: 'native',
      modelToUse: ALWAYS_THINKS_MODEL,
      modelId: ALWAYS_THINKS_MODEL,
      providerId: 'openai',
      provider: {
        chatStream: () => (async function* (): AsyncGenerator<ChatStreamChunk> {
          yield { content: '<think>long internal reasoning nobody should see</think>the real answer', done: true }
        })(),
        chatWithTools: vi.fn(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    })
    const results: StepResult[] = []
    const engine = new WorkflowEngine(
      onePromptWorkflow(), 'conv-f',
      { ...silentCallbacks(), onComplete: (r) => results.push(...r) },
      APPROVE_ALL,
    )
    await engine.run()

    expect(results[0].output).toBe('the real answer')
    expect(results[0].output).not.toContain('think')
    expect(results[0].output).not.toContain('internal reasoning')
  })
})

describe('klein 4: ein Modell, das die ganze Ausgabelaenge im Denken verbraucht', () => {
  it('endet weiter mit der ehrlichen Fehlermeldung, nicht mit leerem "Erfolg"', async () => {
    // The exact shape the box measured: everything the model produced sat
    // inside <think>...</think>, and no real answer ever followed, because the
    // model ran out of output budget while still reasoning. thinking:false
    // (klein 4's own fix) lowers how OFTEN this happens; it cannot promise it
    // never happens on a model that ignores the wish entirely, so the step
    // must still fail honestly here rather than report a false completion.
    vi.mocked(resolveToolCallingStrategy).mockResolvedValue({
      strategy: 'native',
      modelToUse: ALWAYS_THINKS_MODEL,
      modelId: ALWAYS_THINKS_MODEL,
      providerId: 'openai',
      provider: {
        chatStream: () => (async function* (): AsyncGenerator<ChatStreamChunk> {
          yield { content: '<think>reasoning that never resolves into an answer, the model just runs out of budget here', done: true }
        })(),
        chatWithTools: vi.fn(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    })
    const results: StepResult[] = []
    const errors: string[] = []
    const engine = new WorkflowEngine(
      onePromptWorkflow(), 'conv-g',
      { ...silentCallbacks(), onStepError: (_i, e) => errors.push(e), onComplete: (r) => results.push(...r) },
      APPROVE_ALL,
    )
    await engine.run()

    expect(errors).toEqual(['The model returned no content for this prompt step.'])
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('failed')
    expect(results[0].output).toBe('')
  })
})
