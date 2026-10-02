/**
 * @vitest-environment jsdom
 *
 * R2-52: der Scan trug einen Zweig, den nichts erreichen konnte.
 *
 * `use-backend-scan.ts` startet mit `useState<string>(BUILTIN_BACKEND_ID)`, und
 * `lib/onboarding-backend.ts` setzt `BUILTIN_BACKEND_ID = 'builtin'`. Ein nicht
 * leerer String, also war `!selectedBackend` nie wahr, also hat
 * `setSelectedBackend(backends[0].id)` nie gefeuert. Gelesen hat man an der
 * Stelle trotzdem "ein gefundenes Backend wird ausgewaehlt", und genau das tat
 * sie nicht.
 *
 * Zwei Haelften stehen hier: was die Oberflaeche wirklich tut (die eingebaute
 * Maschine bleibt ausgewaehlt, auch wenn der Scan etwas findet), und dass
 * niemand den Wert je auf leer setzt, denn nur dann waere der Zweig wieder
 * erreichbar.
 *
 * Lauf: npx vitest run src/components/onboarding/__tests__/der-tote-zweig-im-backend-scan.test.tsx
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'

const backendCall = vi.fn(async () => ({ lms_present: false, running: false }))
vi.mock('../../../api/backend', () => ({
  backendCall: (...args: unknown[]) => backendCall(...(args as [])),
  isTauri: () => true,
  isMacOS: () => false,
  openExternal: vi.fn(),
}))

/** Der Scan findet etwas. Genau der Fall, fuer den der tote Zweig dastand. */
const gefunden = [
  { id: 'ollama', name: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', models: ['qwen3.8:latest'] },
]
const detectLocalBackends = vi.fn(async () => gefunden)
vi.mock('../../../lib/backend-detector', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/backend-detector')>('../../../lib/backend-detector')
  return { ...actual, detectLocalBackends: () => detectLocalBackends() }
})

vi.mock('../onboarding-host', () => ({ isTauri: true }))

const { useBackendScan } = await import('../use-backend-scan')
const { BUILTIN_BACKEND_ID } = await import('../../../lib/onboarding-backend')

function Wirt() {
  const scan = useBackendScan()
  return createElement('div', null,
    createElement('button', { onClick: () => { void scan.runDetection() } }, 'los'),
    createElement('span', { 'data-testid': 'gewaehlt' }, scan.selectedBackend),
    createElement('span', { 'data-testid': 'gefunden' }, String(scan.detectedBackends.length)),
  )
}

const gewaehlt = () => screen.getByTestId('gewaehlt').textContent

beforeEach(() => { backendCall.mockClear(); detectLocalBackends.mockClear() })
afterEach(() => { cleanup() })

describe('R2-52: der Scan waehlt nichts um', () => {
  it('die eingebaute Maschine bleibt gewaehlt, auch wenn der Scan etwas findet', async () => {
    render(createElement(Wirt))
    expect(gewaehlt()).toBe(BUILTIN_BACKEND_ID)

    await act(async () => { fireEvent.click(screen.getByText('los')) })

    // Positivkontrolle: der Scan hat wirklich etwas gefunden, sonst
    // beweist die Zeile darunter nur, dass nichts passiert ist.
    expect(screen.getByTestId('gefunden').textContent).toBe('1')
    expect(gewaehlt()).toBe(BUILTIN_BACKEND_ID)
  })

  it('und der Anfangswert ist nicht leer, sonst waere der Zweig wieder da', () => {
    expect(BUILTIN_BACKEND_ID).toBeTruthy()
    expect(BUILTIN_BACKEND_ID).toBe('builtin')
  })

  it('kein Aufrufer setzt den Wert je auf leer', () => {
    // Quelltextwaechter: der Zweig ist raus, und er kann nur zurueckkommen,
    // wenn jemand den Wert leer setzt. Vier Setzer gibt es, alle mit Inhalt.
    const hook = readFileSync(resolve(__dirname, '..', 'use-backend-scan.ts'), 'utf8')
    const schritt = readFileSync(resolve(__dirname, '..', 'BackendsStep.tsx'), 'utf8')
    expect(hook).not.toContain('!selectedBackend')
    const setzer = [...schritt.matchAll(/setSelectedBackend\(([^)]*)\)/g)].map((m) => m[1].trim())
    expect(setzer).toEqual(['BUILTIN_BACKEND_ID', 'b.id', "'ollama'", "'lmstudio'"])
  })
})
