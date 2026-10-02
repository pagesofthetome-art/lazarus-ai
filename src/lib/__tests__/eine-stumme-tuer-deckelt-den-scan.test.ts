/**
 * Der Fall aus T2, nachgebaut mit einem echten Steckplatz: ein Port, der die
 * Verbindung ANNIMMT und nie antwortet.
 *
 * Genau so verhaelt sich der Rueckwaertstunnel auf 11434, den T2 auf der Box
 * stehen hatte, und genau so verhalten sich die Faelle aus dem Discord-Bericht
 * (Docker-Container auf 8000, gedrosselte Firewall, ein anderes Werkzeug mit
 * langsamem Gesundheitsendpunkt). Die anderen Tests dieses Ordners klopfen
 * gegen eine Attrappe von `fetch`; dieser hier klopft gegen ein echtes Socket,
 * denn nur ein echtes Socket kann beweisen, dass ein Deckel wirklich greift.
 *
 * Gemessen wird zweierlei:
 *   1. Der Scan ist nach dem Deckel zu Ende, nicht nach der Geduld des Ports.
 *   2. Der stumme Port steht nicht im Ergebnis. Sonst haette der Deckel nur
 *      die Messung beruhigt und die Antwort verfaelscht.
 *
 * Der Port wird zur Laufzeit aus der Sondenliste gewaehlt, und zwar der erste,
 * den diese Maschine frei hat: eine feste Zahl waere auf einer Maschine mit
 * laufendem Ollama oder vLLM ein Zufallstest.
 *
 * Lauf: npx vitest run src/lib/__tests__/eine-stumme-tuer-deckelt-den-scan.test.ts
 */
import { describe, it, expect } from 'vitest'
import net from 'node:net'
import { detectLocalBackends, PROBE_TARGETS } from '../backend-detector'

/** Der Deckel einer Sonde: 2000 ms Anfrage plus 500 ms Gnadenfrist. */
const SONDEN_DECKEL_MS = 2500

function portVon(url: string): number {
  return Number(/:(\d+)/.exec(url)?.[1] ?? 0)
}

/** Ein Server, der annimmt und schweigt, auf dem ersten freien Sondenport. */
async function stummeTuer(): Promise<{ port: number; zu: () => Promise<void> }> {
  for (const ziel of PROBE_TARGETS) {
    const port = portVon(ziel.baseUrl)
    if (!port) continue
    const offen: net.Socket[] = []
    const server = net.createServer((s) => { offen.push(s) /* annehmen und nie antworten */ })
    const belegt = await new Promise<boolean>((resolve) => {
      server.once('error', () => resolve(true))
      server.listen(port, '127.0.0.1', () => resolve(false))
    })
    if (belegt) { server.close(); continue }
    // `close()` wartet auf jede noch offene Verbindung, und eine abgebrochene
    // Sonde laesst ihr Socket zurueck: erst zerreissen, dann schliessen.
    return {
      port,
      zu: () => new Promise<void>((r) => { offen.forEach((s) => s.destroy()); server.close(() => r()) }),
    }
  }
  throw new Error('kein freier Sondenport auf dieser Maschine')
}

describe('ein Port, der annimmt und schweigt', () => {
  it('haelt den Scan nicht laenger auf, als der Deckel erlaubt', async () => {
    const tuer = await stummeTuer()
    try {
      const t0 = Date.now()
      const gefunden = await detectLocalBackends()
      const dauer = Date.now() - t0

      // Positivkontrolle: der Port war wirklich offen, der Scan hat also
      // wirklich an eine stumme Tuer geklopft und nicht ins Leere.
      await new Promise<void>((resolve, reject) => {
        const s = net.connect(tuer.port, '127.0.0.1', () => { s.destroy(); resolve() })
        s.once('error', reject)
      })

      // Der Deckel, mit Luft fuer eine langsame Maschine, aber weit unter den
      // vier Minuten, die T2 auf der Box gemessen hat.
      expect(dauer).toBeLessThan(SONDEN_DECKEL_MS * 2)
      // Und der stumme Port zaehlt nicht als gefundenes Backend.
      expect(gefunden.map((b) => b.port)).not.toContain(tuer.port)
    } finally {
      await tuer.zu()
    }
  }, 30_000)
})
