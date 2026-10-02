// @vitest-environment jsdom
/**
 * R5-33: der Import brach stumm ab, wenn sich die Sammlung waehrend des Lesens
 * aenderte.
 *
 * `FileReader.readAsText` ist asynchron. Zwischen dem Klick und dem `onload`
 * kann alles passieren, und der Desktop pruefte dort genau ein Merkmal, die
 * Revisionsnummer der Sammlung, und stieg bei einer Abweichung mit einem
 * nackten `return` aus. Fuer den Nutzer sah das aus wie ein Import, der nichts
 * gefunden hat: er probierte dieselbe Datei noch einmal.
 *
 * Das Web haelt zwei Merkmale fest, die Eintragsliste UND die Nummer, und sagt
 * einen Satz. Beides ist hier nachgezogen. Der zweite Teil zaehlt: die Nummer
 * steigt nur beim Wechsel der ganzen Sammlung, waehrend ein angelegter oder
 * geloeschter Eintrag die Liste aendert und die Nummer stehen laesst.
 *
 * Lauf: npx vitest run src/components/settings/__tests__/der-import-bricht-nicht-stumm-ab.test.tsx
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('../../../api/backend', () => ({
  backendCall: vi.fn(async () => null),
  isTauri: () => false,
  isMacOS: () => false,
  openExternal: vi.fn(),
}))

import { MemorySettings } from '../MemorySettings'
import { useMemoryStore } from '../../../stores/memoryStore'

const EXPORT = [
  '# Memory',
  '',
  '## User',
  '',
  '- **Likes coffee**, black, no sugar *(manual)*',
  '',
].join('\n')

/** Der Knopf oeffnet den Waehler; im Test wird die Datei direkt eingelegt. */
function dateiEinlegen(inhalt: string, name = 'memory.md') {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  expect(input, 'der Dateiwaehler steht im Speicher-Reiter').toBeTruthy()
  const file = new File([inhalt], name, { type: 'text/markdown' })
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  fireEvent.change(input)
}

beforeEach(() => {
  cleanup()
  useMemoryStore.setState({ entries: [], memoryCollectionRevision: 0 })
})
afterEach(() => { cleanup() })

describe('R5-33: der Import sagt, wenn er abbricht', () => {
  it('meldet eine Sammlung, die sich waehrend des Lesens geaendert hat', async () => {
    render(<MemorySettings />)
    dateiEinlegen(EXPORT)

    // Genau die Luecke: das onload steht noch aus, und in diesem Augenblick
    // legt jemand einen Eintrag an. Die Revisionsnummer bleibt, die Liste
    // nicht, und bis 3.0.0 fiel der Import damit durch das eine gepruefte
    // Merkmal hindurch.
    useMemoryStore.getState().addMemory({
      type: 'user', title: 'Dazwischen', description: 'x', content: 'x',
      tags: [], source: 'manual',
    })
    expect(useMemoryStore.getState().memoryCollectionRevision).toBe(0)

    await waitFor(() =>
      expect(screen.getByText('Memory collection changed. Choose the file again.')).toBeTruthy())
    // Und geschrieben hat er nichts: nur der eine Eintrag von eben steht da.
    expect(useMemoryStore.getState().entries).toHaveLength(1)
    expect(useMemoryStore.getState().entries[0].title).toBe('Dazwischen')
  })

  it('ein ungestoerter Import meldet weiter das gewohnte Ergebnis', async () => {
    // Negativkontrolle: ohne Stoerung sagt der Satz, was angekommen ist, und
    // der Abbruchsatz steht nirgends.
    render(<MemorySettings />)
    dateiEinlegen(EXPORT)

    await waitFor(() => expect(useMemoryStore.getState().entries).toHaveLength(1))
    expect(useMemoryStore.getState().entries[0].title).toBe('Likes coffee')
    const text = document.body.textContent ?? ''
    expect(text).not.toContain('Memory collection changed.')
    expect(text).toContain('Imported 1 memory.')
  })
})
