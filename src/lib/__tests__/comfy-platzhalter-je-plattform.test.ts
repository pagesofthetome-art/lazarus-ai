/**
 * @vitest-environment jsdom
 *
 * Fund 2 aus T8 (Ubuntu 22.04 und 26.04, AppImage und deb der 3.0.0,
 * 2026-09-11), Nebenfund 2: "Schritt 2 von 4 (Image & Video Generation) zeigt
 * auf Linux als Platzhalter im Eingabefeld `C:\\ComfyUI`."
 *
 * Geprueft wird je Plattform, und zwar ueber dieselbe Quelle, aus der die
 * beiden Bildschirme ihre Plattform holen (`api/backend.ts`): der Platzhalter
 * haengt an `isWindows()`, und `isWindows()` haengt an `navigator`. Deshalb
 * steht hier ein `navigator`, den der Test selbst setzt, und keine Attrappe der
 * Funktion: eine Attrappe wuerde nur beweisen, dass die Attrappe tut, was ihr
 * gesagt wurde.
 *
 * Lauf: npx vitest run src/lib/__tests__/comfy-platzhalter-je-plattform.test.ts
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createElement } from 'react'
import { render, cleanup, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { comfyPathPlaceholder } from '../comfy-path-placeholder'

vi.mock('../../api/backend', async () => {
  const actual = await vi.importActual<typeof import('../../api/backend')>('../../api/backend')
  // Nur der Weg nach Rust ist eine Attrappe. `isWindows` bleibt echt, denn
  // genau diese Funktion ist hier die Behauptung.
  return { ...actual, backendCall: vi.fn(async () => []), isTauri: () => false, openExternal: vi.fn() }
})

const { isWindows } = await import('../../api/backend')
const { ComfyStep } = await import('../../components/onboarding/ComfyStep')
const { onboardingSkin } = await import('../../components/onboarding/onboarding-skin')
const { IDLE_INSTALLER } = await import('../../components/onboarding/installer-state')

/** WebView2, WKWebView, WebKitGTK, so wie sie sich wirklich melden. */
const KISTEN = {
  windows: { platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edge/120.0' },
  mac: { platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15' },
  linux: { platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15' },
}

function alsKiste(k: { platform: string; userAgent: string }) {
  vi.stubGlobal('navigator', k)
}

const LEERE_FLOTTE = {
  ollama: IDLE_INSTALLER, lmstudio: IDLE_INSTALLER,
  comfyInstall: IDLE_INSTALLER, pythonInstall: IDLE_INSTALLER,
  ollamaDo: () => {}, lmstudioDo: () => {}, comfyInstallDo: () => {}, pythonInstallDo: () => {},
  secondsOf: () => 0,
}

async function schrittZeichnen() {
  await act(async () => {
    render(createElement(ComfyStep, {
      skin: onboardingSkin(true),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fleet: LEERE_FLOTTE as any,
      step: 'comfyui' as const,
      setStep: () => {},
    }))
  })
}

/** Der Platzhalter, wie er wirklich im Feld steht. */
const platzhalterImFeld = () =>
  (document.querySelector('input[type="text"]') as HTMLInputElement | null)?.placeholder

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('der ComfyUI-Platzhalter je Plattform', () => {
  it('Windows bekommt den Laufwerkspfad', () => {
    alsKiste(KISTEN.windows)
    expect(isWindows()).toBe(true)
    expect(comfyPathPlaceholder(isWindows())).toBe('C:\\ComfyUI')
  })

  it('Linux bekommt einen Linux-Pfad, nicht C:', () => {
    alsKiste(KISTEN.linux)
    expect(isWindows()).toBe(false)
    expect(comfyPathPlaceholder(isWindows())).toBe('~/ComfyUI')
    expect(comfyPathPlaceholder(isWindows())).not.toContain('C:')
  })

  it('macOS ebenso', () => {
    alsKiste(KISTEN.mac)
    expect(isWindows()).toBe(false)
    expect(comfyPathPlaceholder(isWindows())).toBe('~/ComfyUI')
  })
})

describe('Schritt 2 des Assistenten, gezeichnet', () => {
  /**
   * Das ist die Messung von T8, nur von innen: der Platzhalter, wie er im
   * gerenderten Feld steht, auf einer Linux-Kiste.
   */
  it('auf Linux steht kein Windows-Pfad im Feld', async () => {
    alsKiste(KISTEN.linux)
    await schrittZeichnen()
    expect(platzhalterImFeld()).toBe('~/ComfyUI')
  })

  it('auf Windows steht er weiter da', async () => {
    alsKiste(KISTEN.windows)
    await schrittZeichnen()
    expect(platzhalterImFeld()).toBe('C:\\ComfyUI')
  })

  /**
   * Dasselbe Feld steht ein zweites Mal in Settings > ComfyUI, mit demselben
   * festen Text. Ein Fix nur im Assistenten haette den Linux-Nutzer dort weiter
   * falsch beraten. Hier als Quelltextpruefung, weil `SettingsPage` die ganze
   * Einstellungsflaeche mitbringt und fuer einen Platzhalter kein Fenster
   * hochgezogen werden muss; die Regel selbst ist oben je Plattform gemessen.
   */
  it('und das zweite Feld in den Einstellungen fragt dieselbe Regel', () => {
    const src = readFileSync(
      resolve(__dirname, '../../components/settings/SettingsPage.tsx'), 'utf8',
    )
    expect(src).not.toContain('placeholder="C:')
    expect(src).toContain('placeholder={comfyPathPlaceholder(isWindows())}')
  })
})
