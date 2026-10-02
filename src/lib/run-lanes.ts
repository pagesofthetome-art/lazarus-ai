/**
 * Zwei Spuren, eine Regel: darf dieser Lauf JETZT starten?
 *
 * `cloud` startet immer. `local` startet nur, wenn gerade kein anderer lokaler
 * Lauf laeuft; sonst stellt er sich hinten an und wird der Reihe nach geholt.
 *
 * ── WARUM LOKAL UEBERHAUPT SERIALISIERT WIRD ────────────────────────────────
 *
 * Weil zwei lokale Laeufe auf EINER Grafikkarte kein Gewinn sind, sondern ein
 * Tausch. Die Gewichte beider Modelle passen selten gleichzeitig ins VRAM,
 * also raeumt Ollama zwischen den Anfragen um: Modell A raus, Modell B rein,
 * bei der naechsten Anfrage wieder zurueck. Jeder Umzug kostet das volle
 * Laden. Zwei parallele lokale Laeufe sind danach beide langsamer als ein
 * einzelner es allein gewesen waere, und der Nutzer sieht zwei haengende
 * Chats statt eines fertigen.
 *
 * Bei `cloud` gibt es diesen Grund nicht. Dort steht keine Karte des Nutzers
 * dahinter, sondern fremde Kapazitaet, die ohnehin parallel bedient. Eine
 * Warteschlange waere dort reine Bremse ohne Gegenwert.
 *
 * ── WARUM DIE SPERRE AN DER KONVERSATION HAENGT UND NICHT AM ANBIETER ───────
 *
 * DAS IST DER TEIL, DER NICHT WEGOPTIMIERT WERDEN DARF.
 *
 * Naheliegend waere, die Serialisierung eine Ebene tiefer zu legen: jede
 * Anfrage an einen lokalen Anbieter nimmt eine Sperre, gibt sie beim Antworten
 * zurueck. Das waere ein Selbstblockierer, und zwar ein garantierter, kein
 * seltener:
 *
 *   Ein Elternlauf haelt die Spur und delegiert an einen VORDERGRUND-
 *   Sub-Agenten. `sub-agent.ts:661` macht daraus ein `return await runner(...)`
 *   Der Elternlauf steht also und wartet auf das Ergebnis. Der Sub-Agent
 *   ruft seinerseits `provider.chatWithTools` (`sub-agent.ts:524`), also
 *   dieselbe Ebene, auf der die Sperre laege. Er wartet auf eine Sperre, die
 *   der Elternlauf haelt; der Elternlauf wartet auf ihn. Beide warten fuer
 *   immer, und der einzige Knopf, der noch hilft, ist Abbrechen.
 *
 * Deshalb wird genau EINMAL pro sichtbarem Lauf zugelassen, benannt nach der
 * Konversation, die der Nutzer vor sich sieht und die auch der Stopp-Knopf
 * benennen kann. Alles, was dieser Lauf danach an Anfragen abschickt, also
 * Sub-Agenten, Werkzeugschritte und Wiederholungen, faehrt in seinem bereits
 * vergebenen Platz mit und fragt hier nie wieder an.
 *
 * ── FORM ────────────────────────────────────────────────────────────────────
 *
 * Modulzustand, keyed nach Konversation, kein React und kein Store: dieselbe
 * Bauform wie `run-stop.ts` daneben, und aus demselben Grund. Die Frage
 * ueberlebt jedes Aus- und Einhaengen der Ansicht, und sie muss ohne offenes
 * Fenster pruefbar sein. Die Regel steht damit an genau einer Stelle.
 *
 * ── WARUM DER MODULZUSTAND TROTZDEM BESCHEID SAGT ───────────────────────────
 *
 * Weil zwei Leser ihn brauchen, die von selbst nichts mitbekommen:
 *
 *   Die Oberflaeche soll das Warten ZEIGEN ("wartet auf die Grafikkarte,
 *   Platz 2"). Ohne Aufwecken malt React genau einmal und danach nie wieder,
 *   und das Plaettchen bliebe stehen, waehrend die Schlange vorrueckt.
 *
 *   `run-idle.ts` schiebt Dialoge auf, bis nichts mehr laeuft, und weckte
 *   dafuer nur an den beiden Speichern. Faellt der letzte Wartende aus der
 *   Schlange, aendert das keinen von beiden: der Dialog wartete auf die
 *   naechste fremde Aenderung.
 *
 * Deshalb gibt es `subscribeRunLanes`: der Weckruf fuer `useSyncExternalStore`,
 * dessen zweites Argument dann eine der schmalen Fragen hier ist
 * (`isRunQueued`, `runQueuePosition`). Eine gespeicherte Momentaufnahme mit
 * eigener Identitaet braucht es dafuer nicht: jede dieser Fragen antwortet
 * mit einem Boolean oder einer Zahl, und `===` vergleicht die schon richtig,
 * ohne dass irgendwo ein Objekt zwischengehalten werden muesste. Gespeichert
 * wird weiter nur hier, gelesen wird weiter nur hier. Ein Spiegel waere genau
 * der Grundfehler, gegen den `run-idle.ts` gebaut ist, eine Tatsache an zwei
 * Orten, die im Fenster dazwischen auseinanderlaufen.
 *
 * ── DIE KENNUNG UND DIE IDENTITAET SIND ZWEI VERSCHIEDENE DINGE ─────────────
 *
 * (Nachbesserung, Opus-Review Runde 2, BLOCKER A) `admit`/`release` nahmen bis
 * hierher an, dass zwei Aufrufe mit derselben `convId` immer DERSELBE Lauf
 * sind ("Derselbe Lauf fragt zweimal: er hat den Platz schon"). Das stimmt
 * fuer den einen Fall, fuer den es gedacht war (ein Elternlauf fragt sich
 * selbst noch einmal), und stimmt NICHT fuer den Fall, den `run-slot.ts` frueher
 * mit einem eigenen, fehlerhaften Zaehler abgefangen hat: Stop in einer
 * Unterhaltung, sofort danach neu gesendet. Der ALTE Lauf wickelt sich noch
 * ab (`endTurnDurably` braucht 300 bis 500 ms), sein `finally` hat die Spur
 * noch nicht zurueckgegeben, und der NEUE Lauf traegt dieselbe `convId`. Ohne
 * Unterscheidung waere der neue Lauf "derselbe Lauf, der noch einmal fragt"
 * und bekaeme den Platz sofort, obwohl der alte ihn noch haelt: zwei echte
 * Anfragen gegen den Motor gleichzeitig.
 *
 * Deshalb nimmt `admit`/`release` ein optionales viertes/zweites Argument,
 * `identity`. Ohne Angabe ist es die `convId` selbst, und jedes bestehende
 * Verhalten (alle Tests unten) bleibt exakt, wie es war: eine Anfrage ohne
 * eigene Identitaet gilt als Fortsetzung der letzten mit derselben `convId`.
 * `run-slot.ts` ist der einzige Aufrufer, der eine ECHTE Identitaet mitgibt,
 * ein frisches, undurchsichtiges Objekt je `runInLane`-Aufruf: fuer dieses
 * Modul sind zwei Aufrufe mit derselben `convId`, aber verschiedener
 * `identity`, zwei VERSCHIEDENE Laeufe. Der neue stellt sich hinten an, der
 * alte behaelt seinen Platz, bis sein eigenes `finally` ihn zurueckgibt. Die
 * `convId` bleibt dabei die sichtbare Kennung fuer die Warteschlangen-Anzeige
 * (`localLaneHolder`, `runQueuePosition`, `isRunQueued`, `queuedRunIds`): die
 * Oberflaeche fragt "wartet DIESE Unterhaltung", nicht "wartet DIESER Lauf".
 */

/** Woran ein Lauf rechnet: an der Karte des Nutzers oder woanders. */
export type RunLane = 'local' | 'cloud'

/** Das Urteil ueber einen Startwunsch. */
export type Admission = 'started' | 'queued'

/**
 * Was der Aufrufer tut, wenn er drankommt.
 *
 * Bewusst ohne Rueckgabewert: dieses Modul wartet auf nichts und faengt
 * nichts. Es sagt nur, WANN. Was der Lauf danach mit seinen Fehlern macht,
 * geht die Warteschlange nichts an.
 */
export type StartThunk = () => void

interface Wartend {
  convId: string
  /** Siehe Kopf: default `convId`, echt nur wenn der Aufrufer eine mitgibt. */
  identity: unknown
  start: StartThunk
}

/**
 * Die lokale Spur hat genau einen Platz. `null` heisst frei.
 *
 * Ein einzelner Halter und keine Zaehlung: der Sinn ist ja gerade, dass es
 * nicht zwei gleichzeitig gibt. Ein Zaehler mit Obergrenze 1 waere dieselbe
 * Aussage, nur mit einem Zustand mehr, in dem er falsch stehen kann.
 */
let halter: { convId: string; identity: unknown } | null = null

/** Wer wartet, in der Reihenfolge des Anstellens. */
const warteschlange: Wartend[] = []

const beobachter = new Set<() => void>()

/**
 * An der Spur hat sich etwas geaendert: alle Leser wecken.
 *
 * Der Fehler eines Lesers wird verschluckt, und das ist hier keine
 * Bequemlichkeit. Die lokale Spur ist die gefaehrlichste Stelle der App: wer
 * sie haengen laesst, legt jeden weiteren lokalen Lauf bis zum Neustart still.
 * Ein Fehler in einer fremden Anzeige darf das nicht ausloesen, und ein
 * halb durchlaufenes `release` waere genau das.
 */
function veraendert(): void {
  for (const l of beobachter) {
    try { l() } catch { /* die Anzeige ist kaputt, die Spur bleibt heil */ }
  }
}

/**
 * Bescheid sagen, wenn Halter oder Schlange sich aendern. Rueckgabe meldet ab.
 *
 * Gedacht als erstes Argument von `useSyncExternalStore`, zusammen mit einer
 * der schmalen Fragen unten (`isRunQueued`, `runQueuePosition`) als zweitem.
 */
export function subscribeRunLanes(listener: () => void): () => void {
  beobachter.add(listener)
  return () => { beobachter.delete(listener) }
}

/**
 * Der wievielte Wartende ist dieser Lauf? Ab eins, der Naechste ist die Eins.
 *
 * `null` fuer jeden, der nicht wartet, und ausdruecklich auch fuer den Halter.
 * Eine Null fuer ihn waere die Anzeige genau falsch herum: der Rechnende
 * stuende als Wartender da.
 */
export function runQueuePosition(conversationId: string | null | undefined): number | null {
  if (!conversationId) return null
  const i = warteschlange.findIndex((w) => w.convId === conversationId)
  return i < 0 ? null : i + 1
}

/**
 * Darf dieser Lauf jetzt starten?
 *
 * `'started'` heisst: du hast den Platz, fang an. UND DU MUSST `release` MIT
 * DERSELBEN KENNUNG RUFEN, wenn du fertig bist, im `finally`, auch bei Fehler
 * und Abbruch. Ein nicht zurueckgegebener Platz haelt die lokale Spur fuer den
 * Rest der Sitzung besetzt; jeder weitere lokale Lauf reiht sich dann in eine
 * Schlange ein, die nie wieder abgearbeitet wird. Das ist die einzige Art, wie
 * dieses Modul die App zum Stehen bringen kann, und sie steht deshalb hier
 * ganz oben.
 *
 * `'queued'` heisst: dein `start` liegt hier, es wird gerufen, wenn du dran
 * bist. Du startest nichts selbst.
 *
 * `start` wird auf dem `'started'`-Weg NICHT gerufen. Sonst liefe der Lauf im
 * Aufrufrahmen dieser Funktion an, waehrend der Aufrufer noch glaubt, er sei
 * beim Anmelden. Ein Fehler daraus kaeme dann aus `admit` heraus, nicht aus
 * dem Lauf. Der Startpunkt bleibt beim Aufrufer, wo er hingehoert.
 *
 * `identity` (siehe Kopf, Abschnitt "DIE KENNUNG UND DIE IDENTITAET"): ohne
 * Angabe die `convId` selbst, also das alte Verhalten. `run-slot.ts` gibt ein
 * frisches, je Aufruf eigenes Objekt mit, damit ein neuer Lauf derselben
 * Unterhaltung NICHT als Fortsetzung eines noch abwickelnden alten durchgeht.
 */
export function admit(
  lane: RunLane,
  convId: string,
  start: StartThunk,
  identity: unknown = convId,
): Admission {
  if (lane === 'cloud') return 'started'

  // Ein Lauf ohne Kennung nimmt den Platz NICHT.
  //
  // Er koennte ihn nie zurueckgeben: `release` findet ihn ueber genau diese
  // Kennung. Die Wahl steht zwischen zwei Fehlern, und sie ist eindeutig.
  // Ohne Sperre laufen im schlimmsten Fall zwei lokale Laeufe nebeneinander
  // und tauschen VRAM, also genau der Zustand von vor diesem Modul. Mit einer
  // unloesbaren Sperre steht die lokale Spur fuer immer. Langsam schlaegt tot.
  if (!convId) return 'started'

  // Derselbe Lauf fragt zweimal: er hat den Platz schon. Kein zweiter Halter,
  // keine zweite Zeile in der Schlange, und vor allem kein zweites `release`,
  // das den Platz eines Fremden freigaebe. "Derselbe Lauf" heisst seit
  // Blocker A: dieselbe `identity`, nicht nur dieselbe `convId`.
  if (halter?.identity === identity) return 'started'
  if (warteschlange.some((w) => w.identity === identity)) return 'queued'

  if (halter === null) {
    halter = { convId, identity }
    veraendert()
    return 'started'
  }
  warteschlange.push({ convId, identity, start })
  veraendert()
  return 'queued'
}

/**
 * Der Lauf ist vorbei (oder der Wartende will doch nicht mehr).
 *
 * Rueckgabe ist der `start` des Naechsten, oder nichts. DER AUFRUFER MUSS IHN
 * RUFEN. Er wird hier nicht selbst gerufen, weil er sonst im `finally` des
 * gerade beendeten Laufs anliefe: ein Fehler des naechsten Laufs schluepfte
 * damit in die Abwicklung des vorigen, und ein Abbruch des vorigen risse den
 * naechsten mit. Zwei Laeufe, die nichts miteinander zu tun haben, haetten
 * einen gemeinsamen Aufrufrahmen.
 *
 * Der Platz ist beim Zurueckkehren aus dieser Funktion bereits an den
 * Naechsten vergeben. Das ist Absicht: nur so kann sich zwischen dem
 * Freiwerden und dem Anlaufen des Naechsten kein Dritter dazwischenschieben.
 * Der Preis ist, dass ein verworfener Rueckgabewert die Spur haengen laesst.
 *
 * Fuer einen Wartenden, der abbricht, bevor er dran war, gibt es hier den
 * zweiten Weg: er faellt aus der Schlange und niemand rueckt nach, denn der
 * Halter rechnet ja noch.
 *
 * `identity` wie bei `admit`: ohne Angabe die `convId`, also das alte
 * Verhalten. Wer eine echte Identitaet mitgibt, gibt exakt den Platz zurueck,
 * den er selbst mit derselben Identitaet genommen hat, nie den eines anderen
 * Laufs derselben Unterhaltung.
 */
export function release(convId: string, identity: unknown = convId): StartThunk | undefined {
  if (!convId) return undefined

  // Erst der Wartende, dann der Halter. Beides gleichzeitig kann eine
  // Konversation nicht sein (`admit` schliesst es aus), und die Reihenfolge
  // macht den haeufigeren Fall nicht teurer.
  const wartet = warteschlange.findIndex((w) => w.identity === identity)
  if (wartet >= 0) {
    warteschlange.splice(wartet, 1)
    veraendert()
    return undefined
  }

  // Nicht der Halter: ein Cloud-Lauf, oder schon einmal freigegeben. Beides
  // ist harmlos und darf NICHT den Platz eines anderen raeumen. Ein
  // `release` ohne vorheriges `admit` waere sonst ein Generalschluessel.
  if (halter?.identity !== identity) return undefined

  const naechster = warteschlange.shift()
  halter = naechster ? { convId: naechster.convId, identity: naechster.identity } : null
  veraendert()
  return naechster?.start
}

/** Wartet dieser Lauf auf die lokale Spur? Die Frage, die `run-idle.ts` stellt. */
export function isRunQueued(conversationId: string | null | undefined): boolean {
  if (!conversationId) return false
  return warteschlange.some((w) => w.convId === conversationId)
}

/** Wartet ueberhaupt jemand? Fuer `runsActive`, ohne die Schlange auszubreiten. */
export function anyRunQueued(): boolean {
  return warteschlange.length > 0
}

/** Wer hat die lokale Spur gerade, falls jemand. Fuer Tests und Diagnose. */
export function localLaneHolder(): string | null {
  return halter?.convId ?? null
}

/**
 * Der Beweis, den ein Elternlauf einem verschachtelten Aufruf mitgibt, um
 * ihm zu sagen "du darfst in meinem Platz mitfahren". Siehe `run-slot.ts`s
 * `runsInHeldLane` und `holdsLocalLane` unten.
 */
export interface HeldLocalLane {
  conversationId: string
  identity: unknown
}

/**
 * Haelt GENAU dieser Lauf (diese `identity`, nicht nur diese `conversationId`)
 * die lokale Spur gerade wirklich?
 *
 * Opus-Review (bau/review-w2lane.md, Runde 4): `run-slot.ts`s
 * `runsInHeldLane` war bis hierher ein reiner Vertrauensbeweis, ein Aufrufer
 * konnte den Marker setzen, OHNE dass ein Elternlauf irgendetwas haelt, und
 * lief dann neben einem FREMDEN Halter, ohne Platz, ohne Buchung, ohne
 * Abbruchgriff, unsichtbar fuer `stopAllBackgroundWork`. Diese Funktion ist
 * die Gegenprobe dazu: sie beantwortet nicht "traegt der Aufrufer denselben
 * Namen", sondern "ist der HALTER heute buchstaeblich dasselbe Objekt, das
 * der Aufrufer als Beweis vorzeigt". Eine `identity` kann niemand faelschen,
 * ohne sie vom echten Halter bekommen zu haben (`run-slot.ts` gibt sie nur an
 * den eigenen Rumpf weiter), also ist ein Treffer hier ein echter Beweis,
 * keine Namensgleichheit.
 */
export function holdsLocalLane(conversationId: string, identity: unknown): boolean {
  return halter !== null && halter.convId === conversationId && halter.identity === identity
}

/** Die Wartenden in ihrer Reihenfolge. Fuer Tests und Diagnose. */
export function queuedRunIds(): string[] {
  return warteschlange.map((w) => w.convId)
}

/** Nur fuer Tests: Modulzustand lebt sonst eine ganze Sitzung lang. */
export function __resetRunLanesForTests(): void {
  halter = null
  warteschlange.length = 0
  // Die Beobachter bleiben stehen: sie gehoeren dem Test, der sie angemeldet
  // hat, und der meldet sie selbst wieder ab. Wer sie hier mit abraeumte,
  // naehme einem `beforeEach` still die Anmeldung aus dem Test davor weg.
}
