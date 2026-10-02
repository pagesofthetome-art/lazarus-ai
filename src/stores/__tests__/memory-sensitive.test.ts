import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useMemoryStore, __setMemoryEmbedFn } from '../memoryStore'

const embed = vi.fn(async () => [[1, 0]])
beforeEach(() => {
  useMemoryStore.setState({ entries: [] })
  embed.mockClear()
  __setMemoryEmbedFn(embed)
})
afterEach(() => __setMemoryEmbedFn())
const add = () => useMemoryStore.getState().addMemory({
  type: 'user', title: 'Private preference', description: 'Synthetic only',
  content: 'Synthetic private preference', tags: [], source: 'manual', sensitive: true,
})

it('excludes marked entries from sync, async and embedding backfill', async () => {
  add()
  expect(useMemoryStore.getState().getMemoriesForPrompt('private', 8192)).toBe('')
  expect(await useMemoryStore.getState().getMemoriesForPromptAsync('private', 8192)).toBe('')
  await useMemoryStore.getState().ensureMemoryEmbeddings()
  expect(embed).not.toHaveBeenCalled()
})
it('preserves sensitivity through JSON export/import and omits it from Markdown', () => {
  add()
  const json = useMemoryStore.getState().exportAsJSON()
  expect(useMemoryStore.getState().exportAsMarkdown()).not.toContain('Synthetic private')
  useMemoryStore.getState().clearAll()
  expect(useMemoryStore.getState().importFromJSON(json).added).toBe(1)
  expect(useMemoryStore.getState().entries[0].sensitive).toBe(true)
  expect(useMemoryStore.getState().getMemoriesForPrompt('private', 8192)).toBe('')
})
it('lets an explicit user unmark restore eligibility', () => {
  const id = add()
  useMemoryStore.getState().updateMemory(id, { sensitive: false })
  expect(useMemoryStore.getState().getMemoriesForPrompt('private', 8192)).toContain('Synthetic private')
})
it('does not let an automatic resolution modify a protected target', () => {
  const id = add()
  useMemoryStore.getState().applyWriteDecision({ action: 'UPDATE', targetId: id, mergedContent: 'Changed' })
  expect(useMemoryStore.getState().entries[0].content).toBe('Synthetic private preference')
})

/**
 * R2-2: eine Sicherung aus 2.6.9 kennt das Feld `sensitive` nicht. Der
 * Importpfad las es trotzdem als `=== true`, ein fehlendes Feld wurde also zu
 * `false`, und weil `importDigest` die Marke fuehrt, machte gerade sie den
 * Eintrag zum Update. Danach laeuft die Nachbehandlung und bettet die eben
 * entmarkierte Erinnerung frisch ein: sie steht wieder in KI-Anfragen UND in
 * der Vektorsuche.
 */
it('keeps the sensitive mark when the imported file does not know the field', () => {
  add()
  const datei = JSON.parse(useMemoryStore.getState().exportAsJSON())
  // Genau die Form von 2.6.9: das Feld existiert nicht.
  for (const e of datei.entries) delete e.sensitive

  const ergebnis = useMemoryStore.getState().importFromJSON(JSON.stringify(datei))

  expect(ergebnis.updated).toBe(0)
  expect(ergebnis.alreadyPresent).toBe(1)
  expect(useMemoryStore.getState().entries).toHaveLength(1)
  expect(useMemoryStore.getState().entries[0].sensitive).toBe(true)
  expect(useMemoryStore.getState().getMemoriesForPrompt('private', 8192)).toBe('')
})

it('still drops the mark when the file says so, and says how often', () => {
  // Negativkontrolle: eine gewollte Aenderung muss weiter durchkommen, sonst
  // liesse sich eine Marke nie wieder loeschen.
  add()
  const datei = JSON.parse(useMemoryStore.getState().exportAsJSON())
  for (const e of datei.entries) e.sensitive = false

  const ergebnis = useMemoryStore.getState().importFromJSON(JSON.stringify(datei))

  expect(ergebnis.updated).toBe(1)
  expect(ergebnis.unmarkedSensitive).toBe(1)
  expect(useMemoryStore.getState().entries[0].sensitive).toBe(false)
  expect(useMemoryStore.getState().getMemoriesForPrompt('private', 8192)).toContain('Synthetic private')
})

it('names the dropped marks in the sentence the settings page shows', async () => {
  const { describeMemoryImport } = await import('../memoryStore')
  expect(describeMemoryImport({ added: 0, updated: 1, alreadyPresent: 0, unmarkedSensitive: 1 }))
    .toBe('Imported 0 new memories, 1 updated, 1 no longer marked sensitive.')
  // Ohne Vorfall bleibt der Satz wortgleich mit dem des Webs.
  expect(describeMemoryImport({ added: 0, updated: 1, alreadyPresent: 0 }))
    .toBe('Imported 0 new memories, 1 updated.')
})
