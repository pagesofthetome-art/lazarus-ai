/**
 * `runsInHeldLane`, die explizite Weitergabe des Elternlauf-Tokens
 * (Folgeauftrag 3, review-lanes.md; Punkt b/c der Runde-3-Nachbesserung,
 * bau/review-lanes.md "Runde 3 der Pruefung"; Nachbesserung Runde 4,
 * bau/review-w2lane.md, Punkt 1).
 *
 * Zwei echte verschachtelte Aufrufer sind inzwischen da: `run_workflow`
 * (verschachtelt in einen schon laufenden Werkzeugaufruf) und der
 * VORDERGRUND-Sub-Agent (`sub-agent.ts`, `return await runner(...)`). Beide
 * werden von ihrem Elternlauf ABGEWARTET, laufen also im selben
 * Aufrufrahmen. Ein zweites `admit` fuer dieselbe `conversationId` waere hier
 * KEINE zweite Buchung, sondern eine Verklemmung: der innere Aufruf stellt
 * sich hinter den aeusseren, der aeussere wartet aber auf den inneren, bevor
 * er selbst freigibt. Beide fuer immer.
 *
 * Runde 4 hat gemessen, dass die Vorgaengerfassung dieser Datei einen Marker
 * pruefte, der reines Vertrauen war: `runsInHeldLane: true` liess JEDEN
 * Aufrufer unbebucht mitfahren, ob ein Elternlauf die Spur wirklich hielt
 * oder nicht. `runsInHeldLane` ist seither die echte `HeldLocalLane`-
 * Identitaet, die `runInLane` seinem eigenen Rumpf als zweites Argument
 * mitgibt, und `run-slot.ts` prueft sie gegen `holdsLocalLane()`, BEVOR sie
 * den Mitfahr-Weg nimmt. Die Tests unten pruefen genau diese Pruefung: mit
 * einem echten Beweis (mitfahren), mit einem veralteten/falschen Beweis neben
 * einem fremden Halter (Opus' Messfall: normal buchen), unter einem
 * Cloud-Elternzug (der gar keinen lokalen Beweis hat), und dass Stop auf die
 * Elternunterhaltung den mitfahrenden inneren Lauf ueber den verketteten
 * Abbruchgriff erreicht.
 *
 * Lauf: npx vitest run src/lib/__tests__/run-slot-nested-in-held-lane.test.ts
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { localLaneHolder, queuedRunIds, __resetRunLanesForTests } from '../run-lanes'
import { runInLane, type HeldLocalLane } from '../run-slot'
import { useGenerationStore } from '../../stores/generationStore'

beforeEach(() => {
  __resetRunLanesForTests()
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
})

async function takte(n = 20): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

describe('mit dem echten Beweis: der verschachtelte Aufruf faehrt im gehaltenen Platz mit', () => {
  it('ein abgewarteter innerer Aufruf mit dem echten held-Wert des Elternlaufs laeuft durch, statt sich anzustellen', async () => {
    let innerRan = false
    let innerOutcome: string | undefined
    const outerOutcome = await runInLane({ conversationId: 'a', lane: 'local' }, async (held) => {
      innerOutcome = await runInLane(
        { conversationId: 'a', lane: 'local', runsInHeldLane: held },
        async () => { innerRan = true },
      )
    })

    expect(innerRan).toBe(true)
    expect(innerOutcome).toBe('ran')
    expect(outerOutcome).toBe('ran')
    // Ganz am Ende gibt der AEUSSERE Lauf frei, kein doppeltes release.
    expect(localLaneHolder()).toBeNull()
  })

  it('der innere Lauf taucht dabei nirgends in der Warteschlange auf', async () => {
    let sahSchlange: string[] = ['ungesehen']
    let sahHalter: string | null = 'ungesehen'
    await runInLane({ conversationId: 'a', lane: 'local' }, async (held) => {
      await runInLane({ conversationId: 'a', lane: 'local', runsInHeldLane: held }, async () => {
        sahSchlange = queuedRunIds()
        sahHalter = localLaneHolder()
      })
    })
    expect(sahSchlange).toEqual([])
    expect(sahHalter).toBe('a')
  })

  it('ein DRITTER, echt wartender Lauf stellt sich hinter dem AEUSSEREN an, nicht hinter dem mitfahrenden Lauf', async () => {
    // Der mitfahrende Lauf nimmt in der Schlange keinen Platz weg, also darf
    // ein echter dritter Aufrufer nicht auf ihn warten muessen.
    let dritterLief = false
    const aeussererLauf = runInLane({ conversationId: 'a', lane: 'local' }, async (held) => {
      await runInLane({ conversationId: 'a', lane: 'local', runsInHeldLane: held }, async () => {})
    })
    const dritterLauf = runInLane({ conversationId: 'c', lane: 'local' }, async () => { dritterLief = true })

    await aeussererLauf
    await dritterLauf
    expect(dritterLief).toBe(true)
  })

  it('Fehler aus dem inneren Lauf kommen aus dem aeusseren `runInLane` unveraendert heraus', async () => {
    await expect(
      runInLane({ conversationId: 'a', lane: 'local' }, async (held) => {
        await runInLane({ conversationId: 'a', lane: 'local', runsInHeldLane: held }, async () => {
          throw new Error('innen kaputt')
        })
      }),
    ).rejects.toThrow('innen kaputt')
    expect(localLaneHolder()).toBeNull()
  })
})

describe('OPUS-MESSFALL (Runde 4): ein Beweis, der nicht mehr stimmt, bucht normal statt unsichtbar mitzulaufen', () => {
  it('ein Marker, der einen Elternlauf nennt, waehrend ein FREMDER Halter die Spur haelt, wartet hinter dem Fremden', async () => {
    // Ein fremder Lauf haelt bereits die lokale Spur, unabhaengig vom Aufruf
    // weiter unten.
    let fremdLaeuft = false
    let fremdFreigeben: (() => void) | undefined
    const fremdWartet = new Promise<void>((r) => { fremdFreigeben = r })
    const fremderLauf = runInLane({ conversationId: 'fremd', lane: 'local' }, async () => {
      fremdLaeuft = true
      await fremdWartet
    })
    await takte(3)
    expect(fremdLaeuft).toBe(true)
    expect(localLaneHolder()).toBe('fremd')

    // Ein Aufrufer behauptet, ein Elternlauf haette die Spur schon
    // ("markerLief: true" im Messfall) -- der Beweis ist aber veraltet,
    // falsch konstruiert, oder nie echt gewesen. `holdsLocalLane` findet
    // dafuer keinen Treffer, weil `halter` heute 'fremd' ist.
    const veralteterBeweis: HeldLocalLane = { conversationId: 'irgendwer', identity: Symbol('nie echt gewesen') }
    let innerRan = false
    const innerLauf = runInLane(
      { conversationId: 'x', lane: 'local', runsInHeldLane: veralteterBeweis },
      async () => { innerRan = true },
    )
    await takte(3)

    // Die Gegenprobe zur alten Fassung: der innere Aufruf ist NICHT
    // unsichtbar neben dem fremden Halter losgelaufen. Er bucht ganz normal
    // und stellt sich hinten an.
    expect(innerRan).toBe(false)
    expect(queuedRunIds()).toEqual(['x'])
    expect(localLaneHolder()).toBe('fremd')

    fremdFreigeben?.()
    await fremderLauf
    await innerLauf
    expect(innerRan).toBe(true)
    expect(localLaneHolder()).toBeNull()
  })
})

describe('Cloud-Elternzug mit einem lokalen Sub-Agenten: der held-Wert ist null, also bucht der Sub-Agent sich selbst', () => {
  it('ein Cloud-Elternzug reicht `held: null` weiter, ein lokaler Sub-Agent bucht darauf normal', async () => {
    // Fall (a) aus dem Opus-Review: ein Vordergrund-Sub-Agent mit eigenem
    // lokalem `model` unter einem Cloud-Elternzug. Die Cloud-Spur haelt nie
    // exklusiv etwas, `run-slot.ts` gibt ihrem Rumpf deshalb `held: null`.
    let heldImElternzug: HeldLocalLane | null | undefined = 'ungesehen' as unknown as HeldLocalLane | null
    let innerRan = false
    let innerHeld: HeldLocalLane | null | undefined = 'ungesehen' as unknown as HeldLocalLane | null
    let innerOutcome: string | undefined

    await runInLane({ conversationId: 'cloud-zug', lane: 'cloud' }, async (held) => {
      heldImElternzug = held
      // Genau das, was `sub-agent.ts` heute tut: `runsInHeldLane: run?.heldLocalLane ?? null`.
      innerOutcome = await runInLane(
        { conversationId: 'sub-x', lane: 'local', runsInHeldLane: held },
        async (innererHeld) => { innerRan = true; innerHeld = innererHeld },
      )
    })

    expect(heldImElternzug).toBeNull()
    expect(innerRan).toBe(true)
    expect(innerOutcome).toBe('ran')
    // Der Sub-Agent hat seine EIGENE Buchung bekommen, kein Mitfahren.
    expect(innerHeld).not.toBeNull()
    expect((innerHeld as HeldLocalLane).conversationId).toBe('sub-x')
    expect(localLaneHolder()).toBeNull()
  })

  it('GEGENPROBE: waehrend der lokale Sub-Agent selbst gebucht laeuft, wartet ein Dritter auf IHN, nicht auf den Cloud-Zug', async () => {
    let dritterLief = false
    const cloudZug = runInLane({ conversationId: 'cloud-zug', lane: 'cloud' }, async (held) => {
      await runInLane({ conversationId: 'sub-x', lane: 'local', runsInHeldLane: held }, async () => { await takte(5) })
    })
    await takte(1)
    const dritterLauf = runInLane({ conversationId: 'c', lane: 'local' }, async () => { dritterLief = true })
    await takte(3)
    // Der Cloud-Zug selbst nimmt der lokalen Spur nichts weg, der Dritte
    // wartet also auf 'sub-x', nicht auf 'cloud-zug'.
    expect(queuedRunIds()).toEqual(['c'])
    expect(localLaneHolder()).toBe('sub-x')
    await cloudZug
    await dritterLauf
    expect(dritterLief).toBe(true)
  })
})

describe('GEGENPROBE: ohne jeden Beweis haengt genau der Fall, den der Dateikopf beschreibt', () => {
  it('ein abgewarteter innerer Aufruf OHNE runsInHeldLane laeuft nie an', async () => {
    let innerRan = false
    let aeussererFertig = false
    // Absichtlich NICHT awaited: mit der alten, geratenen Zuordnung
    // ("dieselbe conversationId ist derselbe Lauf") wuerde das hier haengen.
    // Ohne den expliziten Beweis gilt seit Blocker A "jeder Aufruf ist ein
    // eigener Lauf" (run-lanes.ts), also stellt sich der innere Aufruf mit
    // einer NEUEN Identitaet hinter den aeusseren an, waehrend der aeussere
    // Rumpf auf genau diesen inneren Aufruf wartet. Ein `await` auf das
    // Ergebnis wuerde den Test selbst haengen lassen, das IST die Verklemmung.
    void runInLane({ conversationId: 'a', lane: 'local' }, async () => {
      await runInLane({ conversationId: 'a', lane: 'local' }, async () => { innerRan = true })
    }).then(() => { aeussererFertig = true })

    await takte()

    expect(innerRan).toBe(false)
    expect(aeussererFertig).toBe(false)
    // Die Unterhaltung steht hinter sich selbst in ihrer eigenen Schlange:
    // genau der Befund, den ein echter `runsInHeldLane`-Beweis vermeidet.
    expect(localLaneHolder()).toBe('a')
    expect(queuedRunIds()).toEqual(['a'])
  })
})

describe('Stop auf die Elternunterhaltung erreicht den mitfahrenden inneren Lauf (Runde 4)', () => {
  it('der verkettete Abbruchgriff ruft sowohl den Eltern- als auch den inneren Abbruch', async () => {
    let elternAbortCalled = false
    let innerAborted = false
    let resolveInner: (() => void) | undefined
    const innerDarfWeiter = new Promise<void>((r) => { resolveInner = r })

    const aeussererLauf = runInLane(
      { conversationId: 'a', lane: 'local', abort: () => { elternAbortCalled = true } },
      async (held) => {
        await runInLane(
          { conversationId: 'a', lane: 'local', runsInHeldLane: held, abort: () => { innerAborted = true } },
          async () => {
            // Stop auf die Elternunterhaltung, waehrend der innere Rumpf laeuft.
            // Dies ist genau der Griff, den ein UI-Stop-Knopf ueber
            // generationStore aufriefe.
            useGenerationStore.getState().aborters['a']?.()
            resolveInner?.()
          },
        )
      },
    )

    await innerDarfWeiter
    await aeussererLauf

    expect(innerAborted).toBe(true)
    expect(elternAbortCalled).toBe(true)
  })

  it('GEGENPROBE: nach Ende des inneren Laufs haengt am Griff wieder NUR der Elternabbruch', async () => {
    let elternAbortCalled = false
    let innerAbortCalled = false

    await runInLane(
      { conversationId: 'a', lane: 'local', abort: () => { elternAbortCalled = true } },
      async (held) => {
        await runInLane(
          { conversationId: 'a', lane: 'local', runsInHeldLane: held, abort: () => { innerAbortCalled = true } },
          async () => {},
        )
        // Der innere Lauf ist vorbei, sein `finally` hat den Griff
        // zurueckgesetzt: ein Stop JETZT darf nur noch den Elternabbruch
        // treffen, nicht mehr einen laengst beendeten inneren Rumpf.
        useGenerationStore.getState().aborters['a']?.()
      },
    )

    expect(elternAbortCalled).toBe(true)
    expect(innerAbortCalled).toBe(false)
  })
})
