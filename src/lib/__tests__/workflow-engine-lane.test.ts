/**
 * WorkflowEngine and the local lane (Folgeauftrag 1, review-lanes.md Runde 5;
 * Punkt a der Runde-3-Nachbesserung, bau/review-lanes.md "Runde 3 der
 * Pruefung").
 *
 * `executePromptStep` runs real inference (`chatStream`/`chatWithTools`/
 * `streamProviderTurn`) without ever booking the local lane. A workflow with
 * a local model step used to run right next to a local chat send on the same
 * one-slot engine, unbooked. `run()` now books ONCE for the whole run, not
 * once per step: booking per step would have a workflow's own later step
 * queue behind its own earlier step's still-open booking and lock the
 * workflow out of itself.
 *
 * Only condition/memory_save steps are used here, same choice as
 * workflow-engine-branching.test.ts: both are synchronous and need no
 * provider mock, so the test exercises the real booking path around the real
 * engine instead of a copy of it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { WorkflowEngine } from '../workflow-engine'
import { APPROVE_ALL } from '../../api/agents/tool-executor'
import { localLaneHolder, queuedRunIds, __resetRunLanesForTests } from '../run-lanes'
import { useGenerationStore } from '../../stores/generationStore'
import { useModelStore } from '../../stores/modelStore'
import { useMemoryStore } from '../../stores/memoryStore'
import type { AgentWorkflow, WorkflowStep, WorkflowEngineCallbacks } from '../../types/agent-workflows'

beforeEach(() => {
  __resetRunLanesForTests()
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  vi.spyOn(useMemoryStore.getState(), 'addMemory').mockImplementation(() => 'mem-id')
})

/** No prefix means Ollama (model-name.ts), and Ollama defaults to this
 *  machine in tests (`isOllamaLocal()` with no configured base), so this
 *  model name resolves to the LOCAL lane via `laneOf`. */
const LOCAL_MODEL = 'qwen3:8b'

function noteStep(id: string, content = 'x'): WorkflowStep {
  return {
    id, type: 'memory_save', label: id,
    memorySave: { type: 'reference', titleTemplate: id, contentTemplate: content, tags: [] },
  }
}

function workflowOf(steps: WorkflowStep[]): AgentWorkflow {
  return { id: 'wf', name: 'test', description: '', icon: 'Zap', steps, variables: {}, isBuiltIn: false, createdAt: 0, updatedAt: 0 }
}

function callbacks(onError: (e: string) => void = () => {}): WorkflowEngineCallbacks {
  return {
    onStepStart: () => {}, onStepComplete: () => {}, onStepError: () => {},
    onWaitingForInput: () => {}, onComplete: () => {}, onError,
  }
}

describe('einmal je Lauf, nicht je Schritt', () => {
  it('bucht die lokale Spur genau einmal fuer alle Schritte zusammen', async () => {
    useModelStore.setState({ activeModel: LOCAL_MODEL })
    const gesehen: Array<string | null> = []
    const steps = [noteStep('a'), noteStep('b'), noteStep('c')]
    // onStepStart feuert bei jedem der drei Schritte: der Halter darf sich
    // dabei kein einziges Mal aendern, sonst waere je Schritt neu gebucht
    // worden (und ein zweiter Schritt haette sich hinter dem ersten
    // angestellt, statt in derselben Buchung mitzulaufen).
    const cb = callbacks()
    cb.onStepStart = () => { gesehen.push(localLaneHolder()) }
    const engine = new WorkflowEngine(workflowOf(steps), 'wf-conv', cb, APPROVE_ALL)

    const laufend = engine.run()
    expect(localLaneHolder()).toBe('wf-conv')
    await laufend

    expect(gesehen).toEqual(['wf-conv', 'wf-conv', 'wf-conv'])
    expect(localLaneHolder()).toBeNull()
  })

  it('ein zweiter lokaler Lauf waehrenddessen stellt sich an, statt gleichzeitig zu rechnen', async () => {
    useModelStore.setState({ activeModel: LOCAL_MODEL })
    // Ein user_input-Schritt haelt den Lauf an, bis der Test ihn beantwortet,
    // sonst ist der synchrone memory_save-Schritt schon durch, bevor der
    // zweite Lauf ueberhaupt anstellt.
    const step: WorkflowStep = { id: 'warte', type: 'user_input', label: 'warte', userInputPrompt: 'weiter?' }
    const engine = new WorkflowEngine(workflowOf([step]), 'wf-conv', callbacks(), APPROVE_ALL)
    const laufend = engine.run()
    await Promise.resolve()

    const { runInLane } = await import('../run-slot')
    let zweiterLief = false
    const zweiterLauf = runInLane({ conversationId: 'anderer-chat', lane: 'local' }, async () => { zweiterLief = true })

    expect(zweiterLief).toBe(false)
    expect(queuedRunIds()).toEqual(['anderer-chat'])

    engine.provideUserInput('weiter')
    await laufend
    await zweiterLauf
    expect(zweiterLief).toBe(true)
  })
})

describe('Stop wirkt, wartend wie laufend', () => {
  it('ein WARTENDER Arbeitsablauf: Stop nimmt ihn aus der Schlange, kein Schritt laeuft an', async () => {
    useModelStore.setState({ activeModel: LOCAL_MODEL })
    const halter = { versprechen: undefined as unknown as Promise<void>, aufloesen: () => {} }
    halter.versprechen = new Promise((res) => { halter.aufloesen = res })

    const { runInLane } = await import('../run-slot')
    // Ein anderer lokaler Lauf haelt die Spur zuerst, damit der Arbeitsablauf
    // sich wirklich anstellen muss.
    const haltendeLauf = runInLane({ conversationId: 'haelt-die-spur', lane: 'local' }, async () => { await halter.versprechen })

    let stepLief = false
    const errors: string[] = []
    const cb = callbacks((e) => errors.push(e))
    cb.onStepStart = () => { stepLief = true }
    const engine = new WorkflowEngine(workflowOf([noteStep('a')]), 'wf-conv', cb, APPROVE_ALL)
    const laufend = engine.run()

    expect(queuedRunIds()).toEqual(['wf-conv'])
    // Stop auf den wartenden Arbeitsablauf: derselbe Weg wie bei jedem
    // anderen wartenden Lauf, `generationStore.abortConversation`.
    useGenerationStore.getState().abortConversation('wf-conv')

    const results = await laufend
    expect(stepLief).toBe(false)
    expect(results).toEqual([])
    expect(errors.join(' ')).toMatch(/Cancelled before it could start/)
    expect(queuedRunIds()).toEqual([])

    halter.aufloesen()
    await haltendeLauf
  })

  it('ein LAUFENDER Arbeitsablauf: Stop bricht ihn waehrend eines Schritts ab', async () => {
    useModelStore.setState({ activeModel: LOCAL_MODEL })
    // Der erste Schritt loest den Stop aus, bevor der zweite drankommt.
    let ersterGesehen = false
    const cb = callbacks()
    cb.onStepComplete = () => {
      if (!ersterGesehen) {
        ersterGesehen = true
        useGenerationStore.getState().abortConversation('wf-conv')
      }
    }
    const engine = new WorkflowEngine(workflowOf([noteStep('a'), noteStep('b'), noteStep('c')]), 'wf-conv', cb, APPROVE_ALL)
    const results = await engine.run()

    // Abgebrochen NACH dem ersten Schritt, VOR dem zweiten: die Abbruchpruefung
    // sitzt am Kopf der Schleife (`this.abortController.signal.aborted`).
    expect(results.map((r) => r.stepId)).toEqual(['a'])
    expect(localLaneHolder()).toBeNull()
  })
})
