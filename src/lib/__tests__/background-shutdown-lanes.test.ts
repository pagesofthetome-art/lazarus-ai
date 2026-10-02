/**
 * Punkt 4 der Runde-3-Nachbesserung (bau/review-lanes.md "Runde 3 der
 * Pruefung"): eine laufende Erinnerungs-Extraktion ist seit `e034a14c`
 * abbrechbar. Dieser Test prueft, dass die ZWEI Wege aus Punkt 1
 * (`workflow-engine.ts` und der Hintergrund-Sub-Agent) bei
 * `stopAllBackgroundWork()` genauso wirklich enden, ein WARTENDER wie ein
 * LAUFENDER Fall von jedem, in einem gemeinsamen Test.
 *
 * `stopAllBackgroundWork` kennt weder Workflows noch Sub-Agenten als eigenen
 * Begriff, siehe background-shutdown.ts Kopf: sie erreicht beide ueber die
 * VIER generischen Quellen (`generationStore.generating`/`runs`,
 * `agentTaskStore.byConv`, `agentLoopStore.loops`). Fuer einen Lauf, der nur
 * bei der lokalen Spur angestellt (`runs`) oder als Hintergrundaufgabe
 * eingetragen ist (`agentTaskStore.byConv`), aber noch kein Token gezogen hat
 * (`generating` sieht ihn nicht), ist `runs` die einzige Quelle, die ihn
 * findet, siehe Runde 4 der Kopf-Notiz.
 *
 * Lauf: npx vitest run src/lib/__tests__/background-shutdown-lanes.test.ts
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { stopAllBackgroundWork } from '../background-shutdown'
import { WorkflowEngine } from '../workflow-engine'
import { APPROVE_ALL } from '../../api/agents/tool-executor'
import { buildDelegateExecutor, _setDepth, type SubAgentRunner } from '../../api/agents/sub-agent'
import { useAgentTaskStore } from '../../stores/agentTaskStore'
import { useGenerationStore } from '../../stores/generationStore'
import { useModelStore } from '../../stores/modelStore'
import { localLaneHolder, queuedRunIds, __resetRunLanesForTests } from '../run-lanes'
import type { AgentRunContext } from '../../api/agent-context'
import type { AgentWorkflow, WorkflowStep, WorkflowEngineCallbacks } from '../../types/agent-workflows'

const LOCAL_MODEL = 'qwen3:8b'

function makeRun(conversationId: string): AgentRunContext {
  return {
    token: 'run', chatId: null, conversationId, workspace: null,
    artifactMode: false, readOnlyShellTurn: false, mode: null, artifacts: [],
  }
}

async function takte(n = 20): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

beforeEach(() => {
  __resetRunLanesForTests()
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useAgentTaskStore.setState({ byConv: {} })
  useModelStore.setState({ activeModel: LOCAL_MODEL })
  _setDepth(0)
})

describe('stopAllBackgroundWork erreicht Workflow-Lauf UND Hintergrund-Sub-Agent', () => {
  it('ein LAUFENDER Workflow und ein dahinter WARTENDER Hintergrundagent enden beide', async () => {
    // ── Workflow haelt die Spur ──────────────────────────────────────────
    const waitStep: WorkflowStep = { id: 'warte', type: 'user_input', label: 'warte', userInputPrompt: '?' }
    const workflow: AgentWorkflow = {
      id: 'wf', name: 'test', description: '', icon: 'Zap', steps: [waitStep],
      variables: {}, isBuiltIn: false, createdAt: 0, updatedAt: 0,
    }
    const stepErrors: string[] = []
    const callbacks: WorkflowEngineCallbacks = {
      onStepStart: () => {}, onStepComplete: () => {},
      onStepError: (_i, e) => stepErrors.push(e),
      onWaitingForInput: () => {}, onComplete: () => {}, onError: () => {},
    }
    const engine = new WorkflowEngine(workflow, 'wf-conv', callbacks, APPROVE_ALL)
    const workflowLaufend = engine.run()
    await takte()
    expect(localLaneHolder()).toBe('wf-conv')

    // ── Hintergrund-Sub-Agent stellt sich dahinter an ────────────────────
    let subAgentLief = false
    const exec = buildDelegateExecutor((async () => { subAgentLief = true; return 'ok' }) as SubAgentRunner)
    await exec({ goal: 'wartend', background: true }, makeRun('conv-b'))
    const taskId = useAgentTaskStore.getState().forConv('conv-b')[0].id
    expect(queuedRunIds()).toEqual([taskId])

    // ── Ein Ausloeser, wie beim Abmelden/Fenster-schliessen/App-beenden ──
    stopAllBackgroundWork()
    await takte()

    // Der Workflow: sein `user_input`-Schritt loest per Abbruchsignal auf
    // und meldet "Cancelled", der Lauf endet, kein Schritt danach.
    const workflowResults = await workflowLaufend
    expect(workflowResults).toHaveLength(1)
    expect(workflowResults[0].status).toBe('failed')
    expect(stepErrors.join(' ')).toMatch(/Cancelled/)

    // Der Hintergrundagent: er stand nur in der Schlange, sein Rumpf lief nie.
    expect(subAgentLief).toBe(false)
    expect(useAgentTaskStore.getState().get(taskId)?.status).toBe('cancelled')

    // Die Spur ist komplett leer, kein Halter, keine Schlange, keine Buchung.
    expect(localLaneHolder()).toBeNull()
    expect(queuedRunIds()).toEqual([])
    expect(useGenerationStore.getState().runs).toEqual({})
  })
})
