/**
 * Nachpruefung G3, 04.09.2026, Build 5, zweimal am echten Windows-Build
 * gemessen: der Satz "Switched your chat provider to the Lazarus Engine for this
 * model." erschien nach 15 bzw. 18 ms, verschwand nach 12,3 s, und wahr wurde
 * er erst nach 16,4 bzw. 16,8 s. Er war also rund vier Sekunden VOR seiner
 * eigenen Wahrheit weg.
 *
 * Derselbe Fehler war auf dem anderen Weg (zurueck zu LM Studio) schon einmal
 * gefixt worden, mit `holdWhile` gegen die Wahl im Store. Hier taugt die Wahl
 * nicht als Zeuge: sie steht schon nach Millisekunden, absichtlich, damit die
 * Modelliste beim Steckplatzwechsel nicht auf den Listenkopf zurueckfaellt.
 * Wer hier die Wahrheit kennt, ist der Riegel um den Swap.
 *
 * Lauf: npx vitest run src/api/__tests__/die-wechselzeile-ueberlebt-den-langen-swap.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  announceLazarusEngineSwitch,
  LAZARUS_ENGINE_SWITCH_NOTE,
  CHAT_PROVIDER_SWITCH_HOLD_MS,
} from '../lazarus-engine-switch'
import { useLazarusEngineSwitchStore, LAZARUS_ENGINE_SWITCH_NOTE_MS } from '../../stores/lazarusEngineSwitchStore'
import { tryAcquireLazarusEngineSwap, releaseLazarusEngineSwap, lazarusEngineSwapInFlight } from '../lazarus-engine-swap-lock'

/** So lange braucht der Swap auf der Box wirklich. */
const SWAP_MS = 16_400

beforeEach(() => {
  vi.useFakeTimers()
  useLazarusEngineSwitchStore.setState({ note: null, tone: 'info' })
  if (lazarusEngineSwapInFlight()) releaseLazarusEngineSwap()
})

afterEach(() => {
  if (lazarusEngineSwapInFlight()) releaseLazarusEngineSwap()
  vi.useRealTimers()
})

describe('announceLazarusEngineSwitch', () => {
  it('steht noch, wenn der Swap laenger dauert als die gewoehnliche Uhr', () => {
    expect(tryAcquireLazarusEngineSwap()).toBe(true)
    announceLazarusEngineSwitch()
    expect(useLazarusEngineSwitchStore.getState().note).toBe(LAZARUS_ENGINE_SWITCH_NOTE)

    // Genau der Moment, in dem die Zeile frueher verschwand.
    vi.advanceTimersByTime(LAZARUS_ENGINE_SWITCH_NOTE_MS + 500)
    expect(useLazarusEngineSwitchStore.getState().note).toBe(LAZARUS_ENGINE_SWITCH_NOTE)

    // Und bis der Swap wirklich durch ist.
    vi.advanceTimersByTime(SWAP_MS - LAZARUS_ENGINE_SWITCH_NOTE_MS)
    expect(useLazarusEngineSwitchStore.getState().note).toBe(LAZARUS_ENGINE_SWITCH_NOTE)
  })

  it('gibt dem Nutzer NACH dem Wechsel noch Lesezeit', () => {
    expect(tryAcquireLazarusEngineSwap()).toBe(true)
    announceLazarusEngineSwitch()
    vi.advanceTimersByTime(SWAP_MS)
    releaseLazarusEngineSwap()

    // Der Riegel ist weg, jetzt laeuft die gewoehnliche Uhr AB HIER.
    vi.advanceTimersByTime(LAZARUS_ENGINE_SWITCH_NOTE_MS - 1_000)
    expect(useLazarusEngineSwitchStore.getState().note).toBe(LAZARUS_ENGINE_SWITCH_NOTE)
    vi.advanceTimersByTime(2_000)
    expect(useLazarusEngineSwitchStore.getState().note).toBeNull()
  })

  it('bleibt bei einem haengenden Swap nicht ewig stehen', () => {
    expect(tryAcquireLazarusEngineSwap()).toBe(true)
    announceLazarusEngineSwitch()
    // Der Riegel wird nie freigegeben. Nach der Frist raeumt die Zeile trotzdem.
    vi.advanceTimersByTime(CHAT_PROVIDER_SWITCH_HOLD_MS + LAZARUS_ENGINE_SWITCH_NOTE_MS + 2_000)
    expect(useLazarusEngineSwitchStore.getState().note).toBeNull()
  })

  it('ist ohne laufenden Swap eine gewoehnliche Zeile auf der gewoehnlichen Uhr', () => {
    announceLazarusEngineSwitch()
    expect(useLazarusEngineSwitchStore.getState().note).toBe(LAZARUS_ENGINE_SWITCH_NOTE)
    vi.advanceTimersByTime(LAZARUS_ENGINE_SWITCH_NOTE_MS + 1_000)
    expect(useLazarusEngineSwitchStore.getState().note).toBeNull()
  })
})
