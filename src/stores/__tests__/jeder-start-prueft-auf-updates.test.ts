/**
 * Jeder Programmstart prueft auf Updates.
 *
 * Die Startpruefung laeuft ueber `initUpdateChecker` und damit ueber
 * `plugin:updater|check`. Sie lief bis T13b trotzdem nie: `checkForUpdate()`
 * ohne `force` kehrt um, solange `lastChecked` juenger als sechs Stunden ist
 * (`updateStore.ts:270`), `lastChecked` wird gespeichert (`:546`) und
 * `onRehydrateStorage` (`:557-573`) nullt ihn nur, wenn eine gespeicherte
 * `latestVersion` oder `updateAvailable` danebensteht. Auf einer Maschine, die
 * auf dem neuesten Stand ist, steht beides nicht.
 *
 * Der Tester hat das am 12.09.2026 auf der Windows-Box dreimal in Folge
 * gemessen: drei Starts, null Aufrufe am Draht. `lastChecked` war beim
 * Messlauf 14:45:22.934Z, der Start 14:46:09.030Z, also 47 Sekunden alt. Das
 * `setInterval` (`:664-666`) mit denselben sechs Stunden feuert nur in einem
 * Prozess, der sechs Stunden lebt, greift also nicht ein. Wer die App oefter
 * neu startet, bekommt nie eine automatische Pruefung. Das steht gegen die
 * Regel "Updates muessen ankommen".
 *
 * Negativkontrolle: mit der Originalquelle (`checkForUpdate()` ohne Argument
 * in `initUpdateChecker`) sind die Faelle 1 und 2 rot, je 1 erwarteter Aufruf
 * gegen 0 gemessene; Fall 3 und die zwei Deckelfaelle bleiben gruen.
 *
 * Run: npx vitest run src/stores/__tests__/jeder-start-prueft-auf-updates.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../api/backend', () => ({
  isTauri: () => false, // Dev-Pfad, also die GitHub-Route und ein zaehlbares fetch
  openExternal: vi.fn(),
}))

vi.mock('../../../package.json', () => ({ version: '3.0.0' }))

const NOW = Date.parse('2026-09-12T14:46:09.030Z')
const MINUTE = 60 * 1000

let fetchSpy: ReturnType<typeof vi.fn>

/** Ein frisches Modul je Fall: `initUpdateChecker` traegt einen
 *  Einmal-Riegel auf Modulebene. */
async function frischerStart(lastChecked: number | null) {
  vi.resetModules()
  const mod = await import('../updateStore')
  mod.useUpdateStore.setState({
    currentVersion: '3.0.0',
    latestVersion: null,
    updateAvailable: false,
    releaseNotes: null,
    isChecking: false,
    lastChecked,
    lastCheckFailed: false,
  })
  mod.initUpdateChecker()
  await vi.advanceTimersByTimeAsync(5_000) // INITIAL_DELAY
  return mod
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  fetchSpy = vi.fn(async () => ({
    ok: true,
    json: async () => ({ tag_name: 'v3.0.0', body: '', html_url: '' }),
  }))
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('die Startpruefung haengt an einem eigenen, kurzen Deckel', () => {
  it('prueft, wenn die letzte Pruefung 20 Minuten alt ist', async () => {
    await frischerStart(NOW - 20 * MINUTE)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('prueft auch nach einer Stunde, die der 6-Stunden-Deckel noch geschluckt haette', async () => {
    await frischerStart(NOW - 60 * MINUTE)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('prueft, wenn noch nie jemand nachgesehen hat', async () => {
    await frischerStart(null)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('haelt den gemessenen Fall der Box auf, 47 Sekunden nach der letzten Pruefung', async () => {
    await frischerStart(NOW - 47 * 1000)

    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  it('haelt zwei Starts kurz hintereinander auf, 14 Minuten auseinander', async () => {
    await frischerStart(NOW - 14 * MINUTE)

    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  // NEGATIVKONTROLLE: der 6-Stunden-Deckel selbst bleibt, wie er war. Nur der
  // Start umgeht ihn, ein gewoehnlicher Aufruf nicht.
  it('laesst den 6-Stunden-Deckel fuer den gewoehnlichen Aufruf stehen', async () => {
    vi.resetModules()
    const { useUpdateStore } = await import('../updateStore')
    useUpdateStore.setState({ lastChecked: NOW - 20 * MINUTE, isChecking: false })

    await useUpdateStore.getState().checkForUpdate()

    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  // NEGATIVKONTROLLE: und `force` zieht weiter durch, egal wie jung der
  // Zeitpunkt ist. Sonst waere der Knopf "Check for updates" mit erschlagen.
  it('laesst den erzwungenen Aufruf weiter durch, auch nach 47 Sekunden', async () => {
    vi.resetModules()
    const { useUpdateStore } = await import('../updateStore')
    useUpdateStore.setState({ lastChecked: NOW - 47 * 1000, isChecking: false })

    await useUpdateStore.getState().checkForUpdate(true)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
