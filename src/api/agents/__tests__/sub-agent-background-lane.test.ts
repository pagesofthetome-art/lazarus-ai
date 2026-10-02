/**
 * Der Hintergrund-Sub-Agent (`delegate_task` mit `background: true`) und die
 * lokale Spur (Punkt b der Runde-3-Nachbesserung, bau/review-lanes.md "Runde
 * 3 der Pruefung"; Folgeauftrag 2, review-lanes.md).
 *
 * `void runner(...)` ueberlebt seinen Elternzug: er darf deshalb NICHT im
 * gehaltenen Platz des Elternlaufs mitfahren (der ist beim Rueckkehren aus
 * `buildDelegateExecutor` schon lange wieder frei), sondern braucht eine
 * EIGENE Buchung unter einer EIGENEN Identitaet, die Aufgaben-Id, nicht die
 * `conversationId` der sichtbaren Unterhaltung.
 *
 * Lauf: npx vitest run src/api/agents/__tests__/sub-agent-background-lane.test.ts
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { buildDelegateExecutor, _setDepth, type SubAgentRunner } from '../sub-agent'
import { useAgentTaskStore } from '../../../stores/agentTaskStore'
import { useModelStore } from '../../../stores/modelStore'
import { useGenerationStore } from '../../../stores/generationStore'
import { localLaneHolder, queuedRunIds, __resetRunLanesForTests } from '../../../lib/run-lanes'
import { taskElapsedSeconds } from '../../../lib/agent-tasks'
import type { AgentRunContext } from '../../agent-context'

/** Ollama ohne Praefix, `isOllamaLocal()` zeigt in Tests auf diese Maschine
 *  (model-name.ts / run-lane-of-model.ts), also lokale Spur. */
const LOCAL_MODEL = 'qwen3:8b'

function makeRun(conversationId: string): AgentRunContext {
  return {
    token: 'run', chatId: null, conversationId, workspace: null,
    artifactMode: false, readOnlyShellTurn: false, mode: null, artifacts: [],
  }
}

function steuerbar() {
  let aufloesen!: (v: string) => void
  const versprechen = new Promise<string>((res) => { aufloesen = res })
  return { versprechen, aufloesen }
}

async function takte(n = 15): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

beforeEach(() => {
  __resetRunLanesForTests()
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useAgentTaskStore.setState({ byConv: {} })
  useModelStore.setState({ activeModel: LOCAL_MODEL })
  _setDepth(0)
})

describe('eigene Buchung, eigene Identitaet', () => {
  it('zwei Hintergrundagenten auf lokalen Modellen laufen nacheinander, nicht nebeneinander', async () => {
    const a = steuerbar()
    const runnerA: SubAgentRunner = async () => a.versprechen
    const execA = buildDelegateExecutor(runnerA)
    await execA({ goal: 'erstes', background: true }, makeRun('conv-a'))
    const idA = useAgentTaskStore.getState().forConv('conv-a')[0].id
    expect(localLaneHolder()).toBe(idA)

    let bLief = false
    const runnerB: SubAgentRunner = async () => { bLief = true; return 'b fertig' }
    const execB = buildDelegateExecutor(runnerB)
    await execB({ goal: 'zweites', background: true }, makeRun('conv-b'))
    const idB = useAgentTaskStore.getState().forConv('conv-b')[0].id

    // B ist gebucht (sichtbar in der Schlange), aber A haelt die Spur noch.
    expect(bLief).toBe(false)
    expect(queuedRunIds()).toEqual([idB])
    expect(localLaneHolder()).toBe(idA)

    a.aufloesen('a fertig')
    await takte()

    expect(bLief).toBe(true)
    expect(useAgentTaskStore.getState().get(idA)?.status).toBe('done')
    expect(useAgentTaskStore.getState().get(idB)?.status).toBe('done')
    expect(localLaneHolder()).toBeNull()
    expect(queuedRunIds()).toEqual([])
  })

  it('ein Cloud-Hintergrundagent nebenher blockiert die lokale Spur nicht', async () => {
    // `qwen3:8b` (Ollama, lokal) haelt die Spur; ein Modell mit dem Praefix
    // eines Anbieters ohne lokalen Fall (lu-cloud/anthropic) laeuft daneben.
    const a = steuerbar()
    const execA = buildDelegateExecutor((async () => a.versprechen) as SubAgentRunner)
    await execA({ goal: 'lokal', background: true }, makeRun('conv-a'))

    let cloudLief = false
    // Kein `model`-Argument: `resolveRequestedModel` braucht den Treffer in
    // `store.models`, das in Tests leer ist. Die Spur liest stattdessen das
    // AKTIVE Modell, also wird das hier umgeschaltet, bevor der zweite
    // Hintergrundagent startet.
    useModelStore.setState({ activeModel: 'anthropic::claude' })
    const execCloud = buildDelegateExecutor((async () => { cloudLief = true; return 'ok' }) as SubAgentRunner)
    await execCloud({ goal: 'cloud', background: true }, makeRun('conv-cloud'))
    await takte()

    expect(cloudLief).toBe(true)
    expect(queuedRunIds()).toEqual([])
    a.aufloesen('fertig')
    await takte()
  })

  it('Stop auf einen noch wartenden Hintergrundagenten laesst seinen Rumpf nie anlaufen', async () => {
    const a = steuerbar()
    const execA = buildDelegateExecutor((async () => a.versprechen) as SubAgentRunner)
    await execA({ goal: 'haelt-die-spur', background: true }, makeRun('conv-a'))
    const idA = useAgentTaskStore.getState().forConv('conv-a')[0].id

    let bLief = false
    const execB = buildDelegateExecutor((async () => { bLief = true; return 'sollte nie laufen' }) as SubAgentRunner)
    await execB({ goal: 'wartend', background: true }, makeRun('conv-b'))
    const idB = useAgentTaskStore.getState().forConv('conv-b')[0].id
    expect(queuedRunIds()).toEqual([idB])

    // Derselbe Weg, den `stopAllBackgroundWork` benutzt: die Aufgaben-Id ist
    // die Buchungsidentitaet, nicht die sichtbare Konversation.
    useGenerationStore.getState().abortConversation(idB)
    await takte()

    expect(bLief).toBe(false)
    expect(useAgentTaskStore.getState().get(idB)?.status).toBe('cancelled')
    expect(queuedRunIds()).toEqual([])
    expect(localLaneHolder()).toBe(idA)

    a.aufloesen('fertig')
    await takte()
  })
})

describe("'queued' bis die Spur admittiert (Folgeauftrag, bau/review-w2lane.md Runde 4)", () => {
  it('ein wartender Hintergrundagent meldet status queued mit Laufzeit 0, egal wie lange das Warten scheinbar dauert, und zaehlt erst ab dem echten Start', async () => {
    const a = steuerbar()
    const execA = buildDelegateExecutor((async () => a.versprechen) as SubAgentRunner)
    await execA({ goal: 'haelt-die-spur', background: true }, makeRun('conv-a'))

    const b = steuerbar()
    const execB = buildDelegateExecutor((async () => b.versprechen) as SubAgentRunner)
    await execB({ goal: 'wartend', background: true }, makeRun('conv-b'))
    const idB = useAgentTaskStore.getState().forConv('conv-b')[0].id
    const vorAdmission = useAgentTaskStore.getState().get(idB)!

    expect(vorAdmission.status).toBe('queued')
    expect(vorAdmission.runStartedAt).toBeUndefined()
    // Egal, wie weit "jetzt" in der Zukunft liegt: waehrend queued ist die
    // angezeigte Laufzeit 0, kein Zaehler, der seit der Anmeldung waechst.
    expect(taskElapsedSeconds(vorAdmission, vorAdmission.startedAt + 60_000)).toBe(0)

    a.aufloesen('a fertig')
    await takte()

    const nachAdmission = useAgentTaskStore.getState().get(idB)!
    expect(nachAdmission.status).toBe('running')
    expect(nachAdmission.runStartedAt).toBeDefined()
    expect(nachAdmission.runStartedAt as number).toBeGreaterThanOrEqual(nachAdmission.startedAt)
    // Ab jetzt zaehlt die Laufzeit ab `runStartedAt`, nicht ab `startedAt`.
    expect(taskElapsedSeconds(nachAdmission, (nachAdmission.runStartedAt as number) + 4000)).toBe(4)

    b.aufloesen('b fertig')
    await takte()
    expect(useAgentTaskStore.getState().get(idB)?.status).toBe('done')
  })

  it('GEGENPROBE: bei freier Spur ist ein Hintergrundagent nie von aussen als queued zu beobachten', async () => {
    const execA = buildDelegateExecutor((async () => 'sofort fertig') as SubAgentRunner)
    await execA({ goal: 'frei', background: true }, makeRun('conv-frei'))
    const id = useAgentTaskStore.getState().forConv('conv-frei')[0].id
    // Freie Spur: `admit` entscheidet synchron auf 'started', der Rumpf setzt
    // 'running' noch im selben Aufrufrahmen, bevor `execA` je zurueckkehrt.
    // 'queued' existiert dann nur als Zwischenwert INNERHALB von `start()`,
    // nie als Zustand, den ein Aufrufer von aussen sehen kann.
    const task = useAgentTaskStore.getState().get(id)!
    expect(task.status).not.toBe('queued')
    expect(['running', 'done']).toContain(task.status)
  })
})
