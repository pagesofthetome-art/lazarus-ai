/**
 * @vitest-environment jsdom
 *
 * Fund 1 aus T2 (Windows-Box, installierte 3.0.0, 2026-09-11): nach
 * `Settings > General > Onboarding > Re-run onboarding` blieb der Assistent
 * bei `Step 1 of 4 . Engine`, `Scanning for local backends...` ueber vier
 * Minuten stehen. Gemessen wurde dort: `document.querySelectorAll('button')`
 * lieferte NULL Treffer, keine neue Logzeile, Escape half nicht, Neuladen half
 * nicht, erst ein Neustart der App loeste es.
 *
 * Die Ursache steckt nicht in den Sonden. Jede einzelne ist gedeckelt
 * (`lib/backend-detector.ts`: 2000 ms Anfrage, 2500 ms Rennen darueber), und
 * sie laufen parallel, das `Promise.allSettled` wartet also hoechstens 2,5
 * Sekunden auf die langsamste. Der Scan endet dort aber nicht: findet er
 * nichts, fragt er danach `lmstudio_server_status`, und dieser Aufruf ging
 * ohne jede Frist nach Rust. Antwortet Rust nicht, bleibt `detecting` fuer
 * immer wahr, und in diesem Zustand zeichnete der Schritt keinen Knopf.
 *
 * Hier stehen beide Haelften des Fixes:
 *   1. der Deckel ueber dem GANZEN Scan (`SCAN_DEADLINE_MS`),
 *   2. der Schritt hat waehrend des Scans einen Knopf.
 *
 * Lauf: npx vitest run src/components/onboarding/__tests__/der-scan-haengt-nicht-mehr.test.tsx
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement } from 'react'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'

/** Die Nachfrage nach LM Studio: hier die Tuer, die annimmt und nie antwortet. */
let lmstudioAntwort: () => void = () => {}
const backendCall = vi.fn(
  () => new Promise((resolve) => { lmstudioAntwort = () => resolve({ lms_present: false, running: false }) }),
)

vi.mock('../../../api/backend', () => ({
  backendCall: (...args: unknown[]) => backendCall(...(args as [])),
  isTauri: () => true,
  isMacOS: () => false,
  openExternal: vi.fn(),
}))

/** Der Klopfteil ist in diesem Test fertig: er findet nichts, und zwar sofort. */
const detectLocalBackends = vi.fn(async () => [])
vi.mock('../../../lib/backend-detector', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/backend-detector')>('../../../lib/backend-detector')
  return { ...actual, detectLocalBackends: () => detectLocalBackends() }
})

vi.mock('../onboarding-host', () => ({ isTauri: true }))

const { useBackendScan, SCAN_DEADLINE_MS } = await import('../use-backend-scan')
const { BackendsStep } = await import('../BackendsStep')
const { onboardingSkin } = await import('../onboarding-skin')
const { PROBE_TARGETS } = await import('../../../lib/backend-detector')

/**
 * Ein Wirt, der genau das tut, was der Assistent tut: Scan starten, Schritt
 * zeichnen. Die Installer-Flotte wird nicht gebraucht und darf deshalb eine
 * ruhige Attrappe sein.
 */
const LEERE_FLOTTE = {
  ollama: { phase: 'idle' }, lmstudio: { phase: 'idle' },
  comfyInstall: { phase: 'idle' }, pythonInstall: { phase: 'idle' },
  ollamaDo: () => {}, lmstudioDo: () => {}, comfyInstallDo: () => {}, pythonInstallDo: () => {},
  secondsOf: () => 0,
}

function Wirt() {
  const scan = useBackendScan()
  return createElement('div', null,
    createElement('button', { onClick: () => { void scan.runDetection() } }, 'los'),
    createElement('span', { 'data-testid': 'detecting' }, String(scan.detecting)),
    createElement(BackendsStep, {
      skin: onboardingSkin(true),
      scan,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fleet: LEERE_FLOTTE as any,
      setStep: () => {},
      nextStepAfterBackends: () => 'models' as const,
      selectBackendAndContinue: () => {},
    }),
  )
}

const scanLaeuft = () => screen.getByTestId('detecting').textContent === 'true'

beforeEach(() => {
  vi.useFakeTimers()
  backendCall.mockClear()
  detectLocalBackends.mockClear()
})
afterEach(() => {
  lmstudioAntwort()
  vi.useRealTimers()
  cleanup()
})

describe('Fund 1a: der Scan haengt nicht mehr, wenn Rust schweigt', () => {
  it('nach dem Deckel geht der Assistent weiter, auch wenn die Nachfrage nie antwortet', async () => {
    render(createElement(Wirt))
    await act(async () => { fireEvent.click(screen.getByText('los')) })
    // Die Tuer, die annimmt und schweigt: der Aufruf steht, aber er antwortet nicht.
    expect(backendCall).toHaveBeenCalledWith('lmstudio_server_status')
    expect(scanLaeuft()).toBe(true)

    // Kurz vor dem Deckel steht der Assistent noch, das ist die Positivkontrolle:
    // der Test kann den haengenden Zustand ueberhaupt sehen.
    await act(async () => { await vi.advanceTimersByTimeAsync(SCAN_DEADLINE_MS - 500) })
    expect(scanLaeuft()).toBe(true)

    // Und nach dem Deckel geht es weiter, ohne dass Rust je geantwortet haette.
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(scanLaeuft()).toBe(false)
    expect(screen.getByText('Ready to chat')).toBeTruthy()
  })

  it('antwortet die Nachfrage rechtzeitig, wartet niemand auf den Deckel', async () => {
    render(createElement(Wirt))
    await act(async () => { fireEvent.click(screen.getByText('los')) })
    expect(scanLaeuft()).toBe(true)
    await act(async () => { lmstudioAntwort(); await vi.advanceTimersByTimeAsync(0) })
    expect(scanLaeuft()).toBe(false)
  })

  it('der Deckel ist gerechnet, nicht geraten: er liegt ueber den 2500 ms der Sonden', () => {
    expect(SCAN_DEADLINE_MS).toBeGreaterThan(2500)
    expect(SCAN_DEADLINE_MS).toBe(6000)
  })
})

describe('Fund 1b: der Schritt bleibt nie ohne Knopf', () => {
  it('waehrend des Scans steht ein Knopf da, und er beendet das Warten', async () => {
    render(createElement(Wirt))
    await act(async () => { fireEvent.click(screen.getByText('los')) })
    expect(scanLaeuft()).toBe(true)

    // Genau die Messung von T2, nur von innen: alle Knoepfe des Schritts.
    const knoepfe = Array.from(document.querySelectorAll('button')).filter((b) => b.textContent !== 'los')
    expect(knoepfe.length).toBeGreaterThan(0)

    const weiter = screen.getByText('Continue without scanning')
    await act(async () => { fireEvent.click(weiter) })
    expect(scanLaeuft()).toBe(false)
    expect(screen.getByText('Ready to chat')).toBeTruthy()
  })

  it('der Satz waehrend des Scans zaehlt die Sonden, die es wirklich gibt', async () => {
    render(createElement(Wirt))
    await act(async () => { fireEvent.click(screen.getByText('los')) })
    expect(
      screen.getByText(`Checking ${PROBE_TARGETS.length} backends on their default ports.`),
    ).toBeTruthy()
    // Gegenkontrolle: die 12 aus der Hilfeliste des Schritts sind NICHT die
    // Zahl der Sonden, und die eingebaute Maschine auf 8127 ist der Beweis.
    expect(PROBE_TARGETS.length).not.toBe(12)
    expect(PROBE_TARGETS.some((p) => p.baseUrl.includes('8127'))).toBe(true)
  })
})
