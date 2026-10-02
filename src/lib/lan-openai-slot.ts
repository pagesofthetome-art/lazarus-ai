/**
 * Wo der `openai`-Steckplatz wirklich hinzeigt.
 *
 * `ProviderId` ist eine feste Menge von vier Steckplaetzen, und JEDES
 * OpenAI-kompatible Backend teilt sich denselben: api.openai.com, ein
 * llama.cpp auf 127.0.0.1:8080, ein vLLM im LAN, LM Studio, der eingebaute
 * Motor dieses Hauses. Der Name `openai` sagt also nur, welches Protokoll
 * gesprochen wird, und nichts darueber, wer die Rechnung schickt.
 *
 * Zwei Stellen mussten das schon wissen, und bis zum 11.09.2026 wusste es nur
 * eine: `useActiveContextWindow` (GH #129) hat die Frage gestellt, damit ein
 * eigener Server einen Fensterwaehler bekommt und nicht den bezahlten
 * Sendedeckel. Der Kompaktierungsweg daneben hat sie nicht gestellt und den
 * Steckplatz weiter an einer Liste gemessen, in der `openai` als bezahlt
 * steht. Beide fragen jetzt hier.
 */

import { isPrivateOrLanHost, hostnameOf } from '../api/backend'
import { useProviderStore } from '../stores/providerStore'

/**
 * Laeuft der eingestellte OpenAI-Slot auf diesem Rechner oder im LAN?
 *
 * Dieselbe Frage, die `isLanBackend` im Provider stellt, und bewusst dieselbe
 * Antwortquelle: die Voreinstellung des Slots ODER der Hostname. Ein fremder
 * Host im Internet bekommt weder Metadaten-Abfragen noch einen Fensterwaehler.
 */
export function isLanOpenAiBackend(): boolean {
  try {
    const cfg = useProviderStore.getState().providers.openai
    if (!cfg) return false
    return cfg.isLocal === true || isPrivateOrLanHost(hostnameOf(cfg.baseUrl))
  } catch {
    return false
  }
}

/**
 * Geht eine Sendung an diesem Modell an eine Maschine, fuer die niemand
 * bezahlt?
 *
 * Nur fuer den `openai`-Steckplatz eine echte Frage. `ollama` und `lmstudio`
 * sind ohnehin lokal und stehen gar nicht erst auf der Bezahlliste, `lu-cloud`
 * und `anthropic` sind immer fern. Die Antwort darf NICHT ohne den
 * Anbieternamen gegeben werden: ein eigener Server im `openai`-Steckplatz
 * macht eine Sendung an retired hosted service nicht kostenlos.
 */
export function sendsToALanBackend(providerId: string): boolean {
  return providerId === 'openai' && isLanOpenAiBackend()
}
