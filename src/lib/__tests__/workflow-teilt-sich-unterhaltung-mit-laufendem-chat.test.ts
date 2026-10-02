/**
 * BLOCKER 3 (Nachpruefung 2, bau/review-w2lane.md, Kopf `a9ded97d`): ein
 * Arbeitsablauf nimmt dem laufenden Chat seinen Abbruchgriff.
 *
 * Gemessen: eine fremde Unterhaltung haelt die lokale Spur, in Unterhaltung
 * `a` laeuft ein Chat und hat seinen Abbruchgriff registriert, dann startet
 * ein Arbeitsablauf, der dieselbe Unterhaltung als Buchungskennung nimmt
 * (`this.conversationId`, siehe der Kommentar in `workflow-engine.ts`s
 * `run()`) und sich anstellt. Der urspruengliche Messfall kam ueber den
 * inzwischen entfernten Settings-Play-Knopf und `useWorkflow.ts`
 * (`activeConversationId`, seit review-wfplay.md geloescht); der Fix in
 * `run-slot.ts` selbst ist an der Buchungskennung verankert und gilt daher
 * unveraendert fuer den heutigen einzigen Startweg, den `run_workflow`-
 * Werkzeugaufruf.
 * `run-slot.ts` registrierte beim Anstellen seinen eigenen Griff unter
 * DERSELBEN Kennung und ueberschrieb damit den des laufenden Chats; am Ende
 * loeschte `aufraeumen` ihn ersatzlos. Solange der Ablauf wartete, rief
 * `abortConversation('a')` NUR den Griff des Ablaufs: der Nutzer drueckte
 * Stop, der Chat-Strom lief weiter und kostete weiter, und still gestorben
 * ist stattdessen der wartende Arbeitsablauf.
 *
 * Fix AN DER WURZEL in `run-slot.ts` (nicht an der Aufrufstelle): der
 * normale Buchungsweg haengt sein eigenes Glied an die Abbruchkette dieser
 * Kennung (Stop erreicht ALLE lebenden Glieder), und nimmt beim Aufraeumen
 * GENAU dieses eigene Glied wieder heraus, statt einen vorgefundenen Griff
 * blind zurueckzuschreiben. Das deckt jeden Aufrufer, der sich eine Kennung
 * mit einem anderen Halter teilt, nicht nur `WorkflowEngine`.
 *
 * `WorkflowEngine.run()` bucht weiterhin bewusst unter `this.conversationId`
 * (nicht unter einer privaten Kennung wie der Sub-Agent seit `a9ded97d`):
 * ein aus dem Ablauf-Fenster gestarteter Arbeitsablauf teilt sich absichtlich
 * die sichtbare Unterhaltung (er schreibt seine Schritte dort hinein), eine
 * private Kennung wuerde die Wartezeile ("wartet auf die Grafikkarte") von
 * dieser Unterhaltung lösen. Siehe den Kommentar in `workflow-engine.ts`s
 * `run()`.
 *
 * ── DIE ECHTE SENDEFORM (Schlusspruefung, review-w2lane.md) ─────────────────
 *
 * Der Chat-Ersatz (`chatErsatz` unten) registriert seinen eigenen Griff
 * IM RUMPF, genau wie `useChat.ts` es an drei Stellen wirklich tut (Zeile
 * 412 und 940: `useGenerationStore.getState().registerAborter(convId,
 * myAborter)`, mit einem identitaetsgeprueften `stillOwnsSlot`-Aufraeumen
 * danach). Eine Vorgaengerfassung dieses Tests liess ihren Chat-Ersatz
 * NICHT im Rumpf registrieren, sondern sich allein auf den `abort`-Callback
 * von `runInLane` verlassen: "kein Griff verwaist" war damit gruen, weil der
 * gemessene Fall (ein toter Griff aus einem Rumpf, der direkt in den Store
 * schreibt) gar nicht entstehen konnte. Mit der echten Sendeform entsteht er
 * sehr wohl, und die Zusage muss auch dann noch stimmen.
 *
 * Lauf: npx vitest run src/lib/__tests__/workflow-teilt-sich-unterhaltung-mit-laufendem-chat.test.ts
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { WorkflowEngine } from '../workflow-engine'
import { APPROVE_ALL } from '../../api/agents/tool-executor'
import { runInLane } from '../run-slot'
import { localLaneHolder, queuedRunIds, __resetRunLanesForTests } from '../run-lanes'
import { useGenerationStore } from '../../stores/generationStore'
import { useModelStore } from '../../stores/modelStore'
import { useMemoryStore } from '../../stores/memoryStore'
import { useAgentTaskStore } from '../../stores/agentTaskStore'
import { useAgentLoopStore } from '../../stores/agentLoopStore'
import { stopAllBackgroundWork } from '../background-shutdown'
import { __resetRunStopsForTests } from '../run-stop'
import type { AgentWorkflow, WorkflowStep, WorkflowEngineCallbacks } from '../../types/agent-workflows'

/**
 * Chat-Ersatz in der ECHTEN Sendeform: registriert im Rumpf seinen eigenen
 * Griff (wie `useChat.ts:412` und `:940`), statt sich auf den `abort`-
 * Callback von `run-slot.ts` zu verlassen, und raeumt ihn identitaetsgeprueft
 * wieder auf (`stillOwnsSlot`, wie `useChat.ts:425` und `:1325`).
 */
function chatErsatz(convId: string, onAbort: () => void): { lauf: Promise<string>; abortController: AbortController } {
  const abortController = new AbortController()
  const lauf = runInLane(
    { conversationId: convId, lane: 'local', abort: () => abortController.abort() },
    async () => {
      const myAborter = () => { onAbort(); abortController.abort() }
      useGenerationStore.getState().registerAborter(convId, myAborter)
      try {
        await new Promise<void>((resolve) => {
          if (abortController.signal.aborted) { resolve(); return }
          abortController.signal.addEventListener('abort', () => resolve())
        })
      } finally {
        const stillOwnsSlot = useGenerationStore.getState().aborters[convId] === myAborter
        if (stillOwnsSlot) {
          useGenerationStore.getState().clearAborter(convId)
        }
      }
    },
  )
  return { lauf, abortController }
}

const LOCAL_MODEL = 'qwen3:8b'

function noteStep(id: string): WorkflowStep {
  return {
    id, type: 'memory_save', label: id,
    memorySave: { type: 'reference', titleTemplate: id, contentTemplate: 'x', tags: [] },
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

function steuerbar() {
  let aufloesen!: () => void
  const versprechen = new Promise<void>((res) => { aufloesen = res })
  return { versprechen, aufloesen }
}

async function takte(n = 20): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

beforeEach(() => {
  __resetRunLanesForTests()
  __resetRunStopsForTests()
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useAgentTaskStore.setState({ byConv: {} })
  useAgentLoopStore.setState({ loops: {} })
  useModelStore.setState({ activeModel: LOCAL_MODEL })
  vi.spyOn(useMemoryStore.getState(), 'addMemory').mockImplementation(() => 'mem-id')
})

describe("Opus' Messfall: ein Chat laeuft in 'a', ein Arbeitsablauf stellt sich unter derselben Kennung an", () => {
  it('Stop stoppt den Chat-Strom UND den wartenden Arbeitsablauf, danach ist kein Griff verwaist', async () => {
    let chatAbortCalled = false
    const { lauf: chatLauf } = chatErsatz('a', () => { chatAbortCalled = true })
    await takte(3)
    expect(localLaneHolder()).toBe('a')

    const errors: string[] = []
    const engine = new WorkflowEngine(workflowOf([noteStep('x')]), 'a', callbacks((e) => errors.push(e)), APPROVE_ALL)
    const ablaufLauf = engine.run()
    await takte(3)

    // Aufbau wie im Messfall: der Chat haelt, der Arbeitsablauf steht in der
    // Schlange unter derselben Kennung.
    expect(queuedRunIds()).toEqual(['a'])
    expect(localLaneHolder()).toBe('a')

    // Stop, derselbe Griff, den ein Stop-Knopf in der Unterhaltung riefe.
    useGenerationStore.getState().aborters['a']?.()

    const [ablaufErgebnis] = await Promise.all([ablaufLauf, chatLauf])

    // Beide sind getroffen: der Chat-Strom (sein eigener Abbruch wurde
    // gerufen) und der wartende Arbeitsablauf (kein Schritt lief je an).
    expect(chatAbortCalled).toBe(true)
    expect(ablaufErgebnis).toEqual([])
    expect(errors.join(' ')).toMatch(/Cancelled before it could start/)

    // Kein Griff verwaist: nichts laeuft mehr unter 'a', also ist auch
    // nichts mehr registriert.
    expect(useGenerationStore.getState().aborters['a']).toBeUndefined()
    expect(localLaneHolder()).toBeNull()
    expect(queuedRunIds()).toEqual([])
  })

  it('dasselbe ueber stopAllBackgroundWork (Abmelden, Fenster schliessen, App beenden)', async () => {
    let chatAbortCalled = false
    const { lauf: chatLauf } = chatErsatz('a', () => { chatAbortCalled = true })
    await takte(3)

    const errors: string[] = []
    const engine = new WorkflowEngine(workflowOf([noteStep('x')]), 'a', callbacks((e) => errors.push(e)), APPROVE_ALL)
    const ablaufLauf = engine.run()
    await takte(3)
    expect(queuedRunIds()).toEqual(['a'])

    stopAllBackgroundWork()

    const [ablaufErgebnis] = await Promise.all([ablaufLauf, chatLauf])

    expect(chatAbortCalled).toBe(true)
    expect(ablaufErgebnis).toEqual([])
    expect(errors.join(' ')).toMatch(/Cancelled before it could start/)
    expect(useGenerationStore.getState().aborters['a']).toBeUndefined()
    expect(localLaneHolder()).toBeNull()
  })
})

describe('NEGATIVKONTROLLE: ohne einen zweiten, sich die Kennung teilenden Lauf aendert der Fix nichts am einfachen Fall', () => {
  it('ein Arbeitsablauf allein in seiner Unterhaltung: Stop trifft ihn, der Griff ist danach sauber weg', async () => {
    // Ein `user_input`-Schritt haelt den Lauf an, bis der Test antwortet,
    // sonst waere der synchrone memory_save-Schritt schon durch, bevor
    // ueberhaupt geprueft werden kann, dass er noch laeuft.
    const step: WorkflowStep = { id: 'warte', type: 'user_input', label: 'warte', userInputPrompt: 'weiter?' }
    const errors: string[] = []
    const engine = new WorkflowEngine(workflowOf([step]), 'allein', callbacks((e) => errors.push(e)), APPROVE_ALL)
    const ablaufLauf = engine.run()
    await takte(2)
    expect(localLaneHolder()).toBe('allein')

    useGenerationStore.getState().aborters['allein']?.()
    await ablaufLauf

    expect(useGenerationStore.getState().aborters['allein']).toBeUndefined()
    expect(localLaneHolder()).toBeNull()
  })

  it('ein Chat allein: sein eigener Griff bleibt unveraendert erreichbar, bis er selbst fertig ist', async () => {
    let chatAbortCalled = false
    const chat = steuerbar()
    const chatLauf = runInLane(
      { conversationId: 'nur-chat', lane: 'local', abort: () => { chatAbortCalled = true; chat.aufloesen() } },
      async () => { await chat.versprechen },
    )
    await takte(2)
    expect(useGenerationStore.getState().aborters['nur-chat']).toBeDefined()

    useGenerationStore.getState().aborters['nur-chat']?.()
    await chatLauf

    expect(chatAbortCalled).toBe(true)
    expect(useGenerationStore.getState().aborters['nur-chat']).toBeUndefined()
  })
})

/**
 * Folgeauftrag 1, Schlusspruefung (review-w2lane.md): "der tote Griff soll
 * nicht zurueckgeschrieben werden". Drei Buchungen unter derselben Kennung,
 * `lane: 'cloud'` damit alle drei sofort laufen (die lokale Spur serialisiert
 * sonst streng nach Anstellreihenfolge, hier soll die ENDREIHENFOLGE frei
 * waehlbar sein, nicht die Startreihenfolge). Gemessen war: nur die exakte
 * Umkehrung der Buchungsreihenfolge (c-b-a) raeumte die verkettete Closure
 * vollstaendig ab, jede andere liess einen toten Griff stehen. Mit der Liste
 * lebender Glieder statt der Closure darf JEDE Endreihenfolge keinen toten
 * Griff mehr hinterlassen.
 */
describe('Folgeauftrag 1: drei Laeufe unter einer Kennung, alle sechs Endreihenfolgen', () => {
  function macheLauf(label: string): { lauf: Promise<string>; beenden: () => void } {
    let beenden!: () => void
    const wartet = new Promise<void>((r) => { beenden = r })
    const lauf = runInLane(
      { conversationId: 'x', lane: 'cloud', abort: () => {} },
      async () => { await wartet; void label },
    )
    return { lauf, beenden }
  }

  const REIHENFOLGEN: Array<[string, string, string]> = [
    ['a', 'b', 'c'], ['a', 'c', 'b'], ['b', 'a', 'c'],
    ['b', 'c', 'a'], ['c', 'a', 'b'], ['c', 'b', 'a'],
  ]

  it.each(REIHENFOLGEN)('Endreihenfolge %s-%s-%s: kein toter Griff bleibt stehen', async (r1, r2, r3) => {
    const laeufe: Record<string, { lauf: Promise<string>; beenden: () => void }> = {
      a: macheLauf('a'), b: macheLauf('b'), c: macheLauf('c'),
    }
    await takte(3)
    expect(useGenerationStore.getState().aborters['x']).toBeDefined()

    for (const label of [r1, r2, r3]) {
      laeufe[label].beenden()
      await laeufe[label].lauf
    }

    // Alle drei sind fertig: nichts darf mehr registriert sein, egal in
    // welcher Reihenfolge sie geendet haben.
    expect(useGenerationStore.getState().aborters['x']).toBeUndefined()
  })
})

/**
 * Zweiter Fund der Schlusspruefung: die Kette war nicht gegen einen
 * werfenden Vorgaenger gesichert. `griffAusKette` ruft jedes Glied jetzt
 * einzeln in einem eigenen `try/catch` (siehe Kopf von `run-slot.ts`).
 */
describe('NEGATIVKONTROLLE: ein werfendes Glied in der Kette reisst die uebrigen nicht mit', () => {
  it('zwei Laeufe unter einer Kennung, einer wirft beim Abbruch: der andere wird trotzdem gerufen, und Stop wirft nicht', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let bAbortCalled = false
    let beendenA!: () => void
    const wartetA = new Promise<void>((r) => { beendenA = r })
    let beendenB!: () => void
    const wartetB = new Promise<void>((r) => { beendenB = r })

    const aLauf = runInLane(
      { conversationId: 'y', lane: 'cloud', abort: () => { throw new Error('a wirft beim Abbruch') } },
      async () => { await wartetA },
    )
    await takte(3)
    const bLauf = runInLane(
      { conversationId: 'y', lane: 'cloud', abort: () => { bAbortCalled = true } },
      async () => { await wartetB },
    )
    await takte(3)

    // Stop auf die Kennung: das werfende Glied darf den Aufruf nicht
    // hochreissen, und das folgende Glied muss trotzdem noch gerufen werden.
    expect(() => useGenerationStore.getState().aborters['y']?.()).not.toThrow()
    expect(bAbortCalled).toBe(true)

    beendenA()
    beendenB()
    await Promise.all([aLauf, bLauf])
    expect(useGenerationStore.getState().aborters['y']).toBeUndefined()

    warnSpy.mockRestore()
  })
})
