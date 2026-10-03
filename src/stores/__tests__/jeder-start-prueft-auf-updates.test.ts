/**
 * Jeder Programmstart prueft genau einmal auf Updates.
 *
 * `initUpdateChecker` ruft `checkForUpdate(true, true)` auf, damit ein frischer
 * gespeicherter `lastChecked`-Zeitpunkt den einmaligen Start-Check nicht
 * unterdrueckt. Der zweite Parameter sorgt dafuer, dass ein Update-Prompt
 * erscheint, bevor etwas geladen wird. Es gibt keinen periodischen Timer.
 *
 * Der Tester hat das am 12.09.2026 auf der Windows-Box dreimal in Folge
 * gemessen: drei Starts, null Aufrufe am Draht. `lastChecked` war beim
 * Messlauf 14:45:22.934Z, der Start 14:46:09.030Z, also 47 Sekunden alt. Das
 * `setInterval` (`:664-666`) mit denselben sechs Stunden feuert nur in einem
 * Prozess, der sechs Stunden lebt, greift also nicht ein. Wer die App oefter
 * neu startet, bekommt nie eine automatische Pruefung. Das steht gegen die
 * Regel "Updates muessen ankommen".
 *
 * Ein gewoehnlicher manueller Aufruf unterliegt weiter dem 6-Stunden-Deckel;
 * der Start-Check und ein explizit erzwungener Aufruf umgehen ihn.
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
  vi.stubEnv('VITE_GITHUB_REPO', 'pagesofthetome-art/lazarus-ai')
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
  vi.unstubAllEnvs()
})

describe('die Startpruefung laeuft einmal pro Start, unabhaengig vom letzten Zeitpunkt', () => {
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

  it('prueft auch beim Neustart 47 Sekunden nach der letzten Pruefung', async () => {
    await frischerStart(NOW - 47 * 1000)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('prueft auch beim Neustart 14 Minuten nach der letzten Pruefung', async () => {
    await frischerStart(NOW - 14 * MINUTE)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
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
