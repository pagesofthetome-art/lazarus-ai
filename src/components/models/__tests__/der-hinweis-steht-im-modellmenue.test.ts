/**
 * @vitest-environment jsdom
 *
 * R13D Nebenfund 1, zweite Runde. Eigner am 21.09.2026: "die Lazarus engine missing
 * meldung ist schon wieder im prompt fenster! NICHTS im prompt fenster! verstau
 * das ordentlich wo es gut aussieht. eventuell im model dropdown ganz oben oder
 * so."
 *
 * Der Hinweis steht jetzt ganz oben im Modellmenue des Chats, nicht mehr als
 * Leiste ueber der Eingabezeile (EngineMissingBar ist geloescht). Damit ihn
 * ueberhaupt jemand findet, traegt der Modellknopf solange den kleinen Punkt,
 * den das Haus schon fuer "hier wartet etwas" benutzt.
 *
 * Diese Datei haengt den echten Waehler ein statt seine Quelle zu lesen: die
 * Frage ist, was auf dem Bildschirm landet, und die beantwortet nur ein
 * gerendertes Menue. Der Waechter, dass die Eingabezeile leer bleibt, steht in
 * components/chat/__tests__/die-eingangszeile-traegt-keinen-engine-hinweis.test.tsx.
 *
 * Run: npx vitest run src/components/models/__tests__/der-hinweis-steht-im-modellmenue.test.ts
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
const { useModelStore } = await import('../../../stores/modelStore')
const { useUIStore } = await import('../../../stores/uiStore')
const { resetEngineNoticeDismissal } = await import('../../../lib/engine-notice-session')

const slot = (extra: Partial<ProviderConfig>): ProviderConfig => ({
  id: 'openai', name: 'Jan', enabled: true, baseUrl: 'http://localhost:1337/v1',
  apiKey: '', isLocal: true, ...extra,
})

function setSlot(config: ProviderConfig) {
  useProviderStore.setState((s) => ({ providers: { ...s.providers, openai: config } }))
}

/** Der Waehler, aufgeklappt. */
function openPicker() {
  render(createElement(ModelSelector))
  fireEvent.click(screen.getByLabelText('Select chat model'))
}

beforeEach(() => {
  useProviderStore.setState({ engineOptedOut: false })
  useModelStore.setState({ models: MODELS })
  useUIStore.setState({ currentView: 'chat', settingsFocus: null })
  resetEngineNoticeDismissal()
})
afterEach(cleanup)

describe('Lazarus Engine ist aus der Anbieterliste gefallen, Modus Local', () => {
  it('die Zeile steht GANZ OBEN im Menue und sagt genau einen wahren Satz', () => {
    setSlot(slot({ managed: false }))
    openPicker()
    const menue = screen.getByTestId('model-picker-menu')
    const zeile = screen.getByTestId('picker-engine-missing')
    expect(menue.firstElementChild, 'die Zeile ist das erste Kind des Menues').toBe(zeile)
    expect(zeile.textContent).toContain('Lazarus Engine is missing from your providers.')
    expect(zeile.textContent).toContain('Open AI Backends')
    // Nichts behaupten, was nicht stimmt: ein anderes lokales Backend (Jan)
    // kann den Steckplatz halten und der Chat antwortet trotzdem.
    expect(zeile.textContent).not.toContain('will not answer')
    expect(zeile.textContent).not.toContain('built-in')
  })

  it('der Textknopf fuehrt nach Settings, AI Backends, und schliesst das Menue', () => {
    setSlot(slot({ managed: false }))
    openPicker()
    expect(useUIStore.getState().currentView, 'vorher steht die App im Chat').toBe('chat')
    fireEvent.click(screen.getByTestId('picker-engine-missing-open'))
    expect(useUIStore.getState().currentView).toBe('settings')
    expect(useUIStore.getState().settingsFocus?.tab).toBe('backends')
    // Das Menue geht zu. Gemessen am Ausloeser und nicht am Knoten: die
    // Ausblendung von framer-motion laesst ihn noch einen Wimpernschlag
    // stehen, `aria-expanded` sagt sofort die Wahrheit.
    expect(screen.getByLabelText('Select chat model').getAttribute('aria-expanded')).toBe('false')
  })

  it('das X blendet Zeile UND Punkt aus, der Rest des Menues bleibt stehen', () => {
    setSlot(slot({ managed: false }))
    openPicker()
    expect(screen.queryAllByTestId('picker-engine-missing-dot').length).toBe(1)
    fireEvent.click(screen.getByLabelText('Dismiss'))
    expect(screen.queryAllByTestId('picker-engine-missing').length).toBe(0)
    expect(screen.queryAllByTestId('picker-engine-missing-dot').length).toBe(0)
    expect(screen.queryAllByTestId('model-picker-menu').length, 'das Menue ist mitgegangen').toBe(1)
  })

  it('der Punkt sitzt am Modellknopf und ist auch ohne aufgeklapptes Menue da', () => {
    setSlot(slot({ managed: false }))
    render(createElement(ModelSelector))
    expect(screen.queryAllByTestId('model-picker-menu').length, 'das Menue ist zu').toBe(0)
    const punkt = screen.getByTestId('picker-engine-missing-dot')
    expect(punkt.getAttribute('aria-hidden'), 'der Punkt ist stumm fuer Screenreader').toBe('true')
    // Am Knopf, nicht irgendwo: derselbe positionierte Behaelter traegt den
    // Ausloeser.
    expect(punkt.parentElement?.contains(screen.getByLabelText('Select chat model'))).toBe(true)
  })
})

describe('NEGATIVKONTROLLEN: die drei Lagen, in denen nichts stehen darf', () => {
  it('Lazarus Engine haelt den Steckplatz: 0 Zeilen, 0 Punkte', () => {
    setSlot(slot({ managed: true, name: 'Lazarus Engine' }))
    openPicker()
    expect(screen.queryAllByTestId('picker-engine-missing').length).toBe(0)
    expect(screen.queryAllByTestId('picker-engine-missing-dot').length).toBe(0)
    expect(screen.queryAllByTestId('model-picker-menu').length, 'das Menue selbst ist offen').toBe(1)
  })

  it('der Kunde hat ein anderes lokales Backend mit Absicht gewaehlt (engineOptedOut): 0 Zeilen, 0 Punkte', () => {
    setSlot(slot({ managed: false }))
    useProviderStore.setState({ engineOptedOut: true })
    openPicker()
    expect(screen.queryAllByTestId('picker-engine-missing').length).toBe(0)
    expect(screen.queryAllByTestId('picker-engine-missing-dot').length).toBe(0)
  })

  it('Lazarus Engine steht nur auf Abruf (displaced): sie hat eine Karte, 0 Zeilen, 0 Punkte', () => {
    setSlot(slot({
      managed: false,
      displaced: { name: 'Lazarus Engine', baseUrl: 'http://127.0.0.1:8127/v1', isLocal: true, managed: true },
    }))
    openPicker()
    expect(screen.queryAllByTestId('picker-engine-missing').length).toBe(0)
    expect(screen.queryAllByTestId('picker-engine-missing-dot').length).toBe(0)
  })

})
