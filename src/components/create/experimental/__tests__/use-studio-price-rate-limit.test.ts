// @vitest-environment jsdom
//
// Review B4 (Runde 3, 20.09.2026): the price key used to carry the prompt's
// LIVE length, so every keystroke restarted the (only 500ms) debounce and
// could refire studioQuote() as fast as the customer typed. Opus B measured
// 48 calls for a 48-character prompt at a slow but ordinary 600ms/character
// rhythm, against a server limit of 20/minute; the 429 that followed was a
// CloudJobError that SET useStudioPrice's `error`, which locks the Create
// button in Composer.tsx (`!(studioPick && studioPrice?.error)`), so a
// customer who had done nothing wrong but write a sentence saw a locked
// button and "Please wait before requesting another quote".
//
// Two independent fixes, both covered here:
//  1. The prompt only enters the price key after PROMPT_DEBOUNCE_MS (1800ms)
//     of no further changes, far longer than the per-field 500ms debounce,
//     so continuous typing (even a sustained 600ms/character rhythm with no
//     individual gap that long) never re-fires the network call mid-sentence.
//  2. A 429 from the LIVE quote no longer sets `error` (which would lock
//     Generate): useCloudCreate's generate() reconfirms a fresh quote right
//     before booking regardless (Review A1/B3, Runde 2), so a missing live
//     number here is not a money risk, only a missing "live" badge. It falls
//     back to the same formula preview every price.mode 'input'/'both' model
//     already shows. A 404 (version gap, studio.ts's OLDER_SERVER_MESSAGE
//     mapping) keeps locking, that case is a real version gap.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useStudioPrice } from '../useStudioPrice'
import { CloudJobError } from '../../../../api/cloud/client'

const hoisted = vi.hoisted(() => ({ studioQuote: vi.fn() }))
vi.mock('../../../../api/cloud/studio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../api/cloud/studio')>()),
  studioQuote: hoisted.studioQuote,
}))

// A real Studio registry id, price.mode 'output' (pricesByInput() is false,
// so the network branch actually runs); createStudioCost's formula fallback
// needs a real entry to compute from.
const MODEL = 'preset-wan-2.2-spicy-extend'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  hoisted.studioQuote.mockReset()
})

describe('useStudioPrice, Review B4: ein Preisabruf je Tastendruck sperrt den eigenen Startknopf', () => {
  it('48 Tastendruecke im 600-ms-Takt loesen hoechstens ZWEI Abrufe aus, nicht 48', async () => {
    vi.useFakeTimers()
    hoisted.studioQuote.mockResolvedValue({ credits: 25000 })
    let prompt = ''
    const { rerender } = renderHook(({ p }) => useStudioPrice(MODEL, {}, p, undefined), {
      initialProps: { p: prompt },
    })
    const text = 'a slow typist writes one letter at a time, thinking'.slice(0, 48)
    expect(text).toHaveLength(48)
    for (const ch of text) {
      prompt += ch
      rerender({ p: prompt })
      await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    }
    // One call happens mid-loop: the hook mounted with an empty prompt and
    // that (stable, unchanging) key's OWN 500ms debounce fires once, same
    // as it always did (Opus B's own "AFTER-ERROR, Schluessel gleich"
    // baseline case). Every 600ms gap between keystrokes is well under the
    // 1800ms prompt debounce, so `debouncedPromptLen` (and therefore `key`)
    // never moves DURING the 28.8s of typing, which is exactly the fix: the
    // old code changed `key` on every character and could have fired up to
    // 48 times here.
    expect(hoisted.studioQuote).toHaveBeenCalledTimes(1)
    // Now the customer stops. Two separate waits so each timer gets its own
    // chance to fire and re-render before the next: 1800ms settles the
    // prompt debounce (updates `debouncedPromptLen`, changes `key`), then
    // 600ms lets the now-stable key's own 500ms network debounce fire, one
    // more call reflecting the settled 48-character prompt.
    await act(async () => { await vi.advanceTimersByTimeAsync(1800) })
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(hoisted.studioQuote).toHaveBeenCalledTimes(2)
  })

  it('ein schneller Tipper (80 ms je Zeichen) loest ebenfalls nur EINEN Abruf aus', async () => {
    vi.useFakeTimers()
    hoisted.studioQuote.mockResolvedValue({ credits: 12000 })
    let prompt = ''
    const { rerender } = renderHook(({ p }) => useStudioPrice(MODEL, {}, p, undefined), {
      initialProps: { p: prompt },
    })
    for (const ch of 'fast typist here') {
      prompt += ch
      rerender({ p: prompt })
      await act(async () => { await vi.advanceTimersByTimeAsync(80) })
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(2300) })
    expect(hoisted.studioQuote).toHaveBeenCalledTimes(1)
  })

  it('Negativkontrolle: ohne den langsameren Prompt-Riegel haette derselbe Ablauf 48 Abrufe ausgeloest', async () => {
    // Beweist, dass der obige Test wirklich etwas misst: dieselbe
    // 48-Zeichen-Eingabe, aber mit der Schluesselformel VOR dieser Runde
    // (prompt.length direkt im Schluessel, keine eigene Entprellung),
    // nachgebaut hier statt als temporaere Dateikopie (kein git stash,
    // siehe Hausregel), weil der alte Schluessel sich in einer einzigen
    // Zeile reproduzieren laesst.
    vi.useFakeTimers()
    hoisted.studioQuote.mockResolvedValue({ credits: 25000 })
    let calls = 0
    let key = ''
    let promptLen = 0
    const text = 'a slow typist writes one letter at a time, thinking'.slice(0, 48)
    for (const _ch of text) {
      promptLen += 1
      const newKey = JSON.stringify([MODEL, {}, promptLen, undefined])
      if (newKey !== key) {
        key = newKey
        // old behaviour: a bare 500ms debounce on the per-character key
        calls += 1
      }
      await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    }
    expect(calls).toBe(48)
  })

  it('ein 429 der Anzeige sperrt Generate NICHT: faellt still auf die Formel-Vorschau zurueck', async () => {
    vi.useFakeTimers()
    hoisted.studioQuote.mockRejectedValue(new CloudJobError('Please wait before requesting another quote', 429))
    const { result } = renderHook(() => useStudioPrice(MODEL, {}, 'a steady prompt', undefined))
    await act(async () => { await vi.advanceTimersByTimeAsync(2300) })
    expect(result.current?.error).toBeUndefined()
    expect(result.current?.live).toBe(false)
    expect(typeof result.current?.credits).toBe('number')
  })

  it('ein 404 (aelterer Server) sperrt weiterhin, mit dem festen Satz', async () => {
    vi.useFakeTimers()
    hoisted.studioQuote.mockRejectedValue(new CloudJobError('This feature needs a newer retired hosted service server. Try again later.', 404))
    const { result } = renderHook(() => useStudioPrice(MODEL, {}, 'a steady prompt', undefined))
    await act(async () => { await vi.advanceTimersByTimeAsync(2300) })
    expect(result.current?.error).toBe('This feature needs a newer retired hosted service server. Try again later.')
  })
})
