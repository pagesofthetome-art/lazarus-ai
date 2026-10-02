/**
 * @vitest-environment jsdom
 *
 * Die stehende Modellzeile steht im Modellmenue, nicht ueber der Eingabe.
 *
 * Eigner am 21.09.2026, am echten Windows-Bau, mehrfach und veraergert:
 * "NICHTS im prompt fenster!" Gemessen lag der Befund als Bild vor
 * (e2e/box-gruen/t15/shots/B3-dropdown-hint.png): IM Kasten des Composers,
 * direkt ueber der Zeile, in die er tippen wollte, stand eine Leiste mit x
 * und dem Satz
 *
 *   "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo" is gone from the model
 *   list, so the chat switched to "Qwen3.5-9B-Q4_K_M".
 *
 * Derselbe Umzug wie beim Lazarus-Engine-Hinweis eine Runde davor, aus demselben
 * Grund und an denselben Platz: der Satz handelt vom Modell, also steht er,
 * wo man das Modell waehlt. Dass die Wahl das Menue schliesst, war frueher
 * das Argument fuer den Platz ueber dem Composer; dagegen steht jetzt der
 * Punkt am Waehlerknopf, der bleibt, wenn das Menue zufaellt. Der Punkt ist
 * erlaubt, Text nicht.
 *
 * Diese Datei haengt den echten Waehler ein statt seine Quelle zu lesen: die
 * Frage ist, was auf dem Bildschirm landet.
 *
 * Run: npx vitest run src/components/models/__tests__/die-modellzeile-steht-im-menue.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement } from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { AIModel } from '../../../types/models'
import type { ProviderConfig } from '../../../api/providers/types'

const MODELS: AIModel[] = [{
  name: 'openai::model-a', model: 'openai::model-a', size: 0, type: 'text',
  provider: 'openai', providerName: 'Jan',
} as AIModel]

vi.mock('../../../hooks/useModels', () => ({
  useModels: () => ({
    models: MODELS,
    activeModel: 'openai::model-a',
    setActiveModel: vi.fn(),
    fetchModels: vi.fn(),
  }),
}))
vi.mock('../../../api/lmstudio', () => ({
  loadLmStudioModel: vi.fn(async () => {}),
  unloadLmStudioModel: vi.fn(async () => {}),
  listLoadedLmStudioModels: vi.fn(async () => [] as string[]),
}))
vi.mock('../../../api/ollama', () => ({
  listRunningModels: vi.fn(async () => [] as string[]),
  loadModel: vi.fn(async () => {}),
  unloadModel: vi.fn(async () => {}),
  unloadAllModels: vi.fn(async () => {}),
}))
vi.mock('../../../api/backend', () => ({ backendCall: vi.fn(async () => null) }))
vi.mock('../../../api/builtin-ensure', () => ({ diagnoseBuiltinEngine: vi.fn(async () => null) }))

const { ModelSelector } = await import('../ModelSelector')
const { useProviderStore } = await import('../../../stores/providerStore')
const { useSettingsStore } = await import('../../../stores/settingsStore')
const { useModelStore } = await import('../../../stores/modelStore')
const { useUIStore } = await import('../../../stores/uiStore')
const { resetEngineNoticeDismissal } = await import('../../../lib/engine-notice-session')
const { DEFAULT_SETTINGS } = await import('../../../lib/constants')

const slot = (extra: Partial<ProviderConfig>): ProviderConfig => ({
  id: 'openai', name: 'Jan', enabled: true, baseUrl: 'http://localhost:1337/v1',
  apiKey: '', isLocal: true, ...extra,
})

function setSlot(config: ProviderConfig) {
  useProviderStore.setState((s) => ({ providers: { ...s.providers, openai: config } }))
}

const { useLazarusEngineSwitchStore } = await import('../../../stores/lazarusEngineSwitchStore')

const SATZ =
  '"meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo" is gone from the model list, so the chat switched to "Qwen3.5-9B-Q4_K_M".'

/** Der Waehler, aufgeklappt. */
function openPicker() {
  render(createElement(ModelSelector))
  fireEvent.click(screen.getByLabelText('Select chat model'))
}

beforeEach(() => {
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } })
  useProviderStore.setState({ engineOptedOut: false })
  useModelStore.setState({ models: MODELS })
  useUIStore.setState({ currentView: 'chat', settingsFocus: null })
  resetEngineNoticeDismissal()
  // Die Lazarus Engine haelt den Steckplatz: dann steht der ANDERE Hinweis nicht
  // im Weg und dieser Test misst wirklich seine eigene Zeile.
  setSlot(slot({ managed: true, name: 'Lazarus Engine' }))
  useLazarusEngineSwitchStore.setState({ note: null, tone: 'info', gesehen: false })
})
afterEach(() => { cleanup(); useLazarusEngineSwitchStore.setState({ note: null, tone: 'info', gesehen: false }) })

describe('der Satz aus Bild B3 steht jetzt im Modellmenue', () => {
  it('ganz oben im Menue, woertlich, mit x', () => {
    useLazarusEngineSwitchStore.getState().announce(SATZ)
    openPicker()
    const menue = screen.getByTestId('model-picker-menu')
    const zeile = screen.getByTestId('picker-engine-note')
    expect(menue.firstElementChild, 'die Zeile ist das erste Kind des Menues').toBe(zeile)
    expect(zeile.textContent).toContain(SATZ)
    expect(zeile.getAttribute('data-tone')).toBe('info')
  })

  it('das x nimmt Zeile UND Punkt weg, das Menue bleibt stehen', () => {
    useLazarusEngineSwitchStore.getState().announce(SATZ)
    openPicker()
    expect(screen.queryAllByTestId('picker-engine-note-dot').length).toBe(1)
    fireEvent.click(screen.getByLabelText('Dismiss'))
    expect(screen.queryAllByTestId('picker-engine-note').length).toBe(0)
    expect(screen.queryAllByTestId('picker-engine-note-dot').length).toBe(0)
    expect(screen.queryAllByTestId('model-picker-menu').length, 'das Menue ist mitgegangen').toBe(1)
    expect(useLazarusEngineSwitchStore.getState().note).toBeNull()
  })

  it('der Punkt sitzt am Modellknopf und steht auch bei zugeklapptem Menue', () => {
    // Das ist die Bedingung, unter der der Umzug ueberhaupt zulaessig ist:
    // eine Zeile hinter einem Klick waere sonst eine Zeile, die niemand
    // findet.
    useLazarusEngineSwitchStore.getState().announce(SATZ)
    render(createElement(ModelSelector))
    expect(screen.queryAllByTestId('model-picker-menu').length, 'das Menue ist zu').toBe(0)
    const punkt = screen.getByTestId('picker-engine-note-dot')
    expect(punkt.getAttribute('aria-hidden'), 'der Punkt ist stumm fuer Screenreader').toBe('true')
    expect(punkt.parentElement?.contains(screen.getByLabelText('Select chat model'))).toBe(true)
  })

  it('ein gescheiterter Start faerbt Zeile und Punkt rot', () => {
    useLazarusEngineSwitchStore.getState().announce('The Lazarus Engine could not start.', 'error')
    openPicker()
    expect(screen.getByTestId('picker-engine-note').getAttribute('data-tone')).toBe('error')
    expect(screen.getByTestId('picker-engine-note-dot').className).toContain('bg-red-500')
  })
})

describe('die Lesezeit beginnt erst beim Aufklappen', () => {
  it('ein zugeklapptes Menue meldet nichts: der Punkt ist kein Leser', () => {
    useLazarusEngineSwitchStore.getState().announce(SATZ)
    render(createElement(ModelSelector))
    expect(screen.queryAllByTestId('model-picker-menu').length).toBe(0)
    expect(useLazarusEngineSwitchStore.getState().gesehen,
      'der blosse Punkt zaehlt als gelesen').toBe(false)
  })

  it('der aufgeklappte Waehler meldet die Zeile als gesehen', () => {
    // Die Verdrahtung, an der die neue Lesezeit haengt. Ohne sie stuende eine
    // Info bis zur Obergrenze, mit ihr laufen ab hier zwoelf Sekunden.
    useLazarusEngineSwitchStore.getState().announce(SATZ)
    openPicker()
    expect(screen.getByTestId('picker-engine-note')).toBeTruthy()
    expect(useLazarusEngineSwitchStore.getState().gesehen).toBe(true)
  })

  it('GEGENPROBE: ohne Zeile meldet auch ein offenes Menue nichts', () => {
    openPicker()
    expect(useLazarusEngineSwitchStore.getState().gesehen).toBe(false)
  })
})

describe('NEGATIVKONTROLLEN', () => {
  it('ohne Satz gibt es weder Zeile noch Punkt', () => {
    openPicker()
    expect(screen.queryAllByTestId('picker-engine-note').length).toBe(0)
    expect(screen.queryAllByTestId('picker-engine-note-dot').length).toBe(0)
  })

  it('zwei Punkte gleichzeitig gibt es nicht', () => {
    // Faellt Lazarus Engine aus der Anbieterliste UND steht ein Satz an, traegt
    // der Knopf genau einen Punkt: zwei uebereinander waeren ein Fleck.
    setSlot(slot({ managed: false }))
    useLazarusEngineSwitchStore.getState().announce(SATZ)
    render(createElement(ModelSelector))
    const punkte = screen.queryAllByTestId('picker-engine-missing-dot').length
      + screen.queryAllByTestId('picker-engine-note-dot').length
    expect(punkte).toBe(1)
  })
})
