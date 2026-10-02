/**
 * Architektur-Parity: Agent-Modus (useAgentChat.ts) und Code-Reiter
 * (useCodex.ts) waren gegen den Geisterzustand aus
 * `fenster-schliessen-beendet-den-geisterzustand.test.ts` schon IMMUN,
 * plain Chat (useChat.ts, `sendMessage` + `runGroupRound`) NICHT - siehe
 * ausfuehrliche Begruendung dort und im Kommentar an `endTurnDurably`s
 * Aufrufstelle in useChat.ts.
 *
 * Der Unterschied ist genau EINE Zeile pro Datei: woran der
 * `stillOwnsSlot`-Wiedereintritts-Check haengt.
 *
 *   - useAgentChat.ts / useCodex.ts: `activeAgentRuns.get(convId)` /
 *     `activeCodexRuns.get(convId)` - eine PRIVATE Map, die AUSSCHLIESSLICH
 *     der eigene Lauf, `stopAgent`/`stopCodex` und der eigene
 *     Wiedereintritts-Riegel je anfassen. `stopAllBackgroundWork()`
 *     (Fenster schliessen, Abmelden, App beenden) ruft NUR
 *     `generationStore.abortConversation()`, `stopRun()`,
 *     `agentTaskStore.cancelAll()` und `agentLoopStore.clear()` - keins
 *     davon fasst diese privaten Maps an. Wenn der Lauf real endet, zeigt
 *     seine private Map also immer noch korrekt auf ihn, `stillOwnsSlot`
 *     ist wahr, und `isAgentRunning`/`isRunning` faellt zuverlaessig.
 *
 *   - useChat.ts (vor diesem Fix): `useGenerationStore.getState()
 *     .aborters[convId]` - GENAU die Map, die `abortConversation()` SOFORT
 *     und OHNE Ersatzlauf loescht. Das macht `stillOwnsSlot` in jedem
 *     Fenster-schliessen/Abmelden/App-beenden-Fall zuverlaessig falsch,
 *     lange bevor der eigentliche Lauf ueberhaupt zu Ende ist - siehe
 *     fenster-schliessen-beendet-den-geisterzustand.test.ts fuer den
 *     Laufzeitbeweis (Rot ohne den Fix, Gruen mit ihm).
 *
 * Dieser Test pinnt die Architektur-Invariante strukturell, als billigen,
 * dauerhaften Waechter gegen ein Zurueckrutschen: `isGenerating` in
 * useChat.ts muss UNBEDINGT aus der eigenen, privaten `activeChatRuns`-Map
 * neu berechnet werden (wie `isAgentRunning`/`isRunning` es in den beiden
 * Nachbardateien schon immer tun), nicht mehr unter `if (stillOwnsSlot)`
 * stehen.
 *
 * Run: npx vitest run src/hooks/__tests__/geisterzustand-architektur-parity.test.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const useChatSrc = readFileSync(resolve(here, '../useChat.ts'), 'utf8')
const useAgentChatSrc = readFileSync(resolve(here, '../useAgentChat.ts'), 'utf8')
const useCodexSrc = readFileSync(resolve(here, '../useCodex.ts'), 'utf8')

describe('Agent-Modus und Code-Reiter: der Wiedereintritts-Check haengt an der EIGENEN Map', () => {
  it('useAgentChat.ts: stillOwnsSlot vergleicht gegen activeAgentRuns, nicht gegen generationStore.aborters', () => {
    expect(useAgentChatSrc).toContain('const stillOwnsSlot = activeAgentRuns.get(convId) === runState')
  })

  it('useAgentChat.ts: isAgentRunning wird IMMER aus activeAgentRuns.size neu berechnet, nicht nur wenn stillOwnsSlot gilt', () => {
    const stelle = useAgentChatSrc.indexOf('setIsAgentRunning(activeAgentRuns.size > 0)')
    expect(stelle).toBeGreaterThan(-1)
    // Keine `if (stillOwnsSlot)`-Zeile unmittelbar davor, die den Aufruf selbst umschliesst.
    const davor = useAgentChatSrc.slice(Math.max(0, stelle - 200), stelle)
    expect(davor).not.toMatch(/if \(stillOwnsSlot\)\s*{\s*$/)
  })

  it('useCodex.ts: stillOwnsSlot vergleicht gegen activeCodexRuns, nicht gegen generationStore.aborters', () => {
    expect(useCodexSrc).toContain('const stillOwnsSlot = activeCodexRuns.get(convId) === runToken')
  })
})

describe('Chat (Einzelmodell + Gruppenrunde): isGenerating haengt jetzt auch an der eigenen Map', () => {
  it('sendMessage: setIsGenerating(activeChatRuns.size > 0) steht UNBEDINGT, nicht unter if (stillOwnsSlot)', () => {
    const stelle = useChatSrc.indexOf('setIsGenerating(activeChatRuns.size > 0)')
    expect(stelle).toBeGreaterThan(-1)
    const davor = useChatSrc.slice(Math.max(0, stelle - 400), stelle)
    // Zwei Fundstellen (sendMessage + runGroupRound); an KEINER darf die
    // Zeile selbst hinter einem `if (stillOwnsSlot) {` haengen.
    expect(davor).not.toMatch(/if \(stillOwnsSlot\)\s*{\s*(\/\/[^\n]*\n\s*)*$/)
  })

  it('alle fuenf Fundstellen sind vorhanden: einzelner Chat (zweimal), Gruppenrunde (zweimal) UND /compact bekamen den Fix', () => {
    // Auflage 2 (Review composer, 19.09.2026): `/compact` reihte sich in
    // dieselbe Invariante ein, seitdem sind es drei statt zwei Fundstellen.
    // Auflage 8 (Review composer Runde 2, 19.09.2026): `runGroupRound` bekam
    // zusaetzlich ein AEUSSERES `finally` um den ganzen Rumpf (schliesst die
    // Luecke zwischen dem Claim und `runInLane`, siehe Kommentar dort), das
    // bei einem Wurf VOR `runInLane` dieselbe Neuberechnung noch einmal
    // ausfuehrt - im Normalfall ist es ein No-op, weil das innere `finally`
    // schon geraeumt hat. Seitdem sind es vier statt drei Fundstellen.
    // Auflage 1 (Review Teil 13, 19.09.2026): `sendMessage` bekam dasselbe
    // AEUSSERE `finally` um den ganzen Rumpf (schliesst die Luecke zwischen
    // dem Claim und dem ersten inneren `try`, u.a. den ungeschuetzten
    // `ragState.loadChunksFromDB`-Aufruf), ebenfalls ein No-op im Normalfall.
    // Seitdem sind es fuenf statt vier Fundstellen.
    const treffer = useChatSrc.split('setIsGenerating(activeChatRuns.size > 0)').length - 1
    expect(treffer).toBe(5)
  })

  it('generationStore.aborters bleibt der Massstab fuer die STORE-eigene Fahne (review-lanes.md Punkt 1) - der Fix aendert daran nichts', () => {
    // setGenerating(..., false) darf weiterhin unter stillOwnsSlot stehen:
    // ein spaet kommendes finally eines abgeloesten Laufs darf die
    // Buchung eines NEUEN Laufs auf derselben Unterhaltung nicht loeschen.
    const treffer = useChatSrc.split('useGenerationStore.getState().setGenerating(run.convId, false)').length - 1
      + useChatSrc.split('useGenerationStore.getState().setGenerating(convId, false)').length - 1
    expect(treffer).toBeGreaterThanOrEqual(2)
  })
})
