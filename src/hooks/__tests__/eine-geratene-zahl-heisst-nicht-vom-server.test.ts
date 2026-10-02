/**
 * R2-5: der Zaehler ueber dem Eingabefeld beschriftete geratene Zahlen mit
 * "from server".
 *
 * `useActiveContextWindow` schrieb fuer jedes ferngesteuerte Modell
 * `source: cloudResolved?.source ?? 'probe'`, und "probe" heisst im
 * Werkzeugtext "from server". Antwortet der Anbieter aber gar nicht, faellt
 * die Zahl auf die KNOWN_CONTEXT-Tabelle dieses Hauses, auf die
 * Namensheuristik oder ganz auf die 4096 aus context-compaction. Der Nutzer
 * las dann eine Schaetzung als Auskunft des Betreibers und stellte seinen
 * Sendedeckel danach.
 *
 * Run: npx vitest run src/hooks/__tests__/eine-geratene-zahl-heisst-nicht-vom-server.test.ts
 */
import { describe, it, expect } from 'vitest'
import { remoteWindowSource } from '../useActiveContextWindow'
import { SOURCE_LABEL } from '../../lib/context-source'

describe('woher die Zahl im Zaehler kommt', () => {
  it('an unanswered provider is a guess, and the tooltip says estimated', () => {
    const source = remoteWindowSource('anthropic', undefined, 200_000)
    expect(source).toBe('guess')
    expect(SOURCE_LABEL[source]).toBe('estimated')
  })

  it('the 4096 fallback of context-compaction is a guess too', () => {
    expect(remoteWindowSource('anthropic', undefined, 4096)).toBe('guess')
    expect(remoteWindowSource('openai', undefined, 4096)).toBe('guess')
  })

  it('NEGATIVKONTROLLE: an answer from the provider keeps whatever it said', () => {
    for (const said of ['probe', 'trained', 'user'] as const) {
      expect(remoteWindowSource('anthropic', said, 128_000)).toBe(said)
      expect(remoteWindowSource('lu-cloud', said, 128_000)).toBe(said)
    }
  })

  it('NEGATIVKONTROLLE: the own catalogue stays an answer, not a guess', () => {
    expect(remoteWindowSource('lu-cloud', undefined, 128_000)).toBe('probe')
    expect(SOURCE_LABEL[remoteWindowSource('lu-cloud', undefined, 128_000)]).toBe('from server')
  })

  it('a catalogue that names no window promises nothing either', () => {
    expect(remoteWindowSource('lu-cloud', undefined, 0)).toBe('guess')
  })
})
