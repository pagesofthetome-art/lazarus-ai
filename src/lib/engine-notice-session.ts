/**
 * Ob der Kunde den Hinweis "Lazarus Engine is missing from your providers" in
 * DIESEM Programmlauf schon weggedrueckt hat.
 *
 * Der Hinweis steht an zwei Stellen: oben im Modellmenue des Chats und oben
 * in Settings, AI Backends, Providers. Vorher hatte jede Stelle ihr eigenes
 * `useState`, also musste man dasselbe X zweimal druecken, und die zweite
 * Stelle widersprach der ersten. Eine Modulvariable ist genau der Speicher,
 * den dieses Projekt fuer sitzungsweite Wegdrueckungen schon benutzt (siehe
 * `LM_HINT_DISMISSED_THIS_SESSION` in ModelSelector.tsx): sie ueberlebt das
 * Aus- und Einhaengen der Komponenten innerhalb eines Laufs und startet beim
 * naechsten Start des Programms wieder bei false, weil das Modul neu geladen
 * wird. Bewusst NICHT im localStorage: ein stehendes Problem darf nicht ueber
 * Neustarts hinweg unsichtbar bleiben.
 */
let weggedrueckt = false

export function engineNoticeDismissed(): boolean {
  return weggedrueckt
}

export function dismissEngineNoticeForSession(): void {
  weggedrueckt = true
}

/** Zuruecksetzen, sobald Lazarus Engine wieder da ist: wer den Hinweis von heute
 *  weggedrueckt hat, soll den von morgen trotzdem sehen. Auch der Weg, auf dem
 *  Tests zwischen zwei Faellen sauber anfangen. */
export function resetEngineNoticeDismissal(): void {
  weggedrueckt = false
}
