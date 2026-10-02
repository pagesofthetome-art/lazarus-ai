/**
 * Die eine Stelle, die einen Platz nimmt und ihn wieder hergibt.
 *
 * `run-lanes.ts` schreibt die Pflicht in seinen Kopf: wer `'started'`
 * bekommt, MUSS `release` rufen, im `finally`, auch bei Fehler und Abbruch.
 * Ein nicht zurueckgegebener Platz haelt die lokale Spur fuer den Rest der
 * Sitzung besetzt, und jeder weitere lokale Lauf reiht sich dann in eine
 * Schlange ein, die nie wieder abgearbeitet wird.
 *
 * Eine Pflicht, die an jeder Aufrufstelle neu eingehalten werden muss, wird
 * irgendwo nicht eingehalten. Deshalb gibt es genau einen Aufrufer,
 * `lib/run-slot.ts`, und deshalb steht hier neben dem Verhalten ein Waechter
 * darauf, dass es genau einer bleibt.
 *
 * Lauf: npx vitest run src/lib/__tests__/run-slot.test.ts
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resolve } from 'node:path'

import {
  localLaneHolder,
  queuedRunIds,
  runQueuePosition,
  __resetRunLanesForTests,
} from '../run-lanes'
import { runInLane } from '../run-slot'
import { useGenerationStore } from '../../stores/generationStore'
import { quelldateien, quelltext } from '../../components/__tests__/quelldateien'

beforeEach(() => {
  __resetRunLanesForTests()
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
})

/** Ein Lauf, den der Test von aussen beenden kann. */
function steuerbar() {
  let aufloesen!: () => void
  let ablehnen!: (grund: unknown) => void
  const versprechen = new Promise<void>((res, rej) => { aufloesen = res; ablehnen = rej })
  return { versprechen, aufloesen, ablehnen }
}

/** Der Mikrotask-Schlange Zeit geben, das Nachruecken abzuwickeln. */
async function takte(n = 4): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

describe('cloud: echt gleichzeitig, ohne Schranke', () => {
  it('zwei Cloud-Laeufe sind beide gleichzeitig im Lauf', () => {
    // DER AUFTRAG IN EINEM TEST. Heute ist der Senden-Knopf waehrend jedes
    // Laufs app-weit "Stop generation", ein zweiter Auftrag ist nicht
    // absendbar. In der Wolke steht fremde Kapazitaet dahinter, die ohnehin
    // parallel bedient; eine Schranke waere dort reine Bremse.
    const a = steuerbar()
    const b = steuerbar()
    const spur: string[] = []

    runInLane({ conversationId: 'a', lane: 'cloud' }, async () => {
      spur.push('a-an'); await a.versprechen; spur.push('a-aus')
    })
    runInLane({ conversationId: 'b', lane: 'cloud' }, async () => {
      spur.push('b-an'); await b.versprechen; spur.push('b-aus')
    })

    expect(spur).toEqual(['a-an', 'b-an'])
    expect(queuedRunIds()).toEqual([])
    a.aufloesen(); b.aufloesen()
  })

  it('ein Cloud-Lauf belegt die lokale Spur nicht', () => {
    const a = steuerbar()
    runInLane({ conversationId: 'wolke', lane: 'cloud' }, async () => { await a.versprechen })
    expect(localLaneHolder()).toBeNull()
    // Und ein lokaler Lauf startet daneben sofort.
    const b = steuerbar()
    runInLane({ conversationId: 'karte', lane: 'local' }, async () => { await b.versprechen })
    expect(localLaneHolder()).toBe('karte')
    a.aufloesen(); b.aufloesen()
  })

  it('vier Cloud-Laeufe, vier offene Buchungen nebeneinander', () => {
    const enden = ['a', 'b', 'c', 'd'].map((id) => {
      const s = steuerbar()
      runInLane({ conversationId: id, lane: 'cloud' }, async () => { await s.versprechen })
      return s
    })
    expect(Object.keys(useGenerationStore.getState().runs).sort()).toEqual(['a', 'b', 'c', 'd'])
    for (const e of enden) e.aufloesen()
  })
})

describe('lokal: einreihbar statt unmoeglich', () => {
  it('der zweite lokale Lauf wird eingereiht, nicht abgelehnt', async () => {
    // Der Unterschied zum Ist-Zustand: der zweite Auftrag ist heute gar nicht
    // absendbar, ohne den ersten abzubrechen. Hier ist er gebucht und wartet.
    const a = steuerbar()
    let bLief = false
    runInLane({ conversationId: 'a', lane: 'local' }, async () => { await a.versprechen })
    const laufB = runInLane({ conversationId: 'b', lane: 'local' }, async () => { bLief = true })

    expect(bLief).toBe(false)
    expect(localLaneHolder()).toBe('a')
    expect(queuedRunIds()).toEqual(['b'])
    expect(runQueuePosition('b')).toBe(1)
    // Gebucht ist er trotzdem, mit seiner Spur: das liest das Warteplaettchen.
    expect(useGenerationStore.getState().runs['b']?.lane).toBe('local')

    a.aufloesen()
    await laufB
    expect(bLief).toBe(true)
  })

  it('die Reihenfolge bleibt, und die Spur wandert weiter', async () => {
    const a = steuerbar()
    const spur: string[] = []
    const laufA = runInLane({ conversationId: 'a', lane: 'local' }, async () => {
      spur.push('a'); await a.versprechen
    })
    const laufB = runInLane({ conversationId: 'b', lane: 'local' }, async () => { spur.push('b') })
    const laufC = runInLane({ conversationId: 'c', lane: 'local' }, async () => { spur.push('c') })
    expect(queuedRunIds()).toEqual(['b', 'c'])
    expect(runQueuePosition('c')).toBe(2)

    a.aufloesen()
    await Promise.all([laufA, laufB, laufC])
    expect(spur).toEqual(['a', 'b', 'c'])
    expect(localLaneHolder()).toBeNull()
    expect(useGenerationStore.getState().runs).toEqual({})
  })

  it('waehrend der Lauf laeuft, steht seine Spur ablesbar im Store', () => {
    const a = steuerbar()
    runInLane({ conversationId: 'a', lane: 'local' }, async () => { await a.versprechen })
    expect(useGenerationStore.getState().runs['a']?.lane).toBe('local')
    a.aufloesen()
  })
})

// ── DIE GEFAEHRLICHSTE STELLE DES GANZEN AUFTRAGS ───────────────────────────
describe('die Spur wird zurueckgegeben, egal wie der Lauf ausgeht', () => {
  it('ein Lauf, der wirft, gibt die Spur trotzdem frei', async () => {
    await expect(
      runInLane({ conversationId: 'a', lane: 'local' }, async () => { throw new Error('kaputt') }),
    ).rejects.toThrow('kaputt')
    expect(localLaneHolder()).toBeNull()
    expect(useGenerationStore.getState().runs['a']).toBeUndefined()
  })

  it('und der Wartende hinter ihm kommt dran, statt fuer immer zu warten', async () => {
    // Ohne Freigabe im Fehlerfall stuende hier die lokale Spur bis zum
    // Neustart, und jeder weitere lokale Lauf reihte sich in eine Schlange
    // ein, die niemand mehr abarbeitet.
    const a = steuerbar()
    let bLief = false
    const laufA = runInLane({ conversationId: 'a', lane: 'local' }, async () => {
      await a.versprechen
    })
    const laufB = runInLane({ conversationId: 'b', lane: 'local' }, async () => { bLief = true })

    a.ablehnen(new Error('Netz weg'))
    await expect(laufA).rejects.toThrow('Netz weg')
    await laufB
    expect(bLief).toBe(true)
    expect(localLaneHolder()).toBeNull()
  })

  it('ein abgebrochener Lauf gibt die Spur frei, und der Naechste laeuft an', async () => {
    const a = steuerbar()
    let abgebrochen = 0
    let bLief = false
    const laufA = runInLane(
      {
        conversationId: 'a',
        lane: 'local',
        abort: () => { abgebrochen++; a.ablehnen(new Error('AbortError')) },
      },
      async () => { await a.versprechen },
    )
    const laufB = runInLane({ conversationId: 'b', lane: 'local' }, async () => { bLief = true })

    useGenerationStore.getState().abortConversation('a')
    expect(abgebrochen).toBe(1)

    await expect(laufA).rejects.toThrow('AbortError')
    await laufB
    expect(bLief).toBe(true)
    expect(localLaneHolder()).toBeNull()
  })

  it('auch der Erfolgsfall raeumt auf: kein Halter, keine Buchung, kein Abbruchgriff', async () => {
    await runInLane({ conversationId: 'a', lane: 'local' }, async () => {})
    expect(localLaneHolder()).toBeNull()
    expect(useGenerationStore.getState().runs['a']).toBeUndefined()
    expect(useGenerationStore.getState().aborters['a']).toBeUndefined()
  })
})

describe('Stop auf einen Lauf, der noch wartet', () => {
  it('er faellt aus der Schlange, und sein Rumpf laeuft nie', async () => {
    // Heute hat ein wartender Lauf gar keinen Abbruchgriff: der Rumpf, der
    // ihn registriert, hat noch nicht angefangen. Der Griff wird deshalb
    // schon beim Anstellen gesetzt, sonst haette Stop nichts zu greifen.
    const a = steuerbar()
    let bLief = false
    runInLane({ conversationId: 'a', lane: 'local' }, async () => { await a.versprechen })
    const laufB = runInLane({ conversationId: 'b', lane: 'local' }, async () => { bLief = true })

    useGenerationStore.getState().abortConversation('b')

    await expect(laufB).resolves.toBe('cancelled-while-queued')
    expect(bLief).toBe(false)
    expect(queuedRunIds()).toEqual([])
    expect(useGenerationStore.getState().runs['b']).toBeUndefined()
    a.aufloesen()
  })

  it('und niemand rueckt dabei nach, denn der Halter rechnet noch', async () => {
    const a = steuerbar()
    let cLief = false
    runInLane({ conversationId: 'a', lane: 'local' }, async () => { await a.versprechen })
    const laufB = runInLane({ conversationId: 'b', lane: 'local' }, async () => {})
    runInLane({ conversationId: 'c', lane: 'local' }, async () => { cLief = true })

    useGenerationStore.getState().abortConversation('b')
    await laufB
    await takte()

    expect(cLief).toBe(false)
    expect(localLaneHolder()).toBe('a')
    expect(queuedRunIds()).toEqual(['c'])
    a.aufloesen()
  })

  it('der Uebernaechste kommt dran, nicht der abgebrochene', async () => {
    const a = steuerbar()
    const spur: string[] = []
    const laufA = runInLane({ conversationId: 'a', lane: 'local' }, async () => { await a.versprechen })
    const laufB = runInLane({ conversationId: 'b', lane: 'local' }, async () => { spur.push('b') })
    const laufC = runInLane({ conversationId: 'c', lane: 'local' }, async () => { spur.push('c') })

    useGenerationStore.getState().abortConversation('b')
    a.aufloesen()
    await Promise.all([laufA, laufB, laufC])
    expect(spur).toEqual(['c'])
  })
})

// ── BLOCKER A (Opus-Review Runde 2) ─────────────────────────────────────────
//
// Hier stand bis Runde 5 "der verschachtelte Lauf gibt die Spur des
// Elternlaufs nicht frei": ein Zaehler (`tiefe`) liess einen ZWEITEN
// `runInLane`-Aufruf mit derselben `conversationId` sofort durch, solange der
// erste noch lief, gedacht fuer einen Vordergrund-Sub-Agenten. Diesen
// Aufrufer gibt es nicht mehr (`sub-agent.ts` ruft `provider.chatWithTools`
// direkt, nie `runInLane`, nachgesehen per grep), und der Zaehler traf
// stattdessen jeden Stop-dann-sofort-neu-senden auf derselben Unterhaltung:
// der neue Lauf lief unblockiert und ungebucht, WAEHREND der alte noch in
// seinem eigenen `finally` steckte. Die drei Tests hier ersetzen das durch
// das Verhalten, das jetzt gilt: JEDER Aufruf ist ein eigener Lauf, auch mit
// identischer `conversationId`.
describe('Stop und sofortiges Neusenden: der neue Lauf ist ein EIGENER Lauf', () => {
  it('Opus-Szenario: A haelt, C wartet, Stop A, sofort A neu: A-neu stellt sich HINTER C an', async () => {
    // Aufbau wie im Wegwerf-Test aus review-lanes.md: drei Unterhaltungen,
    // A haelt die Spur, C hat sich schon angestellt, WAEHREND A noch laeuft.
    // C bekommt einen STEUERBAREN Rumpf, sonst laeuft er (ohne eigenes await)
    // im selben Tick durch wie A-neu und die beiden lassen sich nicht mehr
    // auseinanderhalten.
    const a = steuerbar()
    const c = steuerbar()
    const spur: string[] = []
    const laufA = runInLane({ conversationId: 'a', lane: 'local' }, async () => {
      spur.push('a-an'); await a.versprechen; spur.push('a-aus')
    })
    const laufC = runInLane({ conversationId: 'c', lane: 'local' }, async () => {
      spur.push('c-an'); await c.versprechen; spur.push('c-aus')
    })
    expect(localLaneHolder()).toBe('a')
    expect(queuedRunIds()).toEqual(['c'])

    // Stop in A: der Sendeweg bricht seinen eigenen Fetch ab, aber der
    // `runInLane`-Rumpf steckt noch in `await a.versprechen` (das Analogon zu
    // den gemessenen 300-500 ms `endTurnDurably`). Sein `finally` ist noch
    // NICHT gelaufen.
    useGenerationStore.getState().abortConversation('a')

    // Sofortiges Neusenden: ein ZWEITER, unabhaengiger `runInLane`-Aufruf mit
    // DERSELBEN conversationId, waehrend der erste noch offen ist.
    let neuAGelaufen = false
    const laufANeu = runInLane({ conversationId: 'a', lane: 'local' }, async () => { neuAGelaufen = true })

    // VOR der Nachbesserung waere hier `neuAGelaufen === true` gewesen (der
    // Fastpath liess ihn sofort durch, ungebucht). Jetzt stellt er sich an.
    expect(neuAGelaufen).toBe(false)
    expect(queuedRunIds()).toEqual(['c', 'a'])
    // Zu keinem Zeitpunkt haelt irgendwer ausser dem ALTEN A-Lauf die Spur:
    expect(localLaneHolder()).toBe('a')

    // Der alte A-Lauf wickelt sich jetzt wirklich ab.
    a.aufloesen()
    await laufA
    await takte()

    // C ist dran, NICHT der neue A-Lauf: FIFO nach Ankunftszeit, C hat sich
    // angestellt, bevor A-neu ueberhaupt existierte. C haengt jetzt selbst in
    // seinem eigenen `await`, also ist das der Moment, an dem sich "C laeuft"
    // und "A-neu laeuft noch nicht" wirklich auseinanderhalten lassen.
    expect(spur).toEqual(['a-an', 'a-aus', 'c-an'])
    expect(neuAGelaufen).toBe(false)
    expect(localLaneHolder()).toBe('c')
    expect(queuedRunIds()).toEqual(['a'])

    // C beendet seinen Zug. Erst DANACH darf A-neu drankommen.
    c.aufloesen()
    await laufC
    await takte()

    expect(spur).toEqual(['a-an', 'a-aus', 'c-an', 'c-aus'])
    await laufANeu
    expect(neuAGelaufen).toBe(true)
    expect(localLaneHolder()).toBeNull()
  })

  it('zwei unabhaengige Laeufe derselben Unterhaltung geben je ihre EIGENE Buchung zurueck', async () => {
    // Ergaenzung zur Buchungsseite (generationStore.runs): das spaet kommende
    // `finally` des ALTEN Laufs darf die Buchung des NEUEN nicht wegraeumen.
    // A-neu bekommt einen STEUERBAREN Rumpf, sonst ist er schon fertig (und
    // hat seine eigene Buchung schon wieder geloescht), bevor der Test
    // nachsehen kann.
    const a = steuerbar()
    const aNeu = steuerbar()
    const laufA = runInLane({ conversationId: 'a', lane: 'local' }, async () => { await a.versprechen })
    expect(useGenerationStore.getState().runs['a']?.lane).toBe('local')

    const laufANeu = runInLane({ conversationId: 'a', lane: 'local' }, async () => { await aNeu.versprechen })
    // A-neu wartet (A haelt noch), ist aber trotzdem schon gebucht.
    expect(useGenerationStore.getState().runs['a']).toBeDefined()

    a.aufloesen()
    await laufA
    await takte()
    // Jetzt laeuft A-neu: die Buchung muss noch stehen, das alte `finally`
    // darf sie nicht geloescht haben.
    expect(useGenerationStore.getState().runs['a']).toBeDefined()
    aNeu.aufloesen()
    await laufANeu
    expect(useGenerationStore.getState().runs['a']).toBeUndefined()
  })
})

describe('die Uebergabe verbindet die beiden Laeufe nicht', () => {
  it('ein Fehler des Nachrueckenden faellt nicht in die Abwicklung des Vorigen', async () => {
    // Der Grund, warum `release` seinen Startaufruf nicht selbst ruft, steht
    // in run-lanes.ts: sonst schluepfte ein Fehler des naechsten Laufs in das
    // `finally` des vorigen. Hier wird der Aufruf im `finally` gemacht, und
    // er darf deshalb nur WECKEN, nie den fremden Lauf mitfuehren.
    const a = steuerbar()
    const laufA = runInLane({ conversationId: 'a', lane: 'local' }, async () => { await a.versprechen })
    const laufB = runInLane({ conversationId: 'b', lane: 'local' }, async () => {
      throw new Error('b kaputt')
    })

    a.aufloesen()
    await expect(laufA).resolves.toBe('ran')
    await expect(laufB).rejects.toThrow('b kaputt')
    expect(localLaneHolder()).toBeNull()
  })
})

describe('ein Lauf ohne Kennung laeuft, ohne etwas zu verklemmen', () => {
  it('er nimmt den Platz gar nicht erst', async () => {
    let lief = false
    await runInLane({ conversationId: '', lane: 'local' }, async () => { lief = true })
    expect(lief).toBe(true)
    expect(localLaneHolder()).toBeNull()
    expect(useGenerationStore.getState().runs).toEqual({})
  })
})

// ── Es muss EIN Aufrufer bleiben ────────────────────────────────────────────
const SRC = resolve(__dirname, '..', '..')
const DATEIEN = quelldateien(SRC, { relativZu: SRC })

/** Namen, die eine Datei aus run-lanes holt. */
function holtAusSpurmodul(inhalt: string): string[] {
  const namen: string[] = []
  const muster = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*'[^']*run-lanes'/g
  for (const treffer of inhalt.matchAll(muster)) {
    for (const teil of treffer[1].split(',')) {
      const name = teil.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()
      if (name) namen.push(name)
    }
  }
  return namen
}

describe('nur eine Datei nimmt und gibt die Spur', () => {
  it('run-slot.ts holt admit UND release', () => {
    const quelle = quelltext(DATEIEN, 'lib/run-slot.ts')
    expect(holtAusSpurmodul(quelle)).toEqual(expect.arrayContaining(['admit', 'release']))
  })

  it('und sonst niemand im ganzen Quellbaum', () => {
    // Das Muster, an dem dieses Haus am haeufigsten scheitert, ist "zwei
    // Pfade, einer gepflegt". Bei dieser Sperre heisst der ungepflegte Pfad
    // "einer hat das finally vergessen", und die Folge ist eine lokale Spur,
    // die bis zum Neustart steht. Also gibt es genau einen Pfad.
    const erlaubt = new Set(['lib/run-slot.ts'])
    const suender = DATEIEN
      .filter(([name]) => !erlaubt.has(name))
      .filter(([, inhalt]) => holtAusSpurmodul(inhalt).some((n) => n === 'admit' || n === 'release'))
      .map(([name]) => name)
    expect(suender).toEqual([])
  })

  it('die Ablesefragen darf dagegen jeder stellen', () => {
    // GEGENPROBE zur Regel darueber: sie sperrt das Nehmen und Zurueckgeben,
    // nicht das Hinsehen. run-idle.ts liest die Schlange, und das soll es.
    const quelle = quelltext(DATEIEN, 'lib/run-idle.ts')
    const namen = holtAusSpurmodul(quelle)
    expect(namen).toContain('isRunQueued')
    expect(namen).not.toContain('release')
  })
})
