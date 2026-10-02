/**
 * Die Remote-Bruecke schickt den Grundtext, nie die Person.
 *
 * Der Fund, den dieser Test festhaelt (11.09.2026): der Dispatch schickte den
 * LEEREN String. Das Handy war damit die einzige Oberflaeche ohne Grundtext
 * und antwortete aus der Anbieterhaltung, die laut Messung vom 10.09.2026
 * sechs von 46 Katalogmodellen die Antwort kostet. Der Neustartknopf war noch
 * schiefer: er reichte `conv.systemPrompt` durch, also genau die global
 * gewaehlte Person, die der Dispatch mit Absicht weglaesst. Ein Neustart hat
 * damit still eine andere Bruecke aufgebaut als der Dispatch.
 *
 * Beides zeigt jetzt auf CHAT_BASE_SYSTEM_PROMPT.
 *
 * Run: npx vitest run src/stores/__tests__/remote-grundtext.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { useRemoteStore } from '../remoteStore'
import { useMemoryStore } from '../memoryStore'
import { CHAT_BASE_SYSTEM_PROMPT, CHAT_BASE_ROLE, HOUSE_CONDUCT, HOUSE_SCOPE } from '../../lib/system-prompt'

vi.mock('../../api/backend', () => ({
  backendCall: vi.fn().mockResolvedValue({}),
  isTauri: vi.fn(() => true),
}))
import { backendCall } from '../../api/backend'
const mockBackend = backendCall as unknown as ReturnType<typeof vi.fn>

const SRC = resolve(__dirname, '..', '..')
const lies = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8')
const zaehle = (heuhaufen: string, nadel: string) => heuhaufen.split(nadel).length - 1

/** Der Systemtext, den die Rust-Seite zu sehen bekommt. */
function gesendeterSystemtext(): string {
  const call = mockBackend.mock.calls.find(
    (c) => c[0] === 'start_remote_server' || c[0] === 'restart_remote_server',
  )
  return String((call![1] as Record<string, unknown>).systemPrompt ?? '')
}

const echteMemoryLesung = useMemoryStore.getState().getMemoriesForPrompt

beforeEach(() => {
  mockBackend.mockClear()
  mockBackend.mockResolvedValue({ port: 11435, passcode: '123456' })
  useRemoteStore.setState({
    enabled: false, loading: false, error: null, dispatchedConversationId: null,
  })
  useMemoryStore.setState({ entries: [], getMemoriesForPrompt: echteMemoryLesung })
})

afterEach(() => {
  mockBackend.mockReset()
})

describe('Remote-Bruecke: der Grundtext geht raus', () => {
  it('a) ohne Person geht der Grundtext samt Reichweitenzeile raus', async () => {
    await useRemoteStore.getState().dispatch('c1', 'llama3', CHAT_BASE_SYSTEM_PROMPT)
    const text = gesendeterSystemtext()
    expect(text).toBe(CHAT_BASE_SYSTEM_PROMPT)
    expect(zaehle(text, CHAT_BASE_ROLE)).toBe(1)
    expect(zaehle(text, HOUSE_CONDUCT)).toBe(1)
    expect(zaehle(text, HOUSE_SCOPE)).toBe(1)
  })

  it('a2) der Neustart schickt denselben Text wie der Dispatch', async () => {
    await useRemoteStore.getState().restart('llama3', CHAT_BASE_SYSTEM_PROMPT)
    expect(gesendeterSystemtext()).toBe(CHAT_BASE_SYSTEM_PROMPT)
  })

  it('c) mit Memory steht der Grundtext vorn und die Erinnerung dahinter', async () => {
    useMemoryStore.setState({ getMemoriesForPrompt: () => 'MEM CONTEXT HERE' })
    await useRemoteStore.getState().dispatch('c1', 'llama3', CHAT_BASE_SYSTEM_PROMPT)
    const text = gesendeterSystemtext()
    expect(text.startsWith(CHAT_BASE_SYSTEM_PROMPT)).toBe(true)
    expect(text).toContain('MEM CONTEXT HERE')
    expect(text.indexOf(HOUSE_SCOPE)).toBeLessThan(text.indexOf('MEM CONTEXT HERE'))
    expect(zaehle(text, HOUSE_SCOPE)).toBe(1)
  })
})

/**
 * b) Die Person geht NIE raus. Das entscheiden die Aufrufer, nicht der Store,
 * deshalb wird hier die Quelle gelesen: ein Test, der nur den Store fragt,
 * waere gruen, waehrend die Seitenleiste weiter die Person durchreicht.
 */
describe('Remote-Bruecke: die Person geht nie raus', () => {
  it('die Seitenleiste dispatcht den Grundtext, nicht den leeren String und nicht die Person', () => {
    const quelle = lies('components/layout/Sidebar.tsx')
    expect(quelle).toContain('dispatch(convId, activeModel, CHAT_BASE_SYSTEM_PROMPT)')
    expect(quelle).not.toMatch(/dispatch\(convId, activeModel, ''\)/)
    expect(quelle).not.toMatch(/dispatch\([^)]*persona/)
  })

  it('der Neustartknopf der Seitenleiste reicht nicht mehr die Person durch', () => {
    const quelle = lies('components/layout/Sidebar.tsx')
    expect(quelle).toContain('restart(conv?.model, CHAT_BASE_SYSTEM_PROMPT)')
    expect(quelle).not.toMatch(/restart\(conv\?\.model, conv\?\.systemPrompt\)/)
  })

  it('der Neustart in der Chatansicht reicht nicht mehr die Person durch', () => {
    const quelle = lies('components/chat/ChatView.tsx')
    expect(quelle).toContain('remoteRestart(activeConv.model, CHAT_BASE_SYSTEM_PROMPT)')
    expect(quelle).not.toMatch(/remoteRestart\(activeConv\.model, activeConv\.systemPrompt\)/)
  })
})

/**
 * Was die Seite auf dem Handy mit dem Text macht, ist eine handgepflegte
 * Parallelkopie in reinem JavaScript. Sie wird hier NICHT geaendert, nur
 * festgehalten, damit der naechste Leser die Grenze kennt: im einfachen Chat
 * ohne Person wird der gesendete Text benutzt, unter Agent und Codex faellt er
 * weg, weil dort ein zusaetzlicher Text mit den Werkzeugregeln konkurriert.
 */
describe('Remote-Bruecke: was die Handy-Seite daraus macht', () => {
  const client = readFileSync(resolve(SRC, '..', 'mobile-client', 'client.js'), 'utf8')

  it('benutzt den gesendeten Text im einfachen Chat ohne Person', () => {
    expect(client).toContain('dispatchedSystemPrompt && !agentOn && !isCodex')
    expect(client).toContain('parts.push(dispatchedSystemPrompt)')
  })

  it('laesst ihn unter Agent und Codex weg, das ist der bekannte Rest der Luecke', () => {
    const bauer = client.slice(client.indexOf('function buildSystemPrompt()'))
    const bisZumEnde = bauer.slice(0, bauer.indexOf('return parts.join'))
    // Der Text kommt genau EINMAL vor, im Zweig mit den beiden Verneinungen.
    expect(zaehle(bisZumEnde, 'parts.push(dispatchedSystemPrompt)')).toBe(1)
  })
})

/**
 * R2-22: und was die Bruecke aus der Antwort MERKT, gehoert in dasselbe
 * Projekt wie die Unterhaltung.
 *
 * `extractMemoriesFromPair` ohne Bereich schreibt global. Der Ausloeser ist
 * nicht der erste Dispatch, der legt eine frische Unterhaltung an, sondern der
 * Neustartknopf: der haengt die Bruecke an eine BESTEHENDE Unterhaltung, und
 * deren Projekt ging dabei verloren. Danach steht eine Projekterinnerung in
 * jeder anderen Unterhaltung.
 *
 * Quelltextrechnung, weil der Aufruf in einem Ereignishaken der ganzen Schale
 * sitzt; die Regel darunter wird an der Sammlung gemessen.
 */
describe('R2-22: die Bruecke merkt sich im Projekt der Unterhaltung', () => {
  const schale = () => readFileSync(resolve(SRC, 'components/layout/AppShell.tsx'), 'utf8')

  it('gibt den Bereich der dispatchten Unterhaltung mit', () => {
    const quelle = schale()
    const aufruf = quelle.slice(quelle.indexOf('extractMemoriesFromPair('))
    expect(aufruf.slice(0, aufruf.indexOf('.catch')), 'kein Bereich, also global')
      .toContain('memoryScope')
    expect(quelle, 'der Bereich kommt nicht aus der dispatchten Unterhaltung')
      .toContain('.find((c) => c.id === dispatchedConversationId)?.memoryScope')
  })

  it('WIRKUNG: eine Erinnerung mit Projekt bleibt im Projekt', () => {
    useMemoryStore.setState({ entries: [] })
    useMemoryStore.getState().addMemory({
      type: 'project', title: 'Bruecke', description: 'x',
      content: 'Der Kunde heisst Hafner.', tags: [], source: 'remote', scope: 'projektA',
    })
    // Eine Unterhaltung ohne Projekt darf sie nicht sehen.
    expect(useMemoryStore.getState().getMemoriesForPrompt('Kunde', 8192)).toBe('')
    expect(useMemoryStore.getState().getMemoriesForPrompt('Kunde', 8192, { scope: 'projektA' }))
      .toContain('Hafner')
  })

  it('NEGATIVKONTROLLE: eine frisch dispatchte Unterhaltung ohne Projekt schreibt weiter global', () => {
    useMemoryStore.setState({ entries: [] })
    useMemoryStore.getState().addMemory({
      type: 'user', title: 'Global', description: 'x',
      content: 'Der Kunde heisst Hafner.', tags: [], source: 'remote', scope: undefined,
    })
    expect(useMemoryStore.getState().getMemoriesForPrompt('Kunde', 8192)).toContain('Hafner')
  })
})
