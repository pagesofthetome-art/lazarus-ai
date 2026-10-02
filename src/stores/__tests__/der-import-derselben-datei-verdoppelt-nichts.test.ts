/**
 * Die eigene Exportdatei darf beim Zurueckladen keine zweite Sammlung anlegen.
 *
 * Box-Test T5 vom 11.09.2026, Punkt 4, DURCHGEFALLEN: vier Erinnerungen,
 * Export als `.json` (2630 Bytes, vier Eintraege mit `sensitive` und `scope`),
 * Oberflaeche neu geladen, dieselbe Datei wieder eingelesen. Die App meldete
 * `Imported 4 memories.`, der Zaehler stand auf `8 memories` und `T5-bread`
 * stand zweimal da, obwohl jeder Eintrag seine Kennung mitbrachte.
 *
 * Der Import haengte bis dahin jeden gelesenen Eintrag mit frisch gewuerfelter
 * Kennung hinten an. Jetzt trifft er die Sammlung, die schon da ist: gleiche
 * Kennung oder gleicher Inhalt zaehlt als derselbe Eintrag.
 *
 * Run: npx vitest run src/stores/__tests__/der-import-derselben-datei-verdoppelt-nichts.test.ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useMemoryStore, describeMemoryImport, __setMemoryEmbedFn } from '../memoryStore'
import type { MemoryFile } from '../../types/agent-mode'

const STAND = Date.UTC(2026, 8, 11, 20, 30)

/** Die vier Eintraege der Box, Feld fuer Feld wie in der Exportdatei. */
const VIER: MemoryFile[] = [
  {
    id: '036d5d61-0000-4000-8000-000000000001', type: 'user', title: 'T5-bread',
    description: "The tester's favourite bread is rye.", content: "The tester's favourite bread is rye.",
    tags: [], source: 'manual', sensitive: false, scope: 't5-other',
    createdAt: STAND - 90_000, updatedAt: STAND - 60_000,
  },
  {
    id: '036d5d61-0000-4000-8000-000000000002', type: 'feedback', title: 'Assistant is prone to file issues',
    description: 'Check the repository before opening one.', content: 'Check the repository before opening one.',
    tags: ['github'], source: 'auto:extraction', sensitive: false,
    createdAt: STAND - 80_000, updatedAt: STAND - 80_000,
  },
  {
    id: '036d5d61-0000-4000-8000-000000000003', type: 'project', title: 'Box runs Windows 10',
    description: 'The test machine is a Windows 10 box with 12 GB VRAM.',
    content: 'The test machine is a Windows 10 box with 12 GB VRAM.',
    tags: [], source: 'manual', sensitive: false,
    createdAt: STAND - 70_000, updatedAt: STAND - 70_000,
  },
  {
    id: '036d5d61-0000-4000-8000-000000000004', type: 'user', title: 'T5-secret',
    description: 'Private note that never leaves the machine.',
    content: 'Private note that never leaves the machine.',
    tags: [], source: 'manual', sensitive: true,
    createdAt: STAND - 60_000, updatedAt: STAND - 60_000,
  },
]

function sammlung(eintraege: MemoryFile[] = VIER) {
  useMemoryStore.setState({ entries: eintraege.map((e) => ({ ...e })) })
}

/** Was der Knopf `.json` auf die Platte schreibt. */
function exportdatei(): string {
  return useMemoryStore.getState().exportAsJSON()
}

function titel(): string[] {
  return useMemoryStore.getState().entries.map((e) => e.title)
}

beforeEach(() => {
  __setMemoryEmbedFn(async () => [])
  sammlung([])
})
afterEach(() => __setMemoryEmbedFn())

describe('Export, neu laden, dieselbe Datei importieren', () => {
  it('HAUPTFALL: der Bestand bleibt bei vier, T5-bread steht einmal da', () => {
    sammlung()
    const datei = exportdatei()

    const ergebnis = useMemoryStore.getState().importFromJSON(datei)

    expect(ergebnis).toEqual({ added: 0, updated: 0, alreadyPresent: 4 })
    expect(useMemoryStore.getState().entries).toHaveLength(4)
    expect(titel().filter((t) => t === 'T5-bread')).toHaveLength(1)
  })

  it('HAUPTFALL: die Meldung nennt die Zahlen, die wirklich gelaufen sind', () => {
    sammlung()
    const ergebnis = useMemoryStore.getState().importFromJSON(exportdatei())

    expect(describeMemoryImport(ergebnis)).toBe('Imported 0 new memories, 4 already present.')
  })

  it('die erkannten Eintraege werden nicht angefasst: Kennung, Geburtstag und Stand bleiben', () => {
    sammlung()
    const vorher = useMemoryStore.getState().entries

    useMemoryStore.getState().importFromJSON(exportdatei())

    expect(useMemoryStore.getState().entries).toEqual(vorher)
  })

  it('GEGENPFAD: eine Datei mit einem zusaetzlichen Eintrag legt genau diesen an', () => {
    sammlung()
    const datei = JSON.parse(exportdatei())
    datei.entries.push({
      id: '036d5d61-0000-4000-8000-000000000009', type: 'user', title: 'T5-tea',
      description: "The tester's favourite tea is rooibos.", content: "The tester's favourite tea is rooibos.",
      tags: [], source: 'manual', sensitive: false, createdAt: STAND, updatedAt: STAND,
    })

    const ergebnis = useMemoryStore.getState().importFromJSON(JSON.stringify(datei))

    expect(ergebnis).toEqual({ added: 1, updated: 0, alreadyPresent: 4 })
    expect(useMemoryStore.getState().entries).toHaveLength(5)
    expect(titel()).toContain('T5-tea')
    expect(describeMemoryImport(ergebnis)).toBe('Imported 1 new memory, 4 already present.')
  })

  it('ein geaenderter Eintrag ersetzt seinen alten Stand, statt daneben zu stehen', () => {
    sammlung()
    const datei = JSON.parse(exportdatei())
    datei.entries[0].content = "The tester's favourite bread is sourdough."
    datei.entries[0].description = "The tester's favourite bread is sourdough."

    const ergebnis = useMemoryStore.getState().importFromJSON(JSON.stringify(datei))

    expect(ergebnis).toEqual({ added: 0, updated: 1, alreadyPresent: 3 })
    expect(useMemoryStore.getState().entries).toHaveLength(4)
    const brot = useMemoryStore.getState().entries.filter((e) => e.title === 'T5-bread')
    expect(brot).toHaveLength(1)
    expect(brot[0].id).toBe(VIER[0].id)
    expect(brot[0].content).toBe("The tester's favourite bread is sourdough.")
    expect(brot[0].createdAt).toBe(VIER[0].createdAt)
    expect(describeMemoryImport(ergebnis)).toBe('Imported 0 new memories, 1 updated, 3 already present.')
  })

  it('eine Datei ohne Kennungen wird am Inhalt erkannt', () => {
    // Eine fremde Ausfuhr oder ein von Hand geschriebener Satz traegt keine
    // stabile Kennung. Dann entscheiden Inhalt, Sorte und Projekt.
    sammlung()
    const ohne = JSON.parse(exportdatei())
    for (const e of ohne.entries) delete e.id

    expect(useMemoryStore.getState().importFromJSON(JSON.stringify(ohne)))
      .toEqual({ added: 0, updated: 0, alreadyPresent: 4 })
    expect(useMemoryStore.getState().entries).toHaveLength(4)
  })

  it('dieselbe Erinnerung zweimal in EINER Datei landet einmal', () => {
    sammlung([])
    const doppelt = JSON.stringify([
      { id: 'a', type: 'user', title: 'Doppelt', content: 'Steht zweimal in der Datei.' },
      { id: 'b', type: 'user', title: 'Doppelt', content: 'Steht zweimal in der Datei.' },
    ])

    expect(useMemoryStore.getState().importFromJSON(doppelt)).toEqual({ added: 1, updated: 0, alreadyPresent: 1 })
    expect(useMemoryStore.getState().entries).toHaveLength(1)
  })

  it('derselbe Satz in einem anderen Projekt ist eine andere Erinnerung', () => {
    // Gegenprobe zur Entdopplung: sie darf nicht ueber Projektgrenzen greifen.
    sammlung()
    const fremd = JSON.stringify([{ ...VIER[0], id: 'neu', scope: 'anderes-projekt' }])

    expect(useMemoryStore.getState().importFromJSON(fremd)).toEqual({ added: 1, updated: 0, alreadyPresent: 0 })
    expect(useMemoryStore.getState().entries).toHaveLength(5)
  })

  it('POSITIVKONTROLLE: in eine leere Sammlung kommen alle vier an, mit der alten Meldung', () => {
    sammlung()
    const datei = exportdatei()
    sammlung([])

    const ergebnis = useMemoryStore.getState().importFromJSON(datei)

    expect(ergebnis).toEqual({ added: 4, updated: 0, alreadyPresent: 0 })
    expect(useMemoryStore.getState().entries).toHaveLength(4)
    expect(describeMemoryImport(ergebnis)).toBe('Imported 4 memories.')
  })

  it('auch der Markdown-Export laesst sich zweimal lesen', () => {
    // Ein Knopf liest beide Formate. Markdown traegt keine Kennung, also
    // greift dort dieselbe Regel ueber den Inhalt.
    sammlung()
    const md = useMemoryStore.getState().exportAsMarkdown()
    sammlung([])
    // Markdown traegt weder den sensiblen noch den Projekt-Eintrag, es bleiben zwei.
    expect(useMemoryStore.getState().importFromMarkdown(md).added).toBe(2)

    expect(useMemoryStore.getState().importFromMarkdown(md))
      .toEqual({ added: 0, updated: 0, alreadyPresent: 2 })
    expect(useMemoryStore.getState().entries).toHaveLength(2)
  })
})

describe('die Meldung nach dem Import', () => {
  it('nennt nur die Zahlen, die es gibt', () => {
    expect(describeMemoryImport({ added: 1, updated: 0, alreadyPresent: 0 })).toBe('Imported 1 memory.')
    expect(describeMemoryImport({ added: 0, updated: 0, alreadyPresent: 1 })).toBe('Imported 0 new memories, 1 already present.')
    expect(describeMemoryImport({ added: 2, updated: 1, alreadyPresent: 0 })).toBe('Imported 2 new memories, 1 updated.')
    expect(describeMemoryImport({ added: 0, updated: 4, alreadyPresent: 2 })).toBe('Imported 0 new memories, 4 updated, 2 already present.')
  })
})
