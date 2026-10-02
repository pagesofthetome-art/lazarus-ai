/**
 * Ein Anbieter, den der Nutzer abgeschaltet hat, bleibt abgeschaltet, auch
 * wenn der Speicherwert aus einem Bau vor R2-14 stammt.
 *
 * T13 hat am 12.09.2026 auf der Windows-Box gemessen, was so ein Speicherwert
 * anrichtet: `lu-providers` trug fuer Ollama gleichzeitig `"enabled":true` und
 * `"disabledByUser":true`. Die Zeile in Settings, AI Backends zeigte darauf
 * weder `DISABLED` noch `Enable`, weil `isReturnableRow` an `enabled`
 * scheitert, und der Anbieter zaehlte zugleich als eingeschaltet. Der
 * Abschalter, den der Nutzer gedrueckt hatte, tat also nichts und sagte auch
 * nicht, dass er nichts tut.
 *
 * Angelegt hat das Paar der Anlauf-Erkenner in AppShell, der `enabled: true`
 * bedingungslos ueber eine abgeschaltete Zeile schrieb. Seit R2-14 legt er es
 * nicht mehr an. Wegraeumen tut es erst dieser Fix, denn der Speicherwert auf
 * der Platte heilt nicht von selbst.
 *
 * Negativkontrolle: ohne `honourUserDisable` im Merge sind die ersten beiden
 * Faelle rot (enabled bleibt true, die Zeile bleibt keine Rueckkehrzeile). Die
 * drei Faelle darunter halten fest, dass die Heilung nichts anderes anfasst.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { honourUserDisable, isReturnableRow, providerRowIds } from '../../lib/provider-visibility'

vi.mock('../../api/providers/registry', () => ({ clearProviderCache: vi.fn() }))
vi.mock('../../api/backend', () => ({
  secretGet: vi.fn().mockRejectedValue(new Error('no vault')),
  secretSet: vi.fn(),
  secretDelete: vi.fn(),
  isTauri: () => false,
  backendCall: vi.fn(),
}))

function installLocalStorage(seed?: Record<string, string>) {
  const map = new Map<string, string>(Object.entries(seed ?? {}))
  const ls = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)) },
    removeItem: (k: string) => { map.delete(k) },
    clear: () => { map.clear() },
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size },
  }
  vi.stubGlobal('localStorage', ls)
  vi.stubGlobal('window', { localStorage: ls })
}

async function freshStore() {
  vi.resetModules()
  const mod = await import('../providerStore')
  return mod.useProviderStore
}

/** Genau der Speicherwert, den T13 auf der Box gelesen hat, gekuerzt. */
function blobDerBox() {
  return JSON.stringify({
    version: 1,
    state: {
      providers: {
        ollama: { id: 'ollama', name: 'Ollama', enabled: true, disabledByUser: true, baseUrl: 'http://127.0.0.1:11434', apiKey: '', isLocal: true },
      },
    },
  })
}

describe('die Regel fuer sich', () => {
  it('schaltet das widerspruechliche Paar auf das Nein des Nutzers', () => {
    expect(honourUserDisable({ enabled: true, disabledByUser: true })).toEqual({ enabled: false, disabledByUser: true })
  })

  it('laesst jede widerspruchsfreie Zeile in Ruhe, Objektgleichheit eingeschlossen', () => {
    for (const cfg of [
      { enabled: true },
      { enabled: true, disabledByUser: false },
      { enabled: false, disabledByUser: true },
      { enabled: false },
    ]) {
      expect(honourUserDisable(cfg), JSON.stringify(cfg)).toBe(cfg)
    }
  })
})

describe('der Speicherwert von der Box oeffnet sich geheilt', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  beforeEach(() => { vi.resetModules() })

  it('Ollama ist aus, nicht an', async () => {
    installLocalStorage({ 'lu-providers': blobDerBox() })
    const store = await freshStore()
    expect(store.getState().providers.ollama.enabled).toBe(false)
    expect(store.getState().providers.ollama.disabledByUser).toBe(true)
  })

  it('und die Zeile traegt den Weg zurueck', async () => {
    installLocalStorage({ 'lu-providers': blobDerBox() })
    const store = await freshStore()
    const providers = store.getState().providers
    expect(isReturnableRow(providers.ollama)).toBe(true)
    expect(providerRowIds(providers)).toContain('ollama')
  })

  it('haelt die Adresse und den Namen fest, geheilt wird genau ein Feld', async () => {
    installLocalStorage({ 'lu-providers': blobDerBox() })
    const store = await freshStore()
    expect(store.getState().providers.ollama.baseUrl).toBe('http://127.0.0.1:11434')
    expect(store.getState().providers.ollama.name).toBe('Ollama')
  })

  // NEGATIVKONTROLLE: ein Anbieter ohne die Marke des Nutzers bleibt an. Eine
  // Heilung, die jede eingeschaltete Zeile abschaltet, wuerde jeden Fall
  // darueber gruen faerben und dabei die Motorzeile abwuergen.
  it('aber eine Zeile ohne die Marke bleibt eingeschaltet', async () => {
    installLocalStorage({
      'lu-providers': JSON.stringify({
        version: 1,
        state: {
          providers: {
            ollama: { id: 'ollama', name: 'Ollama', enabled: true, baseUrl: 'http://127.0.0.1:11434', apiKey: '', isLocal: true },
            openai: { id: 'openai', name: 'Lazarus Engine', enabled: true, baseUrl: 'http://127.0.0.1:8127/v1', apiKey: '', isLocal: true, managed: true },
          },
        },
      }),
    })
    const store = await freshStore()
    expect(store.getState().providers.ollama.enabled).toBe(true)
    expect(store.getState().providers.openai.enabled).toBe(true)
    expect(store.getState().providers.openai.managed).toBe(true)
  })

  // NEGATIVKONTROLLE: die `displaced`-Haelfte traegt `disabledByUser: true`
  // mit Absicht und hat gar keine eigene Zeile. Sie darf die Heilung nicht
  // mitnehmen, sonst kaeme der verdraengte Anbieter als abgeschaltete Zeile
  // zurueck, die niemand angelegt hat.
  it('und die verdraengte Haelfte bleibt unangetastet', async () => {
    installLocalStorage({
      'lu-providers': JSON.stringify({
        version: 1,
        state: {
          providers: {
            openai: {
              id: 'openai', name: 'Lazarus Engine', enabled: true, baseUrl: 'http://127.0.0.1:8127/v1', apiKey: '', isLocal: true, managed: true,
              displaced: { name: 'Custom (OpenAI-compat)', baseUrl: 'http://127.0.0.1:8129/v1', isLocal: true, disabledByUser: true },
            },
          },
        },
      }),
    })
    const store = await freshStore()
    expect(store.getState().providers.openai.displaced).toEqual({
      name: 'Custom (OpenAI-compat)', baseUrl: 'http://127.0.0.1:8129/v1', isLocal: true, disabledByUser: true,
    })
  })
})
