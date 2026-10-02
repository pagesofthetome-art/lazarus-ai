/**
 * ZUSATZFRAGE / Auflage 6, bau/review-wfgate.md: alle drei eingebauten
 * Ablaeufe (Research Topic, Summarize URL, Code Review) beginnen mit einem
 * `user_input`-Schritt (built-in-workflows.ts:20,:59,:83). Beide Aufrufer
 * (builtin-tools.ts's `executeRunWorkflow`, useAgentChat.ts's Chat-Ausloeser)
 * setzen `onWaitingForInput: () => {}` und rufen `provideUserInput` nie, also
 * haengt jeder der drei am ersten Schritt, ein Aufloeser, den es nicht mehr
 * gibt. `run_workflow` legt sein eigenes `input`-Argument bereits als
 * `user_input`-Variable an (builtin-tools.ts's `initialVars`); dieser Test
 * belegt, dass die Engine das jetzt fuer den ERSTEN `user_input`-Schritt
 * konsumiert statt zu warten, und dass ein ZWEITER `user_input`-Schritt
 * weiterhin echt wartet (nur EIN vorbefuellter Wert existiert).
 *
 * Lauf: npx vitest run src/lib/__tests__/workflow-user-input-vorbefuellt.test.ts
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { WorkflowEngine } from '../workflow-engine'
import { APPROVE_ALL } from '../../api/agents/tool-executor'
import { __resetRunLanesForTests } from '../run-lanes'
import { useGenerationStore } from '../../stores/generationStore'
import { useModelStore } from '../../stores/modelStore'
import type { AgentWorkflow, WorkflowStep, WorkflowEngineCallbacks } from '../../types/agent-workflows'

function workflowOf(steps: WorkflowStep[]): AgentWorkflow {
  return { id: 'wf', name: 'test', description: '', icon: 'Zap', steps, variables: {}, isBuiltIn: false, createdAt: 0, updatedAt: 0 }
}

function callbacks(waiting: (i: number, p: string) => void = () => {}): WorkflowEngineCallbacks {
  return {
    onStepStart: () => {}, onStepComplete: () => {}, onStepError: () => {},
    onWaitingForInput: waiting, onComplete: () => {}, onError: () => {},
  }
}

beforeEach(() => {
  __resetRunLanesForTests()
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useModelStore.setState({ activeModel: 'anthropic::claude' })
})

describe('ein vorbefuellter user_input Wert wird vom ERSTEN Schritt konsumiert, kein Warten', () => {
  it('run_workflow-Stil: initialVariables.user_input erreicht den Schritt sofort, onWaitingForInput feuert nie', async () => {
    const waiting = vi.fn()
    const step: WorkflowStep = { id: 's1', type: 'user_input', label: 'Ask', userInputPrompt: 'What topic?' }
    const engine = new WorkflowEngine(
      workflowOf([step]), 'conv-prefill', callbacks(waiting), APPROVE_ALL,
      { user_input: 'quantum computing', last_output: 'quantum computing' },
    )

    const results = await engine.run()

    expect(waiting).not.toHaveBeenCalled()
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('completed')
    expect(results[0].output).toBe('quantum computing')
  })

  it('NEGATIVKONTROLLE: ohne initialVariables.user_input haengt der Schritt am Aufloeser (onWaitingForInput feuert, provideUserInput bleibt der einzige Weg weiter)', async () => {
    const waiting = vi.fn()
    const step: WorkflowStep = { id: 's1', type: 'user_input', label: 'Ask', userInputPrompt: 'What topic?' }
    const engine = new WorkflowEngine(workflowOf([step]), 'conv-no-prefill', callbacks(waiting), APPROVE_ALL)

    const laufend = engine.run()
    for (let i = 0; i < 20; i++) await Promise.resolve()
    expect(waiting).toHaveBeenCalledTimes(1)

    // Genau der Haenge-Zustand, den die ZUSATZFRAGE beschreibt: ohne einen
    // Aufrufer, der `provideUserInput` ruft, bliebe das Promise fuer immer
    // offen. Der Test loest selbst auf, um sich nicht wirklich aufzuhaengen,
    // aber demonstriert damit genau die Luecke.
    engine.provideUserInput('manually answered')
    const results = await laufend
    expect(results[0].output).toBe('manually answered')
  })

  it('ein ZWEITER user_input-Schritt wartet weiterhin echt: nur der ERSTE wird vorbefuellt', async () => {
    const waiting = vi.fn()
    const first: WorkflowStep = { id: 's1', type: 'user_input', label: 'Ask 1', userInputPrompt: 'First?' }
    const second: WorkflowStep = { id: 's2', type: 'user_input', label: 'Ask 2', userInputPrompt: 'Second?' }
    const engine = new WorkflowEngine(
      workflowOf([first, second]), 'conv-second', callbacks(waiting), APPROVE_ALL,
      { user_input: 'first-value' },
    )

    const laufend = engine.run()
    for (let i = 0; i < 20; i++) await Promise.resolve()

    // The first step consumed the prefill without calling onWaitingForInput;
    // the second has nothing left to consume and genuinely waits.
    expect(waiting).toHaveBeenCalledTimes(1)
    expect(waiting).toHaveBeenCalledWith(1, 'Second?')

    engine.provideUserInput('second-value')
    const results = await laufend

    expect(results).toHaveLength(2)
    expect(results[0].output).toBe('first-value')
    expect(results[1].output).toBe('second-value')
  })
})
