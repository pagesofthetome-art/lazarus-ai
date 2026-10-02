/**
 * WACHHUND-TEST (Nachpruefung, bau/review-w2lane.md, Blocker 1 der Runde
 * nach `1c9d8043`): jeder Lauf, der die lokale Spur HAELT und selbst etwas
 * ABWARTET, muss SEINEN EIGENEN, gerade gueltigen `HeldLocalLane`-Beweis
 * weiterreichen, nie einen geerbten oder fehlenden. `run-slot.ts`s eigener
 * Rueckfall ("Beweis stimmt nicht -> normal buchen") ist nur dann kein
 * Haenger, wenn diese Regel an jeder Stelle eingehalten wird, die etwas
 * abwartet. Gemessen wurde das Gegenteil: der Hintergrund-Sub-Agent reichte
 * `{ ...run }` durch, also den laengst freigegebenen Beweis des Elternzugs,
 * an seinen eigenen `run_workflow`-Schritt weiter. Der Schritt bucht dann
 * normal unter `'tool-execution'`, waehrend der Sub-Agent selbst die Spur
 * unter seiner Aufgaben-Id haelt und auf genau diesen Schritt wartet:
 * derselbe Halter wartet auf sich selbst, fuer immer, bis zum Appneustart.
 *
 * Fuenf Wege, auf denen ein haltender Lauf etwas abwartet, jeder mit einer
 * Positivprobe, dass der EIGENE Beweis mitgeht:
 *
 *  1. Vordergrund-Sub-Agent (haelt selbst, reicht den eigenen Beweis an
 *     seinen Rumpf weiter).
 *  2. Hintergrund-Sub-Agent (bucht unter der eigenen Aufgaben-Id, reicht
 *     GENAU diese Identitaet weiter, nie die des Elternzugs).
 *  3. Workflow (zweiter Verschachtelungsgrad, ein Arbeitsablauf ruft
 *     `run_workflow` erneut).
 *  4. Workflow im Sub-Agenten (Blocker 1 selbst: der Rumpf eines
 *     Sub-Agenten ruft `run_workflow`).
 *  5. Sub-Agent im Workflow (ein Arbeitsablaufschritt ruft `delegate_task`
 *     im Vordergrund).
 *
 * Dazu eine GEGENPROBE, die die allgemeine Fehlerform direkt gegen
 * `run-slot.ts`/`toolRegistry` nachbaut: ohne einen gueltigen Beweis
 * verklemmt sich ein Halter, der auf einen zweiten Aufruf unter SEINER
 * EIGENEN Kennung wartet, tatsaechlich (der Test raeumt danach selbst auf,
 * statt wirklich fuer immer zu haengen).
 *
 * Lauf: npx vitest run src/lib/__tests__/heldLocalLane-wird-immer-weitergereicht.test.ts
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { runInLane, type HeldLocalLane } from '../run-slot'
import { localLaneHolder, queuedRunIds, __resetRunLanesForTests } from '../run-lanes'
import { useGenerationStore } from '../../stores/generationStore'
import { useModelStore } from '../../stores/modelStore'
import { useMemoryStore } from '../../stores/memoryStore'
import { useAgentWorkflowStore } from '../../stores/agentWorkflowStore'
import { useAgentTaskStore } from '../../stores/agentTaskStore'
import { toolRegistry, registerBuiltinTools } from '../../api/mcp'
import { WorkflowEngine } from '../workflow-engine'
import { APPROVE_ALL } from '../../api/agents/tool-executor'
import { buildDelegateExecutor, _setDepth, type SubAgentRunner } from '../../api/agents/sub-agent'
import type { AgentWorkflow, WorkflowStep, WorkflowEngineCallbacks } from '../../types/agent-workflows'
import type { AgentRunContext } from '../../api/agent-context'

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

function makeRun(conversationId: string, heldLocalLane: HeldLocalLane | null = null): AgentRunContext {
  return {
    token: 'run', chatId: null, conversationId, workspace: null,
    artifactMode: false, readOnlyShellTurn: false, mode: null, artifacts: [], heldLocalLane,
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
  registerBuiltinTools(toolRegistry)
  const inner = workflowOf('inner-id', 'inner', [noteStep('inner-step')])
  useAgentWorkflowStore.setState({ workflows: [inner] })
  vi.spyOn(useMemoryStore.getState(), 'addMemory').mockImplementation(() => 'mem-id')
})

describe('1) Vordergrund-Sub-Agent reicht seinen eigenen Beweis an seinen Rumpf weiter', () => {
  it('faehrt im Platz des haltenden Elternzugs mit, ohne eigene Buchung', async () => {
    let gesehenHeld: HeldLocalLane | null | undefined = 'ungesehen' as unknown as HeldLocalLane | null
    const runner: SubAgentRunner = async (_g, _c, { run }) => {
      gesehenHeld = run?.heldLocalLane ?? null
      return 'ok'
    }
    const exec = buildDelegateExecutor(runner)

    await runInLane({ conversationId: 'elternzug', lane: 'local' }, async (held) => {
      const antwort = await exec({ goal: 'x' }, makeRun('elternzug', held))
      expect(antwort).toBe('ok')
      // Waehrend der Sub-Agent lief, hielt weiterhin der Elternzug, keine
      // zweite Buchung, keine Warteschlange.
      expect(localLaneHolder()).toBe('elternzug')
      expect(queuedRunIds()).toEqual([])
    })

    expect(gesehenHeld).not.toBeNull()
    expect((gesehenHeld as HeldLocalLane).conversationId).toBe('elternzug')
    expect(localLaneHolder()).toBeNull()
  })
})

describe('2) Hintergrund-Sub-Agent reicht die eigene Aufgaben-Identitaet weiter, nie die des Elternzugs', () => {
  it('der eigene Beweis nennt die Aufgaben-Id, nicht die Konversation des Elternzugs', async () => {
    let gesehenHeld: HeldLocalLane | null | undefined = 'ungesehen' as unknown as HeldLocalLane | null
    const runner: SubAgentRunner = async (_g, _c, { run, taskId }) => {
      gesehenHeld = run?.heldLocalLane ?? null
      expect(taskId).toBeDefined()
      return 'ok'
    }
    const exec = buildDelegateExecutor(runner)
    // Der Elternzug traegt hier absichtlich EINEN Beweis fuer SEINE eigene
    // Konversation: der Hintergrundzweig darf ihn nicht durchreichen.
    const elternBeweis: HeldLocalLane = { conversationId: 'elternzug', identity: Symbol('eltern') }
    await exec({ goal: 'x', background: true }, makeRun('conv-a', elternBeweis))

    const id = useAgentTaskStore.getState().forConv('conv-a')[0].id
    await takte()

    expect(gesehenHeld).not.toBeNull()
    expect((gesehenHeld as HeldLocalLane).conversationId).toBe(id)
    expect((gesehenHeld as HeldLocalLane).conversationId).not.toBe('elternzug')
  })
})

describe('3) Workflow reicht den eigenen Beweis an einen zweiten run_workflow-Schritt weiter', () => {
  it('die zweite Engine faehrt im Platz der ersten mit, nicht unter tool-execution', async () => {
    let gesehenBeiInnererAusfuehrung: string | null = 'ungesehen' as unknown as string | null
    vi.spyOn(useMemoryStore.getState(), 'addMemory').mockImplementation(() => {
      gesehenBeiInnererAusfuehrung = localLaneHolder()
      return 'mem-id'
    })
    const outer = workflowOf('outer-id', 'outer', [
      { id: 'call-inner', type: 'tool', label: 'call-inner', toolName: 'run_workflow', toolArgs: { name: 'inner' } },
    ])
    const engine = new WorkflowEngine(outer, 'wf-outer', callbacks(), APPROVE_ALL)
    const results = await engine.run()

    expect(results.map((r) => r.status)).toEqual(['completed'])
    expect(gesehenBeiInnererAusfuehrung).toBe('wf-outer')
    expect(localLaneHolder()).toBeNull()
  })
})

describe('4) Workflow im Sub-Agenten: der Rumpf eines Sub-Agenten ruft run_workflow (Blocker 1)', () => {
  it('Hintergrund-Sub-Agent, dessen Rumpf run_workflow ruft, laeuft durch statt sich zu verklemmen', async () => {
    const runner: SubAgentRunner = async (_g, _c, { run }) => {
      return await toolRegistry.execute('run_workflow', { name: 'inner' }, 1, run)
    }
    const exec = buildDelegateExecutor(runner)
    await exec({ goal: 'ruft-workflow', background: true }, makeRun('conv-a'))
    const id = useAgentTaskStore.getState().forConv('conv-a')[0].id

    await takte(30)

    expect(useAgentTaskStore.getState().get(id)?.status).toBe('done')
    expect(localLaneHolder()).toBeNull()
    expect(queuedRunIds()).toEqual([])
  })

  it('Vordergrund-Sub-Agent, dessen Rumpf run_workflow ruft, faehrt ebenfalls mit', async () => {
    const runner: SubAgentRunner = async (_g, _c, { run }) => {
      return await toolRegistry.execute('run_workflow', { name: 'inner' }, 1, run)
    }
    const exec = buildDelegateExecutor(runner)

    await runInLane({ conversationId: 'elternzug', lane: 'local' }, async (held) => {
      const antwort = await exec({ goal: 'x' }, makeRun('elternzug', held))
      expect(antwort).not.toMatch(/^Error/)
      expect(localLaneHolder()).toBe('elternzug')
      expect(queuedRunIds()).toEqual([])
    })
    expect(localLaneHolder()).toBeNull()
  })
})

describe('5) Sub-Agent im Workflow: ein Arbeitsablaufschritt ruft delegate_task im Vordergrund', () => {
  it('der Schritt reicht dem delegate_task-Aufruf den eigenen Beweis des Arbeitsablaufs weiter', async () => {
    // `delegate_task` ist ein unantastbarer Builtin (tool-registry.ts
    // verweigert das Ueberschreiben eines Builtin-Namens), sein registrierter
    // Rumpf ruft echt ein Modell. Ein echter Modellzug ist hier nicht der
    // Punkt: geprueft wird ausschliesslich, WELCHEN `AgentRunContext`
    // `executeToolStep` fuer einen `delegate_task`-Schritt baut, also der
    // exakte Codepfad aus `workflow-engine.ts`, den Blocker 1 als fehlend
    // benannt hat (vorher nur fuer `run_workflow` gebaut, `delegate_task`
    // bekam `run: undefined`). `toolRegistry.execute` selbst wird dafuer
    // durch einen Spion ersetzt, der sofort antwortet.
    //
    // Cloud als aktives Modell: der Arbeitsablauf selbst haelt dann KEINE
    // lokale Spur (`laneOf` -> 'cloud'), `held` ist also `null`.
    useModelStore.setState({ activeModel: 'anthropic::claude' })
    let gesehenerRun: AgentRunContext | undefined = 'ungesehen' as unknown as AgentRunContext
    const spion = vi.spyOn(toolRegistry, 'execute').mockImplementation(
      async (name: string, _args, _depth, run?: AgentRunContext) => {
        if (name === 'delegate_task') { gesehenerRun = run; return 'sub-agent fertig' }
        return 'ok'
      },
    )

    const outer = workflowOf('outer-id', 'outer', [
      { id: 'call-agent', type: 'tool', label: 'call-agent', toolName: 'delegate_task', toolArgs: { goal: 'x' } },
    ])
    const engine = new WorkflowEngine(outer, 'wf-outer', callbacks(), APPROVE_ALL)
    const results = await engine.run()

    expect(results.map((r) => r.status)).toEqual(['completed'])
    expect(gesehenerRun).toBeDefined()
    expect(gesehenerRun?.conversationId).toBe('wf-outer')
    // Der Arbeitsablauf haelt hier keine lokale Spur (kein `activeModel`
    // umgestellt in diesem Test), `heldLocalLane` ist also `null`, aber es
    // ist ein EXPLIZITES `null` in einem echten `AgentRunContext`, nicht
    // `undefined` durch Fehlen des Feldes: genau der Unterschied, den
    // Blocker 1 ausgenutzt hat.
    expect(gesehenerRun?.heldLocalLane).toBeNull()
    spion.mockRestore()
  })

  it('unter einer lokal gehaltenen Spur faehrt der delegate_task-Schritt im selben Platz mit', async () => {
    let gesehenerRun: AgentRunContext | undefined
    const spion = vi.spyOn(toolRegistry, 'execute').mockImplementation(
      async (name: string, _args, _depth, run?: AgentRunContext) => {
        if (name === 'delegate_task') { gesehenerRun = run; return 'sub-agent fertig' }
        return 'ok'
      },
    )

    const outer = workflowOf('outer-id', 'outer', [
      { id: 'call-agent', type: 'tool', label: 'call-agent', toolName: 'delegate_task', toolArgs: { goal: 'x' } },
    ])
    const engine = new WorkflowEngine(outer, 'wf-outer', callbacks(), APPROVE_ALL)
    const results = await engine.run()

    expect(results.map((r) => r.status)).toEqual(['completed'])
    expect(gesehenerRun?.heldLocalLane).not.toBeNull()
    expect(gesehenerRun?.heldLocalLane?.conversationId).toBe('wf-outer')
    expect(localLaneHolder()).toBeNull()
    spion.mockRestore()
  })
})

describe('GEGENPROBE: ohne gueltigen Beweis verklemmt sich ein Halter, der auf sich selbst wartet', () => {
  it('run_workflow ohne den eigenen Beweis des Halters wartet ewig hinter sich selbst', async () => {
    let ranAn: string | undefined
    await runInLane({ conversationId: 'haelt-selbst', lane: 'local' }, async () => {
      // Absichtlich OHNE den `held`-Parameter zu verwenden, derselbe Fehler
      // wie im Code vor diesem Fix: kein Beweis, oder ein geerbter, der
      // 'haelt-selbst' nicht nachweist.
      const p = toolRegistry.execute('run_workflow', { name: 'inner' }, 1, undefined)
      void p.then((r) => { ranAn = r })
      await takte(10)

      // Der Werkzeugschritt wartet in der Schlange HINTER SICH SELBST: der
      // Halter ('haelt-selbst') ist derselbe Lauf, der gerade auf ihn wartet.
      expect(queuedRunIds()).toEqual(['tool-execution'])
      expect(ranAn).toBeUndefined()

      // Aufraeumen, damit der Test sauber endet statt wirklich fuer immer zu
      // haengen: den Wartenden aus der Schlange nehmen.
      useGenerationStore.getState().abortConversation('tool-execution')
      await p
      expect(ranAn).toMatch(/Cancelled before it could start/)
    })
    expect(localLaneHolder()).toBeNull()
  })
})
