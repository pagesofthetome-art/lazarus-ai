/**
 * Der Cloud-Wechsel raeumt lokale Modelle weg. Ein laufender lokaler Zug darf
 * dabei nicht sterben.
 *
 * ── DER FUND (F3, lu-301/bau/leer2.md) ───────────────────────────────────────
 *
 * `AppShell.tsx` rief beim Wechsel in den Cloud-Modus bisher unbedingt
 * `offload_local_models`, das auf der Rust-Seite den Motor beendet
 * (`engine.rs:3661`). Lief in einer ANDEREN Unterhaltung gerade eine lokale
 * Generierung (Chat, Agent, Code, Gruppe, oder Create auf dem lokalen Motor),
 * endete sie mit "Connection dropped", ohne dass der Nutzer den Hauptschalter
 * fuer diese Unterhaltung angefasst hatte. 3.0.1 verspricht, dass Chats
 * gleichzeitig laufen und Stop in einem den anderen nicht beendet; ein
 * Moduswechsel, der einen laufenden lokalen Lauf still toetet, widerspricht
 * dem aus Nutzersicht.
 *
 * ── DIE ANTWORT ──────────────────────────────────────────────────────────────
 *
 * Der Offload wird AUFGESCHOBEN, solange mindestens ein Lauf die lokale Spur
 * belegt, und nachgeholt, sobald der letzte davon endet (normal, per Stop
 * oder per Fehler). `generationStore.runs` ist dafuer die verlaessliche
 * Quelle: jeder `runInLane`-Aufrufer bucht dort fuer genau die Zeit, die er
 * seine Spur haelt, vom Anstellen bis zum `finally` in `run-slot.ts`, egal ob
 * Chat, Agent, Code, Gruppenlauf oder Create den lokalen Motor benutzt. Ein
 * Cloud-Lauf blockiert nichts: nur `lane === 'local'` zaehlt.
 *
 * ── WARUM EIN ABO UND KEIN POLLING ───────────────────────────────────────────
 *
 * `store.subscribe` weckt genau dann, wenn sich `runs` aendert, kein
 * Intervall fragt zwischendurch nach. Endet der letzte lokale Lauf, meldet
 * `endRun` das sofort ueber den Store, dieselbe Anmeldung, mit der auch die
 * Warteschlangen-Anzeige in `run-lanes.ts` arbeitet.
 *
 * ── DER RUECKWEG ─────────────────────────────────────────────────────────────
 *
 * Der Aufrufer bekommt eine Abmeldefunktion zurueck. Wechselt der Nutzer vor
 * dem Nachholen zurueck auf Local, ruft er sie: die Anmeldung verschwindet,
 * `runOffload` wird nie gerufen, der Offload entfaellt komplett, statt
 * verspaetet einzutreffen. Ohne aktiven lokalen Lauf laeuft `runOffload`
 * sofort, unveraendert zum bisherigen Verhalten.
 *
 * ── AUFLAGE B2 (review-leer2-offload.md): DER PREIS DES AUFSCHUBS ───────────
 *
 * Dieser Aufschub ist ein Tausch, kein reiner Gewinn. Haengt ein lokaler Lauf
 * fest (Modell antwortet nicht mehr, Motor haengt, o.ae.), bucht er seine
 * Spur in `generationStore.runs` weiter, bis der Nutzer selbst Stop drueckt
 * oder der Lauf mit einem Fehler endet: `hasActiveLocalRun` sieht in diesem
 * Fenster keinen Unterschied zwischen "arbeitet noch" und "haengt fest".
 * Solange das so ist, laeuft `runOffload` nicht, das lokale Modell bleibt
 * geladen, und der VRAM, den es haelt, bleibt belegt, obwohl der Nutzer
 * laengst auf Cloud umgeschaltet hat. Das ist der bewusste Gegenwert zum
 * Fix oben (kein stilles "Connection dropped" fuer einen echten Lauf mehr):
 * ein haengender Lauf haelt jetzt VRAM fest statt eine fremde Unterhaltung
 * zu toeten. Der einzige Ausweg aus diesem Zustand ist Stop auf dem
 * haengenden Lauf selbst.
 *
 * Zweiter Preis (R2-4, lu-301/bau/review-offload2.md, Runde 2): beendet der
 * Nutzer die App, waehrend ein Entladen wartet, raeumt `shutdown_subprocesses`
 * nur die eigenen Kindprozesse des eingebauten Motors weg, nie ein
 * LM-Studio- oder Ollama-Modell, das dadurch nie entladen wird. Ollama holt
 * das ueber sein eigenes `keep_alive` irgendwann von selbst nach, LM Studio
 * je nach dortiger Einstellung gar nicht.
 */

/** Die eine Tatsache, an der sich alles hier entscheidet. */
export interface BookedRun {
  lane: 'local' | 'cloud'
}

/** Die schmale Sicht auf `generationStore`, die dieses Modul braucht. */
export interface RunsStore {
  getState: () => { runs: Record<string, BookedRun> }
  subscribe: (listener: (state: { runs: Record<string, BookedRun> }) => void) => () => void
}

/** Belegt gerade irgendein Lauf die lokale Spur? */
export function hasActiveLocalRun(runs: Record<string, BookedRun>): boolean {
  return Object.values(runs).some((run) => run.lane === 'local')
}

/**
 * `runOffload` sofort rufen, wenn kein lokaler Lauf laeuft, sonst erst, wenn
 * der letzte lokale Lauf endet. Gibt eine Abmeldefunktion zurueck: aufgerufen
 * BEVOR der Offload nachgeholt wurde, entfaellt er ersatzlos.
 *
 * Kein Rueckgabewert zeigt, ob nachgeholt wurde oder sofort gelaufen ist: der
 * Aufrufer (`AppShell.tsx`) braucht das nicht, er haengt die Abmeldung nur an
 * seinen `useEffect`-Aufraeumer, egal welcher der beiden Wege gelaufen ist.
 */
export function offloadWhenLocalLaneFree(store: RunsStore, runOffload: () => void): () => void {
  if (!hasActiveLocalRun(store.getState().runs)) {
    runOffload()
    return () => {}
  }

  const unsubscribe = store.subscribe((state) => {
    if (hasActiveLocalRun(state.runs)) return
    unsubscribe()
    runOffload()
  })
  return unsubscribe
}
