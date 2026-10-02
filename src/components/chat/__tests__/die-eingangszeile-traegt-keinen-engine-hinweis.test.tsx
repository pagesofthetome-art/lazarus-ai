/**
 * @vitest-environment jsdom
 *
 * WAECHTER. Eigner am 21.09.2026: "die Lazarus engine missing meldung ist schon
 * wieder im prompt fenster! NICHTS im prompt fenster!"
 *
 * Harte Regel seit diesem Tag: ueber oder in der Eingabezeile des Chats
 * erscheint KEIN Hinweis zur fehlenden Lazarus Engine. Der Satz hat genau zwei
 * Plaetze, und die Eingabezeile ist keiner davon:
 *   - ganz oben im Modellmenue des Chats (ModelSelector.tsx, belegt in
 *     components/models/__tests__/der-hinweis-steht-im-modellmenue.test.ts),
 *   - oben in Settings, AI Backends, Providers (ProviderConfig.tsx).
 *
 * `EngineMissingBar.tsx` ist geloescht, samt Einhaengung in ChatView und samt
 * eigenem Test. Diese Datei haelt fest, dass nichts davon zurueckkommt, und
 * zwar auf zwei Wegen: die Quelle des Chat-Ordners wird durchgesehen, UND ein
 * echt gerenderter Composer wird gezaehlt.
 *
 * Run: npx vitest run src/components/chat/__tests__/die-eingangszeile-traegt-keinen-engine-hinweis.test.tsx
 */
import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { ChatInput } from '../ChatInput'

const HIER = dirname(fileURLToPath(import.meta.url))
const CHAT_ORDNER = resolve(HIER, '..')

/** Jede Quelldatei des Chat-Ordners, ohne die Tests. */
function chatQuellen(): { name: string; text: string }[] {
  return readdirSync(CHAT_ORDNER)
    .filter((n) => n.endsWith('.tsx') || n.endsWith('.ts'))
    .map((n) => ({ name: n, text: readFileSync(join(CHAT_ORDNER, n), 'utf8') }))
}

afterEach(cleanup)

describe('der geloeschte Balken', () => {
  it('EngineMissingBar.tsx gibt es nicht mehr, auch nicht als toter Code', () => {
    expect(existsSync(join(CHAT_ORDNER, 'EngineMissingBar.tsx'))).toBe(false)
    expect(existsSync(join(CHAT_ORDNER, '__tests__', 'engine-missing-bar.test.ts'))).toBe(false)
    const treffer = chatQuellen().filter((d) => d.text.includes('EngineMissingBar'))
    expect(treffer.map((d) => d.name)).toEqual([])
  })
})

describe('WAECHTER: der Chat-Ordner kennt die Frage gar nicht mehr', () => {
  it('keine Datei dort liest builtin-engine-presence oder den Sitzungsspeicher des Hinweises', () => {
    const treffer = chatQuellen().filter((d) =>
      d.text.includes('builtin-engine-presence')
      || d.text.includes('isBuiltinEngineMissing')
      || d.text.includes('engine-notice-session'))
    expect(treffer.map((d) => d.name)).toEqual([])
  })

  it('und keine Datei dort traegt den Satz', () => {
    const treffer = chatQuellen().filter((d) => d.text.includes('Lazarus Engine is missing'))
    expect(treffer.map((d) => d.name)).toEqual([])
  })

  // NEGATIVKONTROLLE mit Zahl: die Suche selbst funktioniert. Der Satz steht
  // an seinen zwei erlaubten Plaetzen, sonst wuerde dieser Waechter auch dann
  // gruen bleiben, wenn der Hinweis ueberhaupt nirgends mehr existiert.
  it('NEGATIVKONTROLLE: genau 2 Dateien ausserhalb des Chat-Ordners tragen den Satz', () => {
    const plaetze = [
      resolve(CHAT_ORDNER, '..', 'models', 'ModelSelector.tsx'),
      resolve(CHAT_ORDNER, '..', 'settings', 'ProviderConfig.tsx'),
    ]
    const traeger = plaetze.filter((p) => readFileSync(p, 'utf8').includes('Lazarus Engine is missing from your providers'))
    expect(traeger.length).toBe(2)
  })
})

describe('WAECHTER: der gerenderte Composer sagt nichts dazu', () => {
  it('0 Treffer im Text, 0 Warnsymbole, und die Eingabe selbst steht da', () => {
    render(<ChatInput onSend={() => {}} onStop={() => {}} isGenerating={false} />)
    const composer = screen.getByRole('textbox')
    const wurzel = composer.closest('div[class]')?.parentElement ?? document.body
    expect(wurzel.textContent?.includes('Lazarus Engine is missing')).toBe(false)
    expect(document.body.textContent?.match(/Lazarus Engine is missing/g)?.length ?? 0).toBe(0)
    expect(document.querySelectorAll('[data-testid="engine-missing-bar"]').length).toBe(0)
    expect(document.querySelectorAll('[data-testid="picker-engine-missing"]').length).toBe(0)
    // NEGATIVKONTROLLE: der Composer ist wirklich gerendert, sonst zaehlt
    // die Null oben nur ein leeres Dokument.
    expect(document.querySelectorAll('textarea').length).toBeGreaterThanOrEqual(1)
  })
})
