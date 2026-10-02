/**
 * Darf der Assistent diesen Anbieter einschalten?
 *
 * T2 hat auf der Box gemessen, was ohne diese Frage passiert: Ollama stand in
 * Settings > AI Backends ausdruecklich auf DISABLED, danach lief die
 * Ersteinrichtung einmal durch, und danach stand dort `Ollama LOCAL` ohne
 * Abzeichen. Der Nutzer hatte nichts an Ollama angefasst; er hatte im
 * Modellschritt ein Modell gewaehlt, und das Modell kam aus Ollamas
 * `/api/tags`.
 *
 * Genau ein Nein: `disabledByUser`. Diese Marke schreibt einzig der
 * Disable/Enable-Knopf der Anbieterkarte (`lib/provider-visibility.ts`), sie
 * heisst also "ich will den nicht" und nicht "der ist gerade nicht in
 * Benutzung". Ein Erstlauf hat gar keinen Eintrag, und eine frische Ablage hat
 * die Marke nicht: beide sagen nichts, beide duerfen. Nur das ausdrueckliche
 * Nein zaehlt.
 *
 * Die Kehrseite steht in `ModelsStep.tsx` und gehoert zur selben Regel: was
 * der Assistent nicht einschalten darf, darf er auch nicht anbieten. Sonst
 * klickt der Nutzer eine Zeile, die Wahl wird gesetzt, und der Anbieter bleibt
 * dunkel. Das ist derselbe kaputte Zustand, den `dropPicksForDarkenedSlots` im
 * Anbieter-Store verhindert, nur von der anderen Seite erreicht.
 */
export interface WizardGateConfig {
  /** Vom Disable-Knopf gesetzt, vom Enable-Knopf geloescht. */
  disabledByUser?: boolean
}

export function mayEnableFromWizard(config: WizardGateConfig | undefined): boolean {
  return config?.disabledByUser !== true
}
