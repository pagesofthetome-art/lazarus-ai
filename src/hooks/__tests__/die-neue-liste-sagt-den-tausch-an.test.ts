/**
 * @vitest-environment jsdom
 *
 * Wenn die App die Modellwahl des Nutzers selbst ersetzt, weil das gewaehlte
 * Modell aus dem Bestand verschwunden ist, sagt sie es.
 *
 * Gegenprobe G1, 04.09.2026: den Provider LM Studio in den Einstellungen
 * wieder herausnehmen, waehrend ein LM-Studio-Modell gewaehlt ist. Die naechste
 * Bestandsrunde bringt eine Liste ohne dieses Modell, `setModels` verwirft die
 * Wahl und nimmt den ersten Chat-Eintrag, und die Zeile ueber dem Eingabefeld
 * blieb leer. Der Satz dafuer existierte, nur konnte er nie ausloesen: er hing
 * an der alten AppShell-Modusregel, die erst nach dem Store-Update lief und
 * dann keinen Unterschied mehr erkennen konnte.
 *
 * Gesagt wird es deshalb dort, wo beide Namen noch dastehen: bei dem, der die
 * frische Liste hereingibt.
 *
 * Eine unveraenderte Auswahl bekommt keine Ersatzmeldung; the inventory
 * comparison belongs to the hook that receives the refreshed model list.
 *
 * Run: npx vitest run src/hooks/__tests__/die-neue-liste-sagt-den-tausch-an.test.ts
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

interface Zeile { id: string; provider: string; providerName: string }
let providerRows: Array<{ id: string; listModels: () => Promise<Zeile[]> }> = []

vi.mock('../../api/backend', () => ({
  isTauri: () => true,
  // Mac: die Medienspuren fragen gar nicht erst nach ComfyUI.
  isMacOS: () => true,
  isWindows: () => false,
  isLinux: () => false,
  backendCall: vi.fn(async () => null),
  secretGet: vi.fn().mockRejectedValue(new Error('no vault')),
  secretSet: vi.fn(), secretDelete: vi.fn(),
}))
vi.mock('../../api/comfyui', () => ({
  getInstalledImageModels: vi.fn(async () => []),
  getInstalledVideoModels: vi.fn(async () => []),
  checkComfyConnection: vi.fn(async () => false),
  readModelDiskSizes: vi.fn(async () => new Map()),
}))
vi.mock('../../api/ollama', () => ({
  listModels: vi.fn(async () => []), unloadModel: vi.fn(async () => undefined),
  pullModel: vi.fn(), pullModelTauri: vi.fn(), deleteModel: vi.fn(), showModel: vi.fn(),
}))
vi.mock('../../api/lmstudio', () => ({ unloadLmStudioModel: vi.fn(async () => undefined) }))
vi.mock('../../api/providers', async () => {
  const actual = await vi.importActual<typeof import('../../api/providers')>('../../api/providers')
  return { ...actual, getEnabledProviders: () => providerRows }
})
vi.mock('../../api/engine', async () => {
  const actual = await vi.importActual<typeof import('../../api/engine')>('../../api/engine')
  return {
    ...actual,
    listBundledModels: vi.fn(async () => []),
    isManagedBuiltinActive: () => false,
    bundledEngineStatus: vi.fn(async () => ({ running: true, healthy: true, port: 8127 })),
    bundledEmbedStatus: vi.fn(async () => ({ running: true, healthy: true, port: 8128 })),
    startBundledEmbed: vi.fn(),
    activateBuiltinModel: vi.fn(async () => true),
  }
})

const { useModels } = await import('../useModels')
const { useModelStore } = await import('../../stores/modelStore')
const { useLazarusEngineSwitchStore } = await import('../../stores/lazarusEngineSwitchStore')

const LMS = 'openai::qwen2.5-0.5b-instruct'
const OLLAMA = 'test-model:8b'

/** Was LM Studio ueber den geteilten openai-Steckplatz meldet. */
function lmStudioIstDa() {
  providerRows = [{
    id: 'openai',
    listModels: async () => [
      { id: 'qwen2.5-0.5b-instruct', provider: 'openai', providerName: 'LM Studio' },
    ],
  }]
}

/** Derselbe Rechner, nachdem der Provider herausgenommen wurde. */
function nurNochOllama() {
  providerRows = [{
    id: 'ollama',
    listModels: async () => [{ id: OLLAMA, provider: 'ollama', providerName: 'Ollama' }],
  }]
}

async function bestandHolen() {
  const { result } = renderHook(() => useModels())
  await act(async () => { await result.current.fetchModels() })
}

beforeEach(() => {
  providerRows = []
  useLazarusEngineSwitchStore.setState({ note: null, tone: 'info', generation: 0 })
  useModelStore.setState({ models: [], activeModel: LMS })
})

describe('die App waehlt um, weil das Modell weg ist', () => {
  it('DER FALL AUS G1: sie nennt beide Namen, statt stumm zu tauschen', async () => {
    nurNochOllama()
    await bestandHolen()

    expect(useModelStore.getState().activeModel).toBe(OLLAMA)
    const zeile = useLazarusEngineSwitchStore.getState().note ?? ''
    expect(zeile, 'die Wahl sprang stumm auf den ersten Eintrag').not.toBe('')
    expect(zeile).toContain('qwen2.5-0.5b-instruct')
    expect(zeile).toContain(OLLAMA)
    // Kein Alarm: der Nutzer muss nichts reparieren, er muss es nur wissen.
    expect(useLazarusEngineSwitchStore.getState().tone).toBe('info')
  })

  it('NEGATIVKONTROLLE: steht die Wahl noch in der Liste, gibt es nichts zu sagen', async () => {
    // Das ist zugleich der Moduswechsel: der Local/Cloud-Schalter filtert nur
    // die Ansicht, im Store bleibt jeder Name stehen, also tauscht `setModels`
    // nichts und diese Tuer schweigt.
    lmStudioIstDa()
    await bestandHolen()

    expect(useModelStore.getState().activeModel).toBe(LMS)
    expect(useLazarusEngineSwitchStore.getState().note).toBeNull()
  })

  it('NEGATIVKONTROLLE: eine leere Antwort ist kein Tausch und keine Zeile', async () => {
    // Jeder Provider ausgefallen. `setModels` behaelt die Wahl absichtlich, und
    // eine Zeile ueber einen Tausch, der nicht stattgefunden hat, waere falsch.
    providerRows = []
    await bestandHolen()

    expect(useModelStore.getState().activeModel).toBe(LMS)
    expect(useLazarusEngineSwitchStore.getState().note).toBeNull()
  })

  it('NEGATIVKONTROLLE: ohne vorherige Wahl wurde nichts ersetzt', async () => {
    useModelStore.setState({ models: [], activeModel: null })
    nurNochOllama()
    await bestandHolen()

    expect(useModelStore.getState().activeModel).toBe(OLLAMA)
    expect(useLazarusEngineSwitchStore.getState().note).toBeNull()
  })

  it('zweimal hintereinander sagt es nur einmal', async () => {
    nurNochOllama()
    await bestandHolen()
    useLazarusEngineSwitchStore.setState({ note: null, tone: 'info', generation: 0 })
    await bestandHolen()

    expect(useLazarusEngineSwitchStore.getState().note).toBeNull()
  })
})

describe('die Datei holt sich ihre Nachbarn in je einer Zeile', () => {
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '..', 'useModels.ts'), 'utf8',
  )

  it('lmstudio-match wird einmal importiert, nicht zweimal untereinander', () => {
    const zeilen = src.split('\n').filter(
      (z) => z.startsWith('import') && z.includes("'../lib/lmstudio-match'"),
    )
    expect(zeilen).toHaveLength(1)
  })
})
