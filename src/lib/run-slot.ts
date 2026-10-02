/**
 * Einen Platz auf der Spur nehmen, den Lauf fahren, den Platz zurueckgeben.
 * An EINER Stelle.
 *
 * ── WARUM DAS NICHT JEDER SELBST MACHT ──────────────────────────────────────
 *
 * `run-lanes.ts` schreibt die Pflicht in seinen Kopf, in Grossbuchstaben: wer
 * `'started'` bekommt, MUSS `release` mit derselben Kennung rufen, im
 * `finally`, auch bei Fehler und Abbruch. Ein nicht zurueckgegebener Platz
 * haelt die lokale Spur fuer den Rest der Sitzung besetzt; jeder weitere
 * lokale Lauf reiht sich dann in eine Schlange ein, die nie wieder
 * abgearbeitet wird. Das ist die einzige Art, wie die Spur die App zum Stehen
 * bringen kann.
 *
 * Eine Pflicht, die an jeder Aufrufstelle neu eingehalten werden muss, wird
 * irgendwann an einer Aufrufstelle nicht eingehalten, und zwar nicht durch
 * Nachlaessigkeit: die Sendewege im Haus sind lang, haben mehrere
 * Fehlerpfade, ein `return` mittendrin und Abbruchbehandlung an drei Stellen.
 * Wer dort ein `finally` uebersieht, sieht nichts Rotes. Er sieht ein
 * funktionierendes Programm, bis der zweite lokale Lauf kommt.
 *
 * Deshalb gibt der Aufrufer hier seinen RUMPF ab statt eine Zusicherung. Das
 * `finally` steht dann genau einmal im Haus, und ein Waechter
 * (`__tests__/run-slot.test.ts`) haelt fest, dass `admit` und `release` sonst
 * nirgends geholt werden.
 *
 * ── WAS HIER SONST NOCH HINEINGEHOERT, UND WARUM ────────────────────────────
 *
 * Der Abbruchgriff wird SCHON BEIM ANSTELLEN gesetzt, nicht erst wenn der
 * Lauf anlaeuft. Sonst haette Stop an einem wartenden Lauf nichts zu greifen:
 * der Rumpf, der den Griff sonst registriert, hat ja noch nicht angefangen.
 * Der Nutzer sieht ein Warteplaettchen, drueckt Stop, und nichts passiert.
 *
 * ── ES GIBT KEINEN WIEDEREINTRITTS-FASTPATH MEHR, UND DAS IST ABSICHT ───────
 *
 * (Blocker A, Opus-Review Runde 2) Bis hierher gab es einen zweiten Weg neben
 * `admit`/`release`: rief `runInLane` fuer eine `conversationId` an, fuer die
 * schon ein Lauf "in diesem Modul steckte" (ein Zaehler `tiefe`), lief der
 * Rumpf sofort durch, ohne Platz, ohne Buchung, ohne Anstellen. Gedacht war
 * das fuer einen Vordergrund-Sub-Agenten, der sonst auf die Spur seines
 * eigenen Elternlaufs gewartet haette (`sub-agent.ts: return await
 * runner(...)`).
 *
 * Zwei Dinge waren daran falsch. Erstens gibt es diesen Aufrufer heute gar
 * nicht mehr: `sub-agent.ts` ruft `provider.chatWithTools` beziehungsweise
 * `registry.execute` direkt, nie `runInLane` (nachgesehen per grep ueber
 * `src/api` und `src/lib`, kein Treffer). Zweitens traf der Fastpath nicht
 * nur einen echten verschachtelten Aufruf, sondern JEDEN zweiten Aufruf mit
 * derselben `conversationId`, auch einen, der mit dem ersten nichts zu tun
 * hat: Stop in einer Unterhaltung, sofort danach neu gesendet. Der ALTE Lauf
 * wickelt sich noch ab (`endTurnDurably` braucht gemessen 300 bis 500 ms),
 * sein eigenes `finally` hat die Spur noch nicht zurueckgegeben, und der NEUE
 * Lauf traegt dieselbe `conversationId`. Der Fastpath liess ihn durch, ohne
 * Platz zu nehmen, und wenn der ALTE Lauf danach seinen Platz zurueckgab,
 * rueckte ein dritter, wirklich wartender Lauf nach, WAEHREND der neue Lauf
 * noch ungebucht gegen den Motor lief: zwei echte Anfragen gleichzeitig,
 * gemessen mit einem Wegwerf-Test gegen dieses Modul, Zahlen im Baubericht.
 *
 * Die richtige Antwort ist nicht ein besserer Zaehler, sondern die Frage
 * anders zu stellen: nicht "traegt dieser Aufruf dieselbe `conversationId`",
 * sondern "ist das WIRKLICH derselbe Lauf". Das beantwortet jetzt eine
 * eigene Identitaet je `runInLane`-Aufruf (`identity` unten), die an
 * `admit`/`release` weitergereicht wird (siehe deren Kopf in `run-lanes.ts`).
 * Ein neuer Lauf derselben Unterhaltung bekommt eine NEUE Identitaet und
 * stellt sich damit hinter dem noch abwickelnden alten an, statt ihn zu
 * ersetzen.
 *
 * ── DIE WEITERGABE DES ELTERNLAUF-TOKENS, JETZT WIRKLICH GEPRUEFT ───────────
 *
 * (Nachbesserung 3, Runde 3 der 3.0.1-Pruefung; Nachbesserung Runde 4,
 * bau/review-w2lane.md) Ein echter verschachtelter Aufrufer ist inzwischen
 * da, gleich zwei: `workflow-engine.ts`s eigener `run_workflow`-Aufruf
 * (`api/mcp/builtin-tools.ts`, verschachtelt in einen schon laufenden
 * Werkzeugaufruf) und der VORDERGRUND-Sub-Agent (`sub-agent.ts`, `return
 * await runner(...)`, der Elternzug wartet auf ihn). Beide reichen ihr
 * Elternlauf-Token EXPLIZIT weiter, ueber `runsInHeldLane` unten, statt es
 * stillschweigend ueber die blosse `conversationId` erschliessen zu lassen.
 *
 * Runde 4 hat gemessen, dass "explizit weitergereicht" allein nichts wert
 * ist, wenn niemand es nachpruefft: `runsInHeldLane: true` war ein reiner
 * Vertrauensbeweis, ein Aufrufer konnte den Marker setzen, OHNE dass
 * irgendein Elternlauf die Spur wirklich haelt, und der Rumpf lief dann
 * neben einem FREMDEN Halter, ohne Platz, ohne Buchung, ohne Abbruchgriff,
 * unsichtbar fuer `stopAllBackgroundWork` (drei erreichbare Wege genannt:
 * ein Vordergrund-Sub-Agent mit eigenem lokalem `model` unter einem
 * Cloud-Elternzug, ein Modellwechsel mitten im Zug, ein Sprachkanal ohne
 * Zug ueberhaupt). Deshalb ist `runsInHeldLane` jetzt kein Boolean mehr,
 * sondern die `HeldLocalLane`-Identitaet, die `runInLane` seinem eigenen
 * Rumpf mitgibt (zweiter Parameter von `body`), und die diese Funktion
 * gegen `holdsLocalLane()` prueft, BEVOR sie `admit`/`release` uebergeht:
 * nur wenn GENAU dieser Elternlauf die lokale Spur heute noch haelt, faehrt
 * der innere Aufruf in dessen Platz mit UND haengt sich an dessen
 * Abbruchgriff (Stop auf die Elternunterhaltung bricht dann beide ab).
 * Stimmt der Beweis nicht (der Marker ist veraltet, falsch gesetzt, oder der
 * Elternlauf ist gar keiner), bucht der Aufruf ganz normal wie ein
 * eigenstaendiger Lauf.
 *
 * DAS IST NUR DANN KEIN HAENGER, WENN DER AUFRUFER SEINEN EIGENEN, ECHTEN
 * BEWEIS WEITERGIBT, NIE EINEN GEERBTEN.
 *
 * (Nachpruefung, bau/review-w2lane.md, Blocker 1 der Runde nach `1c9d8043`)
 * Der Satz stand hier vorher ohne diese Bedingung, unbedingt: "haelt niemand
 * aus derselben Kette die Spur, kann sich niemand aus derselben Kette selbst
 * blockieren". Das gilt nur, wenn wirklich niemand aus der Kette haelt. Ein
 * HALTENDER Lauf, der einen ZWEITEN abwartet (Werkzeugausfuehrung,
 * `run_workflow`, ein weiterer verschachtelter Agent), MUSS diesem zweiten
 * seinen EIGENEN, aktuellen Beweis mitgeben. Gemessen wurde das Gegenteil:
 * ein Hintergrund-Sub-Agent bucht die Spur unter seiner eigenen Aufgaben-Id,
 * sein `run_workflow`-Schritt bekam aber per `{ ...run }` den laengst
 * freigegebenen Beweis des ELTERNZUGS durchgereicht (nicht den eigenen), der
 * Beweis war damit garantiert ungueltig, der Werkzeugschritt fiel auf
 * normales Buchen unter `'tool-execution'` zurueck und wartete dort auf
 * einen Platz, den der Sub-Agent selbst haelt: derselbe Halter wartet auf
 * sich selbst, fuer immer, bis zum naechsten Appstart. `sub-agent.ts` reicht
 * seither `held` (den zweiten Parameter des eigenen `body`) weiter statt des
 * geerbten Werts.
 *
 * Ein ABGEWARTETES `runInLane` verschachtelt in einem anderen, OHNE einen
 * gueltigen Beweis fuer GENAU den Lauf, der wirklich haelt, haengt weiterhin
 * hart: der innere Aufruf stellt sich hinter dem aeusseren an, der aeussere
 * wartet auf den inneren, beide fuer immer (gemessen, siehe
 * `__tests__/run-slot-nested-in-held-lane.test.ts` und
 * `__tests__/heldLocalLane-wird-immer-weitergereicht.test.ts`).
 * `runsInHeldLane` mit dem echten, EIGENEN Beweis jedes wartenden Laufs ist
 * der einzige Weg, das zu vermeiden.
 *
 * Der HINTERGRUND-Sub-Agent (`sub-agent.ts`, `void runner(...)`) ist die
 * Gegenprobe: er wird vom Elternzug NICHT abgewartet, ueberlebt dessen Ende
 * und braucht deshalb seine EIGENE Buchung unter einer eigenen Identitaet
 * (die Aufgaben-Id, nicht die `conversationId` der sichtbaren Unterhaltung),
 * damit `stopAllBackgroundWork` ihn erreicht und er sich in dieselbe lokale
 * Spur einreiht wie jeder andere Lauf. `runsInHeldLane` bleibt fuer ihn
 * `undefined` (der Vorgabewert).
 *
 * ── DIE GRIFFKETTE IST EINE LISTE LEBENDER GLIEDER, KEINE VERSCHACHTELTE
 *    SCHLIESSUNG ──────────────────────────────────────────────────────────
 *
 * (Schlusspruefung, bau/review-w2lane.md, Folgeauftraege 1 und 3) Die
 * Vorgaengerfassung merkte sich beim Registrieren den VORGEFUNDENEN Griff
 * einer Kennung einmalig (`vorgefundenerGriff`) und schrieb ihn im `finally`
 * blind zurueck, wenn der eigene Griff noch der aktuell registrierte war.
 * Das ist eine verschachtelte Closure: `c` wickelt `b` ein, `b` wickelt `a`
 * ein. Endet `a` zuerst (nicht als letzter Registrierer), findet er seinen
 * eigenen Griff nicht mehr aktuell vor (er ist laengst von `b` und `c`
 * eingewickelt) und raeumt gar nichts auf; sein Abbruch bleibt fuer immer in
 * der Kette, die `c` haelt. Gemessen: von vier moeglichen Endreihenfolgen
 * dreier Buchungen unter derselben Kennung raeumte nur die exakte Umkehrung
 * der Buchungsreihenfolge (`c-b-a`) die Kette vollstaendig ab.
 *
 * Die Antwort ist deshalb keine Closure, sondern `Map<Kennung, Glied[]>`
 * (`griffKetten` unten): jeder Aufrufer haengt beim Registrieren sein EIGENES
 * Glied (eigene Identitaet plus eigene Funktion) an die Liste seiner Kennung,
 * und nimmt beim Aufraeumen GENAU dieses Glied wieder heraus, egal wo in der
 * Liste es steht und egal in welcher Reihenfolge die anderen enden. Der in
 * `generationStore.aborters` registrierte Griff wird nicht mehr einmalig
 * eingefroren, sondern bei jeder Aenderung der Liste neu aus den DANN noch
 * lebenden Gliedern gebaut (`griffAusKette`); Stop ruft also immer genau die
 * Glieder, die wirklich noch da sind, nie mehr und nie weniger.
 *
 * Ein Sendeweg wie `useChat.ts` registriert seinen eigenen, echten
 * Abbruchgriff DIREKT in `generationStore` (nicht ueber dieses Modul), sobald
 * sein `AbortController` steht, und ueberschreibt damit das hier zuletzt
 * eingetragene Glied. `griffKettenHinzufuegen` erkennt das (der Store traegt
 * dann nicht mehr die zuletzt von diesem Modul gebaute Funktion) und
 * uebernimmt den echten Griff als neuen Inhalt fuer GENAU DAS Glied, das ihn
 * zuletzt gesetzt hatte, statt ihn als anonymen, nie wieder entfernbaren
 * Fremdkoerper einzuwickeln: das eigene `aufraeumen` dieses Laufs (das ueber
 * dieselbe Identitaet laeuft) findet sein Glied damit auch dann wieder, wenn
 * sein Rumpf zwischendurch direkt in den Store geschrieben hat.
 *
 * Zweiter Fund derselben Pruefung: ein werfendes Glied durfte die uebrigen
 * nicht mit reissen. `griffAusKette` ruft deshalb jedes Glied einzeln in
 * einem eigenen `try/catch`.
 */
import { admit, release, holdsLocalLane, type RunLane, type HeldLocalLane } from './run-lanes'
import { useGenerationStore } from '../stores/generationStore'

export type { HeldLocalLane }

/** Ein lebendes Glied der Abbruchkette einer Kennung. */
interface Kettenglied {
  readonly identity: symbol
  fn: () => void
}

/** Die Ketten je Kennung, nur fuer dieses Modul sichtbar. */
const griffKetten = new Map<string, Kettenglied[]>()
/** Welche `griffAusKette`-Funktion dieses Modul zuletzt fuer eine Kennung selbst registriert hat, um fremde Uebernahmen zu erkennen. */
const eigeneRegistrierung = new Map<string, () => void>()

/** Baut die aktuell im Store zu hinterlegende Funktion aus den lebenden Gliedern einer Kennung. Liest die Liste bei JEDEM Aufruf frisch, nie eine Momentaufnahme. */
function griffAusKette(conversationId: string): () => void {
  return (): void => {
    for (const glied of griffKetten.get(conversationId) ?? []) {
      try {
        glied.fn()
      } catch (error) {
        // Ein werfendes Glied darf die uebrigen nicht mitreissen (Folgeauftrag
        // 3, review-w2lane.md): jeder Abbruch bekommt seinen eigenen Versuch.
        console.warn('[run-slot] a link in the abort chain for', conversationId, 'threw while aborting. Calling the rest anyway.', error)
      }
    }
  }
}

/** Baut die Kette neu und traegt sie im Store ein. */
function griffKetteNeuEintragen(conversationId: string): void {
  const neu = griffAusKette(conversationId)
  eigeneRegistrierung.set(conversationId, neu)
  useGenerationStore.getState().registerAborter(conversationId, neu)
}

/**
 * Das eigene Glied eines Laufs an die Kette seiner Kennung haengen.
 *
 * Erkennt eine zwischenzeitliche fremde Uebernahme (ein Sendeweg hat seinen
 * eigenen, echten Griff direkt registriert und damit das zuletzt hier
 * eingetragene Glied ueberschrieben): dann wird dieser echte Griff als
 * neuer Inhalt des ZULETZT hinzugefuegten Gliedes uebernommen, statt als
 * nie wieder entfernbarer Fremdkoerper eingewickelt zu werden. Gibt es noch
 * gar keine Kette fuer diese Kennung, wird ein etwaiger, schon vorher (von
 * ausserhalb dieses Moduls) registrierter Griff als eigenes, anonymes Glied
 * uebernommen, damit er nicht verloren geht.
 */
function griffKettenHinzufuegen(conversationId: string, identity: symbol, fn: () => void): void {
  const store = useGenerationStore.getState()
  let liste = griffKetten.get(conversationId)
  if (!liste) {
    const gefunden = store.aborters[conversationId]
    liste = gefunden ? [{ identity: Symbol('fremd-vorgefunden'), fn: gefunden }] : []
    griffKetten.set(conversationId, liste)
  } else if (liste.length > 0 && store.aborters[conversationId] !== eigeneRegistrierung.get(conversationId)) {
    const letztes = liste[liste.length - 1]
    const aktuell = store.aborters[conversationId]
    if (aktuell) {
      // Das zuletzt hinzugefuegte Glied hat direkt in den Store geschrieben
      // (ein Sendeweg, der seinen eigenen Griff registriert): das ist
      // immer noch DASSELBE Glied, nur mit neuem Inhalt.
      letztes.fn = aktuell
    } else {
      // Es hat sich selbst aus dem Store entfernt (`clearAborter`), also ist
      // sein Lauf schon vorbei: das Glied ist tot, nicht nur veraltet.
      liste.pop()
    }
  }
  liste.push({ identity, fn })
  griffKetteNeuEintragen(conversationId)
}

/**
 * Das eigene Glied eines Laufs wieder aus der Kette seiner Kennung nehmen.
 *
 * Anders als die Vorgaengerfassung wird hier NICHTS zurueckgeschrieben:
 * es wird genau das eigene Glied entfernt, egal wo es in der Liste steht,
 * und die Kette wird aus dem, was danach noch lebt, neu gebaut. Bleibt
 * niemand mehr uebrig, wird der Store geleert, aber nur wenn er noch die
 * eigene Kette traegt (ein Sendeweg kann inzwischen direkt uebernommen
 * haben, siehe `griffKettenHinzufuegen`); in dem Fall gehoert der Store
 * schon jemand anderem, und dieses Modul fasst ihn nicht mehr an.
 */
function griffKettenEntfernen(conversationId: string, identity: symbol): void {
  const liste = griffKetten.get(conversationId)
  if (!liste) return
  const store = useGenerationStore.getState()
  const eigeneKetteIstAktiv = store.aborters[conversationId] === eigeneRegistrierung.get(conversationId)
  const uebrig = liste.filter((glied) => glied.identity !== identity)
  if (uebrig.length === 0) {
    griffKetten.delete(conversationId)
    eigeneRegistrierung.delete(conversationId)
    if (eigeneKetteIstAktiv) store.clearAborter(conversationId)
    return
  }
  griffKetten.set(conversationId, uebrig)
  if (eigeneKetteIstAktiv) griffKetteNeuEintragen(conversationId)
}

export interface RunSlotOptions {
  /** Der sichtbare Lauf. Dieselbe Kennung, die der Stop-Knopf benennt. */
  conversationId: string
  /** Eigene Karte oder fremde Kapazitaet: `laneOf(model, currentLaneFacts())`. */
  lane: RunLane
  /**
   * Abbrechen, waehrend der Rumpf schon laeuft.
   *
   * Optional, weil die Sendewege ihren eigenen Griff registrieren, sobald sie
   * ihren `AbortController` haben; der ueberschreibt den hiesigen dann. Fuer
   * die Zeit davor, also das Warten in der Schlange, sorgt dieses Modul
   * selbst: dort wird nichts abgebrochen, sondern ausgereiht.
   */
  abort?: () => void
  /**
   * Der Beweis, dass ein Elternlauf die lokale Spur haelt und dieser Rumpf
   * in dessen Platz mitfahren darf (der `held`-Wert, den `runInLane` seinem
   * EIGENEN `body` als zweites Argument mitgibt). Siehe Dateikopf, Abschnitt
   * "DIE WEITERGABE DES ELTERNLAUF-TOKENS". Wird zur Laufzeit gegen
   * `holdsLocalLane()` geprueft: nur wenn GENAU dieser Elternlauf die Spur
   * heute noch haelt, ruft diese Funktion `admit`/`release` gar nicht auf,
   * sondern fuehrt `body()` direkt im Platz des Elternlaufs aus und haengt
   * sich an dessen Abbruchgriff. Stimmt der Beweis nicht mehr (oder war er
   * nie echt), bucht dieser Aufruf ganz normal, als eigenstaendiger Lauf.
   * Vorgabe `undefined`: ein eigenstaendiger Lauf bucht immer selbst.
   */
  runsInHeldLane?: HeldLocalLane | null
}

/**
 * Wie der Lauf ausging, aus Sicht der Spur.
 *
 * `'cancelled-while-queued'` heisst: der Rumpf hat NIE angefangen. Kein
 * Token, keine Antwort, nichts aufzuraeumen. Wer davor schon etwas in den
 * Chat geschrieben hat, muss das selbst wieder wegnehmen; hier ist nichts
 * passiert, was zurueckzunehmen waere.
 */
export type RunSlotOutcome = 'ran' | 'cancelled-while-queued'

/** Warum das Warten zu Ende ist: drangekommen, oder vorher abgesagt. */
type Weckgrund = 'drangekommen' | 'ausgereiht'

/**
 * Den Lauf fahren, sobald seine Spur frei ist.
 *
 * Cloud faengt sofort an. Lokal faengt sofort an, wenn die Karte frei ist,
 * und stellt sich sonst an; der Rumpf laeuft dann an, wenn der Vordermann
 * fertig ist. Der Rueckgabewert sagt, ob er ueberhaupt gelaufen ist.
 *
 * Fehler aus dem Rumpf kommen unveraendert heraus. Dieses Modul faengt
 * nichts: es entscheidet nur, WANN gelaufen wird, und raeumt danach auf.
 */
export async function runInLane(
  options: RunSlotOptions,
  body: (held: HeldLocalLane | null) => Promise<void>,
): Promise<RunSlotOutcome> {
  const { conversationId, lane, abort, runsInHeldLane } = options

  // Der Beweis wird nachgemessen, nicht geglaubt (Opus-Review Runde 4,
  // bau/review-w2lane.md). Nur wenn GENAU der genannte Elternlauf die lokale
  // Spur JETZT noch haelt, faehrt dieser Rumpf in dessen Platz mit. Ein
  // zweites `admit` fuer dieselbe `conversationId` waere sonst die
  // Verklemmung aus dem Dateikopf, weil der aeussere Lauf auf genau diesen
  // Rumpf wartet. Fehler kommen unveraendert heraus, wie beim normalen Weg.
  if (runsInHeldLane && holdsLocalLane(runsInHeldLane.conversationId, runsInHeldLane.identity)) {
    // An die Abbruchkette der Elternkennung anhaengen: Stop auf die
    // Elternunterhaltung muss diesen inneren Rumpf mit erreichen, sonst
    // waere ein Vordergrund-Sub-Agent oder ein verschachtelter Arbeitsablauf
    // ueber den Stop-Knopf der Unterhaltung, die ihn gestartet hat, nicht
    // mehr abbrechbar. `griffKettenHinzufuegen`/`-Entfernen` (siehe Dateikopf,
    // Abschnitt "DIE GRIFFKETTE IST EINE LISTE LEBENDER GLIEDER") haengen
    // dieses eigene Glied an dieselbe Kette, die auch der Elternlauf traegt,
    // und nehmen beim Aufraeumen GENAU dieses Glied wieder heraus, ohne
    // etwas anderes zurueckzuschreiben.
    const innerIdentity = Symbol('nested-in-held-lane')
    if (abort) griffKettenHinzufuegen(runsInHeldLane.conversationId, innerIdentity, abort)
    try {
      await body(runsInHeldLane)
      return 'ran'
    } finally {
      if (abort) griffKettenEntfernen(runsInHeldLane.conversationId, innerIdentity)
    }
  }
  if (runsInHeldLane && lane === 'local') {
    // Der Marker war gesetzt, aber der genannte Elternlauf haelt die Spur
    // nicht (mehr): veraltet, falsch gesetzt, oder gar keiner. Normal buchen
    // ist hier sicher, kein Haenger, denn haelt niemand aus derselben Kette
    // die Spur, kann sich niemand aus derselben Kette selbst blockieren; nur
    // geloggt, damit ein falsch gesetzter Marker nicht lautlos bleibt.
    console.warn(
      '[run-slot] runsInHeldLane was set, but the named parent run does not hold the local lane. ' +
      'Booking normally instead.',
    )
  }

  // Ein Lauf ohne Kennung nimmt keinen Platz, dieselbe Entscheidung wie in
  // `admit`: er koennte ihn nie zurueckgeben, weil `release` ihn ueber genau
  // diese Kennung findet. Zwei lokale Laeufe nebeneinander sind langsam, eine
  // fuer immer besetzte Spur ist tot.
  if (!conversationId) {
    await body(null)
    return 'ran'
  }

  // Die eigene Identitaet DIESES Aufrufs, siehe Kopf ("ES GIBT KEINEN
  // WIEDEREINTRITTS-FASTPATH MEHR"). Ein frisches Objekt, mit nichts als sich
  // selbst vergleichbar: zwei Aufrufe mit derselben `conversationId` sind
  // damit fuer `admit`/`release` zwei verschiedene Laeufe, es sei denn,
  // jemand reicht ausdruecklich dieselbe `identity` weiter. Niemand tut das
  // heute; kommt so ein Aufrufer zurueck, ist das die einzige Stelle, die er
  // aendern muss.
  const identity = Symbol(conversationId)
  // Der Beweis, den DIESER Lauf einem eigenen verschachtelten Aufruf mitgeben
  // kann, siehe Dateikopf. Nur fuer `lane === 'local'`: die Wolke haelt gar
  // keine exklusive Spur, ein Beweis dafuer waere nichts wert und
  // `holdsLocalLane` liefert fuer ihn ohnehin immer `false`.
  const held: HeldLocalLane | null = lane === 'local' ? { conversationId, identity } : null

  let zustand: 'wartend' | 'laeuft' | 'ausgereiht' = 'wartend'
  let wecken: ((grund: Weckgrund) => void) | null = null

  /**
   * Stop, aus Sicht dieses Laufs.
   *
   * Zwei voellig verschiedene Dinge, je nachdem wo der Lauf steht, und genau
   * deshalb steht der Griff hier und nicht im Rumpf: waehrend des Wartens
   * gibt es keinen Strom zum Abbrechen, es gibt eine Zeile in einer
   * Schlange, die verschwinden muss. Bliebe sie stehen, bekaeme sie spaeter
   * die Karte fuer einen Lauf, den der Nutzer laengst abgesagt hat.
   */
  const abbruchgriff = (): void => {
    if (zustand === 'wartend') {
      zustand = 'ausgereiht'
      // `release` auf einen Wartenden nimmt ihn aus der Schlange und rueckt
      // NIEMANDEN nach, denn der Halter rechnet ja weiter.
      release(conversationId, identity)
      wecken?.('ausgereiht')
      return
    }
    abort?.()
  }

  // Das eigene Glied an die Abbruchkette dieser Kennung haengen (siehe
  // Dateikopf, Abschnitt "DIE GRIFFKETTE IST EINE LISTE LEBENDER GLIEDER").
  //
  // Diese Kennung gehoert nicht zwingend diesem Lauf: sie kann die eines
  // laufenden Chat-Zugs sein (`WorkflowEngine.run()` bucht unter
  // `this.conversationId`, und aus dem Ablauf-Fenster ist das die gerade
  // sichtbare Unterhaltung, ohne jede Sperre gegen einen dort laufenden
  // Zug), oder allgemein die eines beliebigen anderen Halters, der zufaellig
  // dieselbe Kennung traegt. `griffKettenHinzufuegen` nimmt einen schon
  // vorgefundenen Griff als eigenes Glied mit auf, statt ihn zu verlieren,
  // und `griffKettenEntfernen` nimmt beim Aufraeumen GENAU das eigene Glied
  // wieder heraus, egal in welcher Reihenfolge mehrere Laeufe unter
  // derselben Kennung enden.
  const store = useGenerationStore.getState()
  griffKettenHinzufuegen(conversationId, identity, abbruchgriff)
  store.bookRun(conversationId, lane, identity)

  const urteil = admit(lane, conversationId, () => {
    // Der Vordermann ist fertig. Dieser Aufruf WECKT nur; der Rumpf laeuft
    // erst im naechsten Mikrotask, also ausserhalb des `finally` des
    // vorigen Laufs. Genau darum darf `release` seinen Rueckgabewert weiter
    // unten im `finally` gerufen werden, ohne die beiden Laeufe zu
    // verbinden: ein Fehler des Nachrueckenden kann hier nicht entstehen.
    if (zustand !== 'wartend') return
    zustand = 'laeuft'
    wecken?.('drangekommen')
  }, identity)

  // Warum das Wecken seinen Grund mittraegt, statt dass hier `zustand`
  // gelesen wird: `zustand` wird ausschliesslich in Rueckrufen gesetzt, und
  // die sieht der Fluss dieser Funktion nicht. Der Uebersetzer haelt die
  // Zuweisungen fuer unerreichbar und die Abfrage danach fuer sinnlos
  // (TS2367, "no overlap"). Er hat recht mit dem, was er sieht; die Antwort
  // ist, sie ihm mitzugeben, statt ihn zu ueberstimmen.
  let grund: Weckgrund = 'drangekommen'
  if (urteil === 'started') {
    zustand = 'laeuft'
  } else {
    grund = await new Promise<Weckgrund>((aufloesen) => {
      // Zwischen `admit` und hier liegt kein `await`, der Startaufruf kann
      // also noch nicht gefallen sein. Die Abfrage steht trotzdem da: sie
      // kostet nichts und haelt den Fall aus, dass jemand die Reihenfolge
      // spaeter umbaut.
      if (zustand === 'ausgereiht') { aufloesen('ausgereiht'); return }
      if (zustand === 'laeuft') { aufloesen('drangekommen'); return }
      wecken = aufloesen
    })
  }

  if (grund === 'ausgereiht') {
    aufraeumen(conversationId, identity)
    return 'cancelled-while-queued'
  }

  try {
    await body(held)
    return 'ran'
  } finally {
    aufraeumen(conversationId, identity)
    // DIE PFLICHT AUS DEM KOPF VON run-lanes.ts, an ihrer einzigen Stelle.
    // Der Platz ist beim Zurueckkehren aus `release` schon an den Naechsten
    // vergeben; wer den Rueckgabewert verwirft, laesst die Spur haengen.
    release(conversationId, identity)?.()
  }
}

/**
 * Buchung weg, eigenes Glied aus der Abbruchkette dieser Kennung genommen.
 *
 * Dieselbe Frage gilt seit Blocker A fuer die Buchung selbst: ein spaet
 * kommendes `finally` eines abgeloesten Laufs (Stop, sofort neu gesendet)
 * darf `generationStore.runs` nicht loeschen, wenn der NEUE Lauf die
 * Unterhaltung inzwischen uebernommen hat; `endRun` prueft das schon selbst
 * ueber `identity`.
 *
 * `griffKettenEntfernen` (Schlusspruefung, review-w2lane.md, Folgeauftrag 1)
 * nimmt GENAU das eigene Glied aus der Liste lebender Glieder dieser
 * Kennung, statt einen vorgefundenen Griff blind zurueckzuschreiben: ein
 * zurueckgeschriebener Griff eines laengst beendeten Laufs waere ein toter
 * Griff, den ein spaeterer Lauf derselben Kennung erbt und der Kette
 * einverleibt. Siehe Dateikopf, Abschnitt "DIE GRIFFKETTE IST EINE LISTE
 * LEBENDER GLIEDER".
 */
function aufraeumen(conversationId: string, identity: symbol): void {
  useGenerationStore.getState().endRun(conversationId, identity)
  griffKettenEntfernen(conversationId, identity)
}
