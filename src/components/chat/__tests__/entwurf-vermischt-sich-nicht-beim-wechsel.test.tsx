/**
 * @vitest-environment jsdom
 *
 * Z2 (3.0.1 Box-Messung, BERICHT.md Zusatzpunkt Z2): ein unversendeter
 * Entwurf verschmolz MITTEN im alten Text mit dem naechsten Getippten -
 * "CLOSE92. Write exactly 400 words about the history of ma" + "CLOSE92b.
 * Write exactly 400 words about the history of maps." + "ps." wurde zu
 * "CLOSE92. Write exactly 400 words about the history of maCLOSE92b. Write
 * exactly 400 words about the history of maps.ps." Kein Anhaengen ans Ende
 * (das waere der einfachere 3.0.0-Befund, box-rot BERICHT-2.md Punkt 96),
 * sondern eine Einfuegung MITTEN in den alten Text - das Muster einer
 * Tastatureingabe, die an der ALTEN Cursorposition eines DOM-Knotens landet,
 * den React eigentlich schon durch einen leeren ersetzt haben sollte.
 *
 * URSACHE: der Gespraechswechsel in ChatInput.tsx raeumt den KONTROLLIERTEN
 * Wert (`setInput('')`, im Render, siehe der-entwurf-wechselt-im-render.
 * test.ts) - aber ohne eigenen `key` behaelt das TEXTFELD selbst denselben
 * DOM-Knoten ueber den Wechsel hinweg, mitsamt seiner eigenen
 * Selektion/Cursorposition. Eine Texteingabe, die der Browser noch gegen
 * DIESEN Knoten in der Warteschlange hat (eine reale Maus-/Tastatureingabe,
 * die kurz vor dem Wechsel begann oder ihn ueberholt), traegt der Browser an
 * die dort gespeicherte Cursorposition ein, bevor Reacts naechster Commit
 * greift - mitten in den alten Text.
 *
 * FIX: `key={conversationId}` auf dem `<textarea>`. Ein Gespraechswechsel
 * erzeugt jetzt einen WIRKLICH neuen DOM-Knoten; der alte (mitsamt seiner
 * Selektion und jeder noch gegen ihn gerichteten Eingabe) existiert danach
 * nicht mehr im Baum.
 *
 * Der zweite Test unten stellt den Wettlauf DETERMINISTISCH nach: er haelt
 * sich den alten DOM-Knoten fest, wechselt das Gespraech, und feuert dann
 * absichtlich noch ein Eingabe-Ereignis gegen genau diesen alten,
 * (mit dem Fix) bereits aus dem Baum entfernten Knoten - die "kuenstlich
 * verzoegerte Eingabe waehrend des Wechsels" aus dem Auftrag, ohne auf einen
 * echten Zeitversatz angewiesen zu sein.
 *
 * Run: npx vitest run src/components/chat/__tests__/entwurf-vermischt-sich-nicht-beim-wechsel.test.tsx
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import { ChatInput } from '../ChatInput'
import { useChatStore } from '../../../stores/chatStore'

const MODEL = 'ollama::qwen3:14b'

function seed(): string {
  return useChatStore.getState().createConversation(MODEL, '')
}

beforeEach(() => {
  useChatStore.setState({ conversations: [], activeConversationId: null })
})
afterEach(() => cleanup())

describe('ein Gespraechswechsel ersetzt das Textfeld statt es nur zu leeren', () => {
  it('der DOM-Knoten des Textfelds ist nach dem Wechsel ein ANDERER (key={conversationId})', () => {
    const convA = seed()
    useChatStore.getState().setActiveConversation(convA)
    render(<ChatInput onSend={() => {}} onStop={() => {}} isGenerating={false} />)

    const nodeA = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(nodeA, { target: { value: 'CLOSE92. Write exactly 400 words about the history of maps.' } })
    expect(nodeA.value).toBe('CLOSE92. Write exactly 400 words about the history of maps.')

    const convB = seed()
    act(() => { useChatStore.getState().setActiveConversation(convB) })

    const nodeB = screen.getByRole('textbox') as HTMLTextAreaElement
    // Zahl 1: es ist wirklich ein anderer Knoten, nicht derselbe mit neuem Wert.
    expect(nodeB).not.toBe(nodeA)
    // Zahl 2: der neue Knoten ist leer.
    expect(nodeB.value).toBe('')
  })

  it('WETTLAUF (deterministisch nachgestellt): eine Eingabe, die noch gegen den ALTEN Knoten unterwegs war, mischt sich nicht in den neuen Entwurf', () => {
    const convA = seed()
    useChatStore.getState().setActiveConversation(convA)
    render(<ChatInput onSend={() => {}} onStop={() => {}} isGenerating={false} />)

    const nodeA = screen.getByRole('textbox') as HTMLTextAreaElement
    // Der urspruengliche Entwurf, blockiert/unterbrochen, Cursor mitten im
    // Wort "maps" (nach "ma") stehengeblieben - genau die Box-Messung.
    fireEvent.change(nodeA, { target: { value: 'CLOSE92. Write exactly 400 words about the history of maps.' } })
    nodeA.setSelectionRange(59, 59) // zwischen "...history of ma" und "ps."

    const convB = seed()
    act(() => { useChatStore.getState().setActiveConversation(convB) })

    // Der alte Knoten ist jetzt nicht mehr im Dokument (key-Wechsel hat ihn
    // ersetzt) - aber wir feuern trotzdem noch ein Eingabe-Ereignis GENAU
    // GEGEN IHN, so wie es ein bereits unterwegs gewesenes Tastaturereignis
    // taete, wenn der Browser es noch an den alten Knoten ausliefern wuerde.
    expect(document.body.contains(nodeA)).toBe(false)
    nodeA.value = 'CLOSE92. Write exactly 400 words about the history of maCLOSE92b. Write exactly 400 words about the history of maps.ps.'
    fireEvent.input(nodeA)

    // Der TATSAECHLICH sichtbare Knoten (der neue) bleibt unberuehrt davon.
    const nodeB = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(nodeB.value).toBe('')

    // Und normales Tippen in den neuen Knoten liefert GENAU den getippten
    // Text, keine Vermischung mit dem alten Entwurf.
    fireEvent.change(nodeB, { target: { value: 'CLOSE92b. Write exactly 400 words about the history of maps.ps.' } })
    expect(nodeB.value).toBe('CLOSE92b. Write exactly 400 words about the history of maps.ps.')
    expect(nodeB.value).not.toContain('CLOSE92. Write exactly 400 words about the history of ma' + 'CLOSE92b')
  })

  it('NEGATIVKONTROLLE: der abgelegte Entwurf des alten Gespraechs kommt beim Zurueckwechseln trotzdem unveraendert zurueck', () => {
    // Ohne diese Gegenprobe waere "einfach immer leeren" derselbe Fehler nur
    // teurer (Text weg statt Text falsch) - siehe der lange Kommentar in
    // ChatInput.tsx ueber `entwuerfe`.
    const convA = seed()
    useChatStore.getState().setActiveConversation(convA)
    render(<ChatInput onSend={() => {}} onStop={() => {}} isGenerating={false} />)

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Satz fuer Chat eins' } })

    const convB = seed()
    act(() => { useChatStore.getState().setActiveConversation(convB) })
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('')

    act(() => { useChatStore.getState().setActiveConversation(convA) })
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Satz fuer Chat eins')
  })
})

describe('ein blockierter/abgelehnter Sendeversuch veraendert das Feld nie', () => {
  it('Enter waehrend isGenerating (Feld noch nicht auf Stop umgeschaltet, z. B. ein sehr frueher Tastendruck) sendet nicht und leert nichts', () => {
    const convA = seed()
    useChatStore.getState().setActiveConversation(convA)
    let sent = 0
    render(<ChatInput onSend={() => { sent += 1 }} onStop={() => {}} isGenerating waitingForLocalLane={false} />)

    // isGenerating=true zeigt den Stop-Knopf, keinen Sendeknopf - aber
    // handleKeyDown haengt an der Tastatur, nicht am sichtbaren Knopf, und
    // muss also selbst blocken.
    expect(screen.queryByRole('button', { name: 'Send message' })).toBeNull()
    const box = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'noch nicht abschicken' } })
    fireEvent.keyDown(box, { key: 'Enter' })

    expect(sent).toBe(0)
    expect(box.value).toBe('noch nicht abschicken')
  })

  it('waitingForLocalLane: derselbe Text bleibt unveraendert stehen, kein zweiter Versuch dupliziert ihn', () => {
    const convA = seed()
    useChatStore.getState().setActiveConversation(convA)
    let sent = 0
    render(
      <ChatInput
        onSend={() => { sent += 1 }}
        onStop={() => {}}
        isGenerating
        waitingForLocalLane
      />,
    )
    const box = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'wartet auf die lokale Spur' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    fireEvent.keyDown(box, { key: 'Enter' })

    expect(sent).toBe(0)
    // Genau EINMAL im Feld, nicht verdoppelt ("textCLOSE92text" waere das
    // Symptom einer fehlenden Sperre).
    expect(box.value).toBe('wartet auf die lokale Spur')
  })
})
