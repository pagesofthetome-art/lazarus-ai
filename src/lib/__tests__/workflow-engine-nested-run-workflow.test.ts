/**
 * ZWEITER GRAD der Verschachtelung: ein Arbeitsablauf-Schritt ruft selbst das
 * Werkzeug `run_workflow` auf, das intern eine ZWEITE `WorkflowEngine`
 * anlegt (`api/mcp/builtin-tools.ts:executeRunWorkflow`).
 *
 * Runde 4 (bau/review-w2lane.md) hat `runsInHeldLane` von einem reinen
 * Wahrheitswert auf die echte `HeldLocalLane`-Identitaet umgestellt, gegen
 * `holdsLocalLane()` geprueft. `WorkflowEngine.executeToolStep` reicht dafuer
 * `this.heldLocalLane` (den eigenen, echten Beweis dieses Laufs, gesetzt
 * sobald `run()` selbst admittiert wurde) an einen `run_workflow`-Schritt
 * weiter, als Feld eines eigens dafuer gebauten `AgentRunContext`
 * (`workflow-engine.ts`, `executeToolStep`, `runForTool`). Ohne dieses
 * Weiterreichen haette die INNERE Engine keinen Beweis gehabt und waere
 * hinter der AEUSSEREN in der Schlange gelandet, waehrend die aeussere auf
 * genau diesen inneren Aufruf wartet: dieselbe Verklemmung, die
 * `run-slot-nested-in-held-lane.test.ts` fuer den einfachen Fall zeigt, nur
 * einen Schritt tiefer.
 *
 * Dieser Test haengt die Kontrolle an `useMemoryStore.addMemory`: der innere
 * Arbeitsablauf hat genau einen `memory_save`-Schritt, und dessen Aufruf ist
 * der einzige Moment, in dem der Test von INNERHALB der zweiten Engine aus
 * beobachten kann, wer die lokale Spur gerade haelt.
 *
 * Lauf: npx vitest run src/lib/__tests__/workflow-engine-nested-run-workflow.test.ts
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { WorkflowEngine } from '../workflow-engine'
import { APPROVE_ALL } from '../../api/agents/tool-executor'
import { runInLane } from '../run-slot'
import { localLaneHolder, queuedRunIds, __resetRunLanesForTests } from '../run-lanes'
import { useGenerationStore } from '../../stores/generationStore'
import { useModelStore } from '../../stores/modelStore'
import { useMemoryStore } from '../../stores/memoryStore'
import { useAgentWorkflowStore } from '../../stores/agentWorkflowStore'
import { toolRegistry, registerBuiltinTools } from '../../api/mcp'
import type { AgentWorkflow, WorkflowStep, WorkflowEngineCallbacks } from '../../types/agent-workflows'

/** No prefix means Ollama (model-name.ts), and Ollama defaults to this
 *  machine in tests (`isOllamaLocal()` with no configured base), so this
 *  model name resolves to the LOCAL lane via `laneOf`. */
const LOCAL_MODEL = 'qwen3:8b'

function noteStep(id: string): WorkflowStep {
  return {
    id, type: 'memory_save', label: id,
    memorySave: { type: 'reference', titleTemplate: id, contentTemplate: 'x', tags: [] },
  }
}

function workflowOf(id: string, name: string, steps: WorkflowStep[]): AgentWorkflow {
  return { id, name, description: '', icon: 'Zap', steps, variables: {}, isBuiltIn: false, createdAt: 0, updatedAt: 0 }
}

function callbacks(): WorkflowEngineCallbacks {
  return {
    onStepStart: () => {}, onStepComplete: () => {}, onStepError: () => {},
    onWaitingForInput: () => {}, onComplete: () => {}, onError: () => {},
  }
}

beforeEach(() => {
  __resetRunLanesForTests()
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useModelStore.setState({ activeModel: LOCAL_MODEL })
  const inner = workflowOf('inner-id', 'inner', [noteStep('inner-step')])
  useAgentWorkflowStore.setState({ workflows: [inner] })
  registerBuiltinTools(toolRegistry)
})

describe('ein run_workflow-Schritt reicht den eigenen echten Beweis an die innere Engine weiter', () => {
  it('die innere Engine faehrt im Platz der aeusseren mit, statt sich dahinter anzustellen', async () => {
    let gesehenBeiInnererAusfuehrung: string | null = 'ungesehen'
    let schlangeBeiInnererAusfuehrung: string[] = ['ungesehen']
    vi.spyOn(useMemoryStore.getState(), 'addMemory').mockImplementation(() => {
      gesehenBeiInnererAusfuehrung = localLaneHolder()
      schlangeBeiInnererAusfuehrung = queuedRunIds()
      return 'mem-id'
    })

    const outer = workflowOf('outer-id', 'outer', [
      { id: 'call-inner', type: 'tool', label: 'call-inner', toolName: 'run_workflow', toolArgs: { name: 'inner' } },
    ])
    const engine = new WorkflowEngine(outer, 'wf-outer', callbacks(), APPROVE_ALL)
    const results = await engine.run()

    expect(results.map((r) => r.status)).toEqual(['completed'])
    // Waehrend der innere Schritt lief, hielt die AEUSSERE Konversation die
    // Spur, nicht 'tool-execution' (die conversationId, die die innere Engine
    // fuer sich selbst benutzt), genau der Mitfahr-Nachweis.
    expect(gesehenBeiInnererAusfuehrung).toBe('wf-outer')
    expect(schlangeBeiInnererAusfuehrung).toEqual([])
    expect(localLaneHolder()).toBeNull()
  })

  it('ein DRITTER, echt wartender Lauf stellt sich waehrenddessen hinter der AEUSSEREN Konversation an', async () => {
    vi.spyOn(useMemoryStore.getState(), 'addMemory').mockImplementation(() => 'mem-id')

    let dritterLief = false
    const outer = workflowOf('outer-id', 'outer', [
      { id: 'call-inner', type: 'tool', label: 'call-inner', toolName: 'run_workflow', toolArgs: { name: 'inner' } },
    ])
    const cb = callbacks()
    let dritterLauf: Promise<unknown> | undefined
    cb.onStepStart = () => {
      // Genau der Moment, in dem der aeussere Schritt (der run_workflow
      // aufruft) beginnt: ein dritter Aufrufer meldet sich jetzt an.
      dritterLauf = runInLane({ conversationId: 'dritter', lane: 'local' }, async () => { dritterLief = true })
    }
    const engine = new WorkflowEngine(outer, 'wf-outer', cb, APPROVE_ALL)
    await engine.run()
    await dritterLauf

    expect(dritterLief).toBe(true)
    expect(localLaneHolder()).toBeNull()
  })

  it('GEGENPROBE: ohne den weitergereichten Beweis (Cloud-Aufrufer) bucht die innere Engine unter ihrer eigenen Kennung', async () => {
    // Ein Cloud-Modell als aktives Modell: der AEUSSERE Lauf haelt gar keine
    // lokale Spur (`held` ist null fuer 'cloud'), die innere Engine bekommt
    // also `runsInHeldLane: null` und muss normal buchen. Das innere
    // Werkzeug selbst laeuft trotzdem lokal, wenn sein Schritt ein lokales
    // Modell braucht, hier reicht der Nachweis "bucht ueberhaupt, haengt
    // nicht", die Kennung ist dafuer gleichgueltig.
    useModelStore.setState({ activeModel: 'anthropic::claude' })
    vi.spyOn(useMemoryStore.getState(), 'addMemory').mockImplementation(() => 'mem-id')

    const outer = workflowOf('outer-id', 'outer', [
      { id: 'call-inner', type: 'tool', label: 'call-inner', toolName: 'run_workflow', toolArgs: { name: 'inner' } },
    ])
    const engine = new WorkflowEngine(outer, 'wf-outer', callbacks(), APPROVE_ALL)
    const results = await engine.run()

    expect(results.map((r) => r.status)).toEqual(['completed'])
    expect(localLaneHolder()).toBeNull()
  })
})
