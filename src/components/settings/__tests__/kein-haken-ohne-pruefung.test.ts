/**
 * @vitest-environment jsdom
 *
 * Der gruene Haken sagt etwas ueber eine Pruefung aus. Also steht er erst da,
 * wenn eine Pruefung durchgekommen ist.
 *
 * R2-12 hat den Haken vom FEHLGESCHLAGENEN Versuch getrennt. Der Fall, in dem
 * es gar keinen Versuch gab, blieb: `lastChecked` steht beim Anlauf auf null,
 * bis die erste Pruefung fuenf Sekunden spaeter zurueck ist, und
 * `onRehydrateStorage` setzt es bei jedem Neustart wieder auf null, sobald die
 * gespeicherte Version nicht neuer ist als die laufende. Genau das ist der
 * Normalfall eines Nutzers, der auf dem neuesten Stand ist.
 *
 * T13 hat am 12.09.2026 auf der Windows-Box gemessen, was daran teuer ist: der
 * Satz "You are on the latest version." stand VOR dem Druck auf
 * "Check for updates" da und danach zeichengleich wieder, obwohl die Anfrage
 * dazwischen mit Status 200 in 992 ms beantwortet wurde. Der Nutzer kann an
 * der Anzeige also nicht ablesen, ob jemand nachgesehen hat.
 *
 * Negativkontrolle: gegen den Stand vor dem Fix (der Haken als letzter Zweig,
 * ohne `lastChecked`) sind die ersten beiden Faelle rot.
 *
 * T13b hat am 12.09.2026 den zweiten Teil davon nachgemessen: der Satz ist
 * gedeckt, aber er traegt kein Datum. Beim ersten Messlauf war die Aussage
 * beim Oeffnen rund eine Stunde und zwei Programmstarts alt, und die
 * Zeichenfolge `Last checked` kam in `src/components` null Mal vor. Der zweite
 * Block unten haengt das Datum daran, in der Kurzform aus
 * `src/lib/time-ago.ts`. Negativkontrolle dazu: gegen die Originalquelle
 * (`SettingsPage.tsx` ohne `lastCheckedText`) sind dessen erste vier Faelle
 * rot, drei am fehlenden Text und einer am fehlenden Export.
 *
 * Run: npx vitest run src/components/settings/__tests__/kein-haken-ohne-pruefung.test.ts
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createElement } from 'react'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'

vi.mock('../../../api/backend', () => ({
  backendCall: vi.fn(async () => ({})),
  isTauri: () => true,
  isMacOS: () => false,
  isLinux: () => false,
  isWindows: () => true,
  openExternal: vi.fn(),
  secretGet: vi.fn().mockRejectedValue(new Error('no keychain here')),
  secretSet: vi.fn(),
  secretDelete: vi.fn(),
}))

const { UpdateSection, lastCheckedText } = await import('../SettingsPage')
const { useUpdateStore } = await import('../../../stores/updateStore')

async function section(over: Record<string, unknown>) {
  useUpdateStore.setState({
    currentVersion: '3.0.0',
    latestVersion: null,
    updateAvailable: false,
    releaseNotes: null,
    isChecking: false,
    lastChecked: null,
    lastCheckFailed: false,
    dismissed: null,
    downloadStatus: 'idle',
    downloadProgress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    errorMessage: null,
    progressNote: null,
    installMethod: null,
    ...over,
  })
  render(createElement(UpdateSection))
  fireEvent.click(screen.getByText('Updates'))
  await act(async () => { await Promise.resolve() })
}

afterEach(cleanup)

describe('der Haken haengt an einer Pruefung', () => {
  it('sagt vor der ersten Pruefung nicht, dass alles aktuell ist', async () => {
    await section({})

    expect(screen.queryByText('You are on the latest version.')).toBeNull()
    expect(screen.getByTestId('update-not-checked')).toBeTruthy()
  })

  it('und sagt es, sobald eine Pruefung durchgekommen ist', async () => {
    await section({ lastChecked: Date.parse('2026-09-12T12:37:46.768Z') })

    expect(screen.getByTestId('update-latest')).toBeTruthy()
    expect(screen.getByText('You are on the latest version.')).toBeTruthy()
    expect(screen.queryByTestId('update-not-checked')).toBeNull()
  })

  // NEGATIVKONTROLLE: der Weg aus R2-12 bleibt, wie er war. Eine
  // fehlgeschlagene Pruefung sagt weiter, dass sie fehlgeschlagen ist, und
  // nicht "noch nicht geprueft".
  it('laesst die gescheiterte Pruefung ihren eigenen Satz behalten', async () => {
    await section({ lastCheckFailed: true })

    expect(screen.getByTestId('update-check-failed')).toBeTruthy()
    expect(screen.queryByTestId('update-not-checked')).toBeNull()
    expect(screen.queryByText('You are on the latest version.')).toBeNull()
  })

  // NEGATIVKONTROLLE: eine gefundene Aktualisierung geht vor. Ohne diesen Fall
  // koennte der Fix oben den Haken durch "Not checked yet." ersetzen und dabei
  // den Update-Kasten mit verdecken.
  it('und zeigt eine gefundene Aktualisierung, egal was lastChecked sagt', async () => {
    await section({ updateAvailable: true, latestVersion: '3.0.1', lastChecked: null })

    expect(screen.getByText('Update available!')).toBeTruthy()
    expect(screen.queryByTestId('update-not-checked')).toBeNull()
  })
})

describe('und der Satz sagt, wann jemand nachgesehen hat', () => {
  const MINUTE = 60 * 1000

  it('setzt die Zeitangabe unter den Satz', async () => {
    await section({ lastChecked: Date.now() - (3 * MINUTE + 5000) })

    expect(screen.getByTestId('update-last-checked').textContent).toBe('Last checked 3m ago')
  })

  it('nennt eine frische Pruefung beim Namen statt mit einer Null', async () => {
    await section({ lastChecked: Date.now() - 20 * 1000 })

    expect(screen.getByTestId('update-last-checked').textContent).toBe('Last checked just now')
  })

  it('traegt auch den gemessenen Fall der Box, rund eine Stunde alt', async () => {
    await section({ lastChecked: Date.now() - (61 * MINUTE) })

    expect(screen.getByTestId('update-last-checked').textContent).toBe('Last checked 1h ago')
  })

  it('schreibt die Kurzform aus time-ago.ts fort, ohne eine zweite Uhr zu bauen', () => {
    const now = Date.parse('2026-09-12T14:46:09.030Z')

    expect(lastCheckedText(now - 47 * 1000, now)).toBe('Last checked just now')
    expect(lastCheckedText(now - 5 * MINUTE, now)).toBe('Last checked 5m ago')
    expect(lastCheckedText(now - 3 * 60 * MINUTE, now)).toBe('Last checked 3h ago')
    expect(lastCheckedText(now - 2 * 24 * 60 * MINUTE, now)).toBe('Last checked 2d ago')
    expect(lastCheckedText(now - 9 * 24 * 60 * MINUTE, now)).toBe('Last checked 1w ago')
  })

  // NEGATIVKONTROLLE: ohne Pruefung keine Zeitangabe. Sonst stuende dort eine
  // Zahl, die aus nichts kommt.
  it('haengt keine Zeitangabe an, solange niemand nachgesehen hat', async () => {
    await section({})

    expect(screen.queryByTestId('update-last-checked')).toBeNull()
    expect(screen.getByTestId('update-not-checked')).toBeTruthy()
  })

  // NEGATIVKONTROLLE: und die gescheiterte Pruefung bekommt auch keine, denn
  // sie hat `lastChecked` nicht angefasst.
  it('haengt auch an die gescheiterte Pruefung keine Zeitangabe', async () => {
    await section({ lastCheckFailed: true, lastChecked: Date.now() - 5 * MINUTE })

    expect(screen.queryByTestId('update-last-checked')).toBeNull()
    expect(screen.getByTestId('update-check-failed')).toBeTruthy()
  })
})
