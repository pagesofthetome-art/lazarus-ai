/**
 * @vitest-environment jsdom
 *
 * Fund 1, zweiter Teil, aus T2 (Windows-Box, installierte 3.0.0, 2026-09-11):
 * vor dem Lauf stand in Settings > AI Backends `Ollama DISABLED` mit dem Satz
 * "Switched off, so its models are not offered in the chat model picker. Press
 * Enable to use it again." Nach einem Neustart und einer durchlaufenen
 * Ersteinrichtung stand dort nur noch `Ollama LOCAL` ohne Abzeichen. Der
 * Nutzer hatte Ollama nie angefasst.
 *
 * Der Weg dahin ist der Modellschritt: seine Liste "Models you already have"
 * kommt aus Ollamas `/api/tags`, ohne je zu fragen, ob dieser Anbieter
 * ueberhaupt eingeschaltet sein darf. Ein Klick auf eine Zeile schaltete ihn
 * ein. Die Regel dagegen steht in `lib/onboarding-provider-gate.ts` und hat
 * genau eine Marke: `disabledByUser`, geschrieben nur vom Disable-Knopf der
 * Anbieterkarte.
 *
 * Beide Faelle stehen hier:
 *   ausdruecklich abgeschaltet  bleibt abgeschaltet, und wird nicht angeboten
 *   Erstlauf ohne Marke         darf weiter einschalten, wie bisher
 *
 * Lauf: npx vitest run src/components/onboarding/__tests__/der-assistent-schaltet-ollama-nicht-heimlich-ein.test.tsx
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement } from 'react'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isReturnableRow } from '../../../lib/provider-visibility'

const listModels = vi.fn(async () => [{ name: 'llama3.1:8b' }, { name: 'qwen3:14b' }])
vi.mock('../../../api/ollama', () => ({
  listModels: () => listModels(),
  pullModelTauri: vi.fn(),
  checkConnection: vi.fn(async () => false),
}))
vi.mock('../../../api/backend', () => ({
  backendCall: vi.fn(async () => ({})),
  isTauri: () => false,
  isMacOS: () => false,
  openExternal: vi.fn(),
  secretGet: vi.fn().mockRejectedValue(new Error('no keychain here')),
  secretSet: vi.fn(),
  secretDelete: vi.fn(),
}))
vi.mock('../../../api/discover', () => ({
  detectProviderModelPath: vi.fn(async () => ''),
  startModelDownloadToPath: vi.fn(),
  lazarusEngineDownloadDir: vi.fn(async () => ''),
}))
vi.mock('../../../api/engine', () => ({ activateBuiltinModel: vi.fn() }))
vi.mock('../../../api/comfyui', () => ({ getSystemVRAM: vi.fn(async () => 0) }))

const { mayEnableFromWizard } = await import('../../../lib/onboarding-provider-gate')
const { useProviderStore } = await import('../../../stores/providerStore')
const { useModelStore } = await import('../../../stores/modelStore')
const { ModelsStep } = await import('../ModelsStep')
const { onboardingSkin } = await import('../onboarding-skin')

const LEERE_FLOTTE = {
  ollama: { phase: 'idle' }, lmstudio: { phase: 'idle' },
  comfyInstall: { phase: 'idle' }, pythonInstall: { phase: 'idle' },
  ollamaDo: () => {}, lmstudioDo: () => {}, comfyInstallDo: () => {}, pythonInstallDo: () => {},
  secondsOf: () => 0,
}
const LEERER_SCAN = {
  detectedBackends: [], detecting: false, selectedBackend: 'builtin',
  setSelectedBackend: () => {}, lmstudioOfflineDetected: false, lmstudioModelCount: 0,
  runDetection: async () => {}, stopDetection: () => {},
}

async function schrittZeichnen() {
  await act(async () => {
    render(createElement(ModelsStep, {
      skin: onboardingSkin(true),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      scan: LEERER_SCAN as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fleet: LEERE_FLOTTE as any,
      step: 'models' as const,
      setStep: () => {},
      pulledModels: [],
      setPulledModels: () => {},
    }))
  })
}

const ollama = () => useProviderStore.getState().providers.ollama

beforeEach(() => {
  listModels.mockClear()
  useModelStore.setState({ activeModel: null })
})
afterEach(cleanup)

describe('die Regel selbst', () => {
  it('nur das ausdrueckliche Nein zaehlt', () => {
    expect(mayEnableFromWizard(undefined)).toBe(true)             // Erstlauf, kein Eintrag
    expect(mayEnableFromWizard({})).toBe(true)                    // frische Ablage, keine Marke
    expect(mayEnableFromWizard({ disabledByUser: false })).toBe(true)  // Enable geloescht
    expect(mayEnableFromWizard({ disabledByUser: true })).toBe(false)  // Disable gedrueckt
  })
})

describe('Ollama steht auf DISABLED', () => {
  beforeEach(() => {
    useProviderStore.getState().setProviderConfig('ollama', { enabled: false, disabledByUser: true })
  })

  it('der Modellschritt bietet Ollamas Modelle nicht an und fragt sie gar nicht erst ab', async () => {
    await schrittZeichnen()
    expect(screen.queryByText('Models you already have')).toBeNull()
    expect(screen.queryByText('llama3.1:8b')).toBeNull()
    expect(listModels).not.toHaveBeenCalled()
  })

  it('und der Anbieter bleibt nach dem Schritt aus, mit seiner Marke', async () => {
    await schrittZeichnen()
    expect(ollama().enabled).toBe(false)
    expect(ollama().disabledByUser).toBe(true)
  })
})

describe('die ausdrueckliche Wahl im Backend-Schritt', () => {
  /**
   * Wer Ollama im Backend-Schritt selbst anklickt, schaltet ihn ein, das ist
   * kein heimliches Einschalten. Dann muss die Marke aber auch weg, sonst
   * traegt ein eingeschalteter Anbieter weiter "vom Nutzer ausgeschaltet" und
   * der Assistent wuerde sich beim naechsten Lauf an ein Nein erinnern, das
   * der Nutzer zurueckgenommen hat. Der Enable-Knopf der Anbieterkarte
   * schreibt beide Felder; die Weiche des Assistenten schrieb nur eins.
   *
   * Geprueft am Quelltext, weil die Weiche `selectBackendAndContinue` in der
   * Schale sitzt und nur ueber das ganze Assistentenfenster erreichbar waere.
   */
  it('schreibt beide Felder, wie der Enable-Knopf es tut', () => {
    const schale = readFileSync(resolve(__dirname, '..', 'Onboarding.tsx'), 'utf8')
    expect(schale).toContain("setProviderConfig('ollama', { enabled: true, disabledByUser: false })")
    const karte = readFileSync(resolve(__dirname, '../../settings', 'ProviderConfig.tsx'), 'utf8')
    expect(karte).toContain('disabledByUser: !nextEnabled')
  })
})

describe('Erstlauf: keine Marke, alles wie bisher', () => {
  beforeEach(() => {
    useProviderStore.getState().setProviderConfig('ollama', { enabled: false, disabledByUser: undefined })
  })

  it('die Modelle stehen da, und ein Klick schaltet Ollama ein', async () => {
    await schrittZeichnen()
    expect(listModels).toHaveBeenCalled()
    expect(screen.getByText('Models you already have')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByText('llama3.1:8b')) })
    expect(ollama().enabled).toBe(true)
    expect(useModelStore.getState().activeModel).toBe('llama3.1:8b')
  })
})

/**
 * R2-14: dieselbe Marke, die andere Tuer.
 *
 * Der Modellschritt fragt das Tor seit dem ersten Fund. Der Erkenner beim
 * Anlauf der App (`AppShell.tsx`) fragte es nicht: er schrieb `enabled: true`
 * fuer beide Steckplaetze und liess `disabledByUser: true` daneben stehen.
 * V1 hat ausdruecklich widerlegt, dass der openai-Steckplatz geschuetzt sei,
 * diese Stelle ruft `slotTakeoverUpdate` gar nicht. Ein ausdrueckliches Nein
 * ueberlebte also den Modellschritt und starb am naechsten App-Start.
 *
 * Am Quelltext geprueft, wie der Nachbarfall darueber: der Erkenner haengt an
 * einem Effekt der ganzen Schale und ist einzeln nicht erreichbar. Der
 * Wirkungsteil steht darunter am Anbieter-Store.
 */
describe('R2-14: der Erkenner beim Anlauf hebt den Disable-Knopf nicht auf', () => {
  const schale = () => readFileSync(resolve(__dirname, '../../layout', 'AppShell.tsx'), 'utf8')

  it('setzt enabled fuer BEIDE Steckplaetze nur hinter dem Tor', () => {
    const quelle = schale()
    expect(quelle).toContain("import { mayEnableFromWizard }")
    // Jeder Aufruf des Erkenners, der einschaltet, geht durch das Tor.
    const einschaltungen = [...quelle.matchAll(/\{ enabled: true \}/g)]
    const ungetorte = [...quelle.matchAll(/^\s*enabled: true,$/gm)]
    expect(einschaltungen.length, 'keine getorte Einschaltung mehr im Erkenner')
      .toBeGreaterThanOrEqual(2)
    expect(ungetorte.length, 'eine Einschaltung ohne Tor im Erkenner').toBe(0)
  })

  it('die Adresse darf trotzdem nachgezogen werden, ein Port ist keine Einschaltung', () => {
    const quelle = schale()
    expect(quelle).toContain('baseUrl: nonOllama.baseUrl')
    expect(quelle).toContain('baseUrl: detectedOllama.baseUrl')
  })

  it('WIRKUNG: ein ausdrueckliches Nein ueberlebt eine Adressaktualisierung', () => {
    // isReturnableRow ist das, was die Anbieterkarte zeichnet: die Zeile mit
    // dem Enable-Knopf, die T2 nach dem Anlauf nicht mehr vorfand.
    useProviderStore.getState().setProviderConfig('ollama', { enabled: false, disabledByUser: true })
    // Genau das, was der Erkenner hinter dem geschlossenen Tor noch schreibt.
    useProviderStore.getState().setProviderConfig('ollama', {
      baseUrl: 'http://127.0.0.1:11434',
      isLocal: true,
    })
    expect(ollama().enabled).toBe(false)
    expect(ollama().disabledByUser).toBe(true)
    expect(isReturnableRow(ollama())).toBe(true)
    expect(ollama().baseUrl).toBe('http://127.0.0.1:11434')
  })

  it('NEGATIVKONTROLLE: eine frische Installation ohne Marke wird weiter eingeschaltet', () => {
    useProviderStore.getState().setProviderConfig('ollama', { enabled: false, disabledByUser: undefined })
    expect(mayEnableFromWizard(useProviderStore.getState().providers.ollama)).toBe(true)
    expect(isReturnableRow(useProviderStore.getState().providers.ollama), 'keine Enable-Zeile ohne Marke').toBe(false)
    useProviderStore.getState().setProviderConfig('ollama', { enabled: true })
    expect(ollama().enabled).toBe(true)
  })
})
