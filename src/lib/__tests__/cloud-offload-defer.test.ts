/**
 * Fund F3 (lu-301/bau/leer2.md): der Cloud-Wechsel raeumte den lokalen Motor
 * unbedingt weg, auch waehrend eine ANDERE Unterhaltung gerade lokal
 * generierte. Diese endete dann mit "Connection dropped", ohne dass der
 * Nutzer diese Unterhaltung angefasst hatte.
 *
 * `offloadWhenLocalLaneFree` (../cloud-offload-defer.ts) ist die Antwort:
 * `runOffload` sofort, wenn kein lokaler Lauf laeuft (Negativkontrolle:
 * dieser Fall darf sich durch den Umbau NICHT aendern), sonst erst, wenn der
 * letzte lokale Lauf endet, ueber ein Abo auf den Store und nicht ueber
 * Nachfragen in einer Schleife.
 *
 * Lauf: npx vitest run src/lib/__tests__/cloud-offload-defer.test.ts
 */
import { describe, it, expect, vi } from 'vitest'
import { hasActiveLocalRun, offloadWhenLocalLaneFree, type BookedRun, type RunsStore } from '../cloud-offload-defer'

/**
 * Ein Store-Doppel, klein genug, um jeden Zustandswechsel per Hand zu
 * treiben, statt den echten `generationStore` samt Zustand-Laufzeit
 * mitzuschleppen. `set` benachrichtigt genau wie `zustand.subscribe`: jeder
 * angemeldete Hoerer bekommt den neuen Zustand, kein Intervall fragt nach.
 */
function fakeRunsStore(initial: Record<string, BookedRun> = {}): RunsStore & {
  set: (runs: Record<string, BookedRun>) => void
  listenerCount: () => number
} {
  let runs = initial
  const listeners = new Set<(state: { runs: Record<string, BookedRun> }) => void>()
  return {
    getState: () => ({ runs }),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: (next) => {
      runs = next
      for (const l of listeners) l({ runs })
    },
    listenerCount: () => listeners.size,
  }
}

describe('hasActiveLocalRun', () => {
  it('ist falsch ohne Eintraege', () => {
    expect(hasActiveLocalRun({})).toBe(false)
  })

  it('ist falsch, wenn nur Cloud-Laeufe gebucht sind', () => {
    expect(hasActiveLocalRun({ a: { lane: 'cloud' } })).toBe(false)
  })

  it('ist wahr bei mindestens einem lokalen Lauf, egal wie viele Cloud-Laeufe daneben stehen', () => {
    expect(hasActiveLocalRun({ a: { lane: 'cloud' }, b: { lane: 'local' } })).toBe(true)
  })
})

describe('offloadWhenLocalLaneFree', () => {
  // Test 4 aus dem Auftrag: Wechsel ohne laufenden lokalen Lauf ist sofortiger
  // Aufruf wie bisher. Negativkontrolle fuer die anderen Tests: ohne diesen
  // hier waere nicht bewiesen, dass der Umbau den unveraenderten Fall wirklich
  // unveraendert laesst.
  it('ruft runOffload sofort, wenn kein lokaler Lauf laeuft', () => {
    const store = fakeRunsStore({ a: { lane: 'cloud' } })
    const runOffload = vi.fn()
    offloadWhenLocalLaneFree(store, runOffload)
    expect(runOffload).toHaveBeenCalledTimes(1)
    expect(store.listenerCount()).toBe(0)
  })

  // Test 5 aus dem Auftrag: ein laufender CLOUD-Lauf schiebt nichts auf.
  it('schiebt nichts auf, wenn nur ein Cloud-Lauf aktiv ist', () => {
    const store = fakeRunsStore({ x: { lane: 'cloud' }, y: { lane: 'cloud' } })
    const runOffload = vi.fn()
    offloadWhenLocalLaneFree(store, runOffload)
    expect(runOffload).toHaveBeenCalledTimes(1)
  })

  // Test 1 aus dem Auftrag: Wechsel auf Cloud waehrend lokalem Lauf ruft
  // runOffload NICHT auf.
  it('ruft runOffload NICHT auf, solange ein lokaler Lauf laeuft', () => {
    const store = fakeRunsStore({ a: { lane: 'local' } })
    const runOffload = vi.fn()
    offloadWhenLocalLaneFree(store, runOffload)
    expect(runOffload).not.toHaveBeenCalled()
    expect(store.listenerCount()).toBe(1)
  })

  // Test 2 aus dem Auftrag: nach Laufende wird genau einmal aufgerufen.
  it('holt den Offload genau einmal nach, sobald der letzte lokale Lauf endet', () => {
    const store = fakeRunsStore({ a: { lane: 'local' } })
    const runOffload = vi.fn()
    offloadWhenLocalLaneFree(store, runOffload)
    expect(runOffload).not.toHaveBeenCalled()

    // Ein zweiter lokaler Lauf kommt dazu, keiner endet: weiterhin nichts.
    store.set({ a: { lane: 'local' }, b: { lane: 'local' } })
    expect(runOffload).not.toHaveBeenCalled()

    // Der erste endet, der zweite haelt die Spur noch: weiterhin nichts.
    store.set({ b: { lane: 'local' } })
    expect(runOffload).not.toHaveBeenCalled()

    // Der letzte lokale Lauf endet: jetzt und nur jetzt.
    store.set({})
    expect(runOffload).toHaveBeenCalledTimes(1)
    expect(store.listenerCount()).toBe(0)

    // Ein weiterer Stoss (etwa ein neuer Cloud-Lauf) darf keinen zweiten
    // Aufruf mehr ausloesen: das Abo hat sich beim Nachholen selbst abgemeldet.
    store.set({ c: { lane: 'cloud' } })
    expect(runOffload).toHaveBeenCalledTimes(1)
  })

  // Test 3 aus dem Auftrag: Rueckwechsel auf Local vor Laufende (die
  // Abmeldefunktion wird gerufen, wie es AppShell.tsx im useEffect-Aufraeumer
  // tut): kein Aufruf, auch nicht wenn der lokale Lauf danach noch endet.
  it('entfaellt ersatzlos, wenn die Abmeldung vor Laufende gerufen wird', () => {
    const store = fakeRunsStore({ a: { lane: 'local' } })
    const runOffload = vi.fn()
    const cancel = offloadWhenLocalLaneFree(store, runOffload)

    cancel()
    expect(store.listenerCount()).toBe(0)

    store.set({})
    expect(runOffload).not.toHaveBeenCalled()
  })

  it('eine zweite Abmeldung nach dem Nachholen ist folgenlos', () => {
    const store = fakeRunsStore({ a: { lane: 'local' } })
    const runOffload = vi.fn()
    const cancel = offloadWhenLocalLaneFree(store, runOffload)
    store.set({})
    expect(runOffload).toHaveBeenCalledTimes(1)
    expect(() => cancel()).not.toThrow()
  })
})
