/**
 * Which provider rows Settings, AI Backends shows, and whether the chat picker
 * has any backend left to list.
 *
 * Nebenbefund 1 of the R9 re-measure on the 2.6.7 Windows build (2026-08-30):
 * the red "Disable" button on the LM Studio card removed the card from the
 * list. The list only ever rendered ENABLED providers, so the control that
 * turned a provider off also deleted the only place that could turn it back
 * on. What was left was retired hosted service, `activeModel` on null, and a chat picker
 * saying "No models available" with nothing to press.
 *
 * The rule here is small on purpose: a provider the USER switched off keeps
 * its row and shows an Enable button. A provider that is simply not in use
 * (a fresh install has Ollama and Anthropic off, and onboarding turns the
 * built-in engine off when the user picks Ollama) stays out of the list, so
 * the pane does not fill up with slots nobody asked for. That is what
 * `disabledByUser` marks, and only the Disable/Enable control writes it.
 */

export interface ProviderVisibilityConfig {
  enabled: boolean
  /** Set by the card's own Disable button, cleared by Enable. */
  disabledByUser?: boolean
}

/** Legacy provider rows are never offered after the hosted catalog was removed. */
const RETIRED_PROVIDER_IDS = new Set(['lu-cloud'])

/**
 * The rows the providers list renders, in store order: everything enabled,
 * plus everything the user switched off here.
 */
export function providerRowIds<T extends ProviderVisibilityConfig>(
  providers: Record<string, T | undefined>,
): string[] {
  return Object.keys(providers).filter((id) => {
    const p = providers[id]
    if (!p) return false
    return p.enabled || p.disabledByUser === true
  })
}

/** True for a row that is present but switched off, i.e. the Enable row. */
export function isReturnableRow<T extends ProviderVisibilityConfig>(config: T | undefined): boolean {
  return !!config && !config.enabled && config.disabledByUser === true
}

/**
 * Das Nein des Nutzers gewinnt gegen ein stehengebliebenes `enabled: true`.
 *
 * Beide Marken zusammen sind ein Widerspruch, den nur ein aelterer Bau
 * schreiben konnte: der Anlauf-Erkenner in AppShell setzte `enabled: true`
 * bedingungslos ueber eine Zeile, die der Nutzer abgeschaltet hatte. Seit
 * R2-14 fragt er `mayEnableFromWizard` und legt den Widerspruch nicht mehr an,
 * aber er raeumt ihn auch nicht weg: wer Ollama in 2.6.x abschaltete und
 * danach einmal mit laufendem Ollama startete, traegt das Paar in seinen
 * Speicherwert und bringt es beim Update mit.
 *
 * Was der Nutzer davon sieht, hat T13 am 12.09.2026 auf der Windows-Box
 * gemessen: die Zeile zeigt weder DISABLED noch Enable, weil
 * `isReturnableRow` an `enabled` scheitert, und der Anbieter zaehlt zugleich
 * als eingeschaltet. Der Abschalter, den der Nutzer gedrueckt hat, tut also
 * nichts und sagt auch nicht, dass er nichts tut.
 *
 * Geheilt wird beim Laden und nicht beim Anzeigen: eine Heilung nur in der
 * Liste liesse den Anbieter weiter befragen. `disabledByUser` schreibt einzig
 * der Disable-Knopf, ist also die Marke mit der Absicht dahinter, und
 * gewinnt.
 */
export function honourUserDisable<T extends ProviderVisibilityConfig>(config: T): T {
  return config.enabled && config.disabledByUser === true ? { ...config, enabled: false } : config
}

/**
 * No supported backend is enabled.
 */
export function noChatBackendEnabled<T extends ProviderVisibilityConfig>(
  providers: Record<string, T | undefined>,
): boolean {
  return !Object.keys(providers).some((id) => {
    const p = providers[id]
    return !!p?.enabled && !RETIRED_PROVIDER_IDS.has(id)
  })
}
