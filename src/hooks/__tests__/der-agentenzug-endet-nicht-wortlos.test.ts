/**
 * Ein abgeschnittener Zug endet auch im AGENTEN Reiter nicht mehr wortlos.
 *
 * Fehler D, Symptom 2 wurde am 11.09.2026 fuer den Code Reiter geschlossen
 * (`hooks/codex/__tests__/der-plan-haengt-nicht-bei-schritt-2.test.ts`). Die
 * Schleife des Agenten hatte denselben Fehler und wurde nicht mitgenommen:
 * `useAgentChat.ts` schrieb den Rueckgabetyp seines Transports von Hand ab,
 * und in dieser Abschrift kam `doneReason` nicht vor. Ein Zug, den das Modell
 * in die Token Grenze gefahren hat, kommt OHNE Werkzeugaufruf zurueck, und ein
 * Zug ohne Werkzeugaufruf ist in dieser Schleife der Schlusszug: der Lauf
 * endete, die Antwort blieb, wie sie mitten im Satz aufgehoert hatte, und
 * niemand erfuhr warum. Steht ein Plan offen, bleibt er auf seinem Schritt
 * stehen, genau wie es der Melder fuer den Code Reiter beschrieben hat.
 *
 * Der Grund lag die ganze Zeit auf der Leitung: Ollama schickt ihn als
 * `done_reason: "length"`, jeder andere Transport als `finish_reason`, und
 * `lib/ollama-stream-tools.ts` reicht ihn seit dem Code-Reiter-Fix durch.
 *
 * Lauf: npx vitest run src/hooks/__tests__/der-agentenzug-endet-nicht-wortlos.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

vi.mock('../../api/backend', () => ({
  localFetchStream: vi.fn(),
  ollamaUrl: (path: string) => `http://localhost:11434/api${path}`,
}))

import { streamOllamaChatWithTools } from '../../lib/ollama-stream-tools'
import { localFetchStream } from '../../api/backend'
import { codexCutoffNote } from '../codex/turn-cutoff'
import type { ToolDefinition } from '../../api/providers/types'

const mockStream = localFetchStream as ReturnType<typeof vi.fn>

const TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'search the web',
      parameters: { type: 'object', properties: { q: { type: 'string', description: 'query' } }, required: ['q'] },
    },
  },
]

/** Ein Ollama NDJSON Strom aus fertigen Zeilen. */
function ndjson(...lines: string[]): Response {
  return new Response(lines.join('\n') + '\n', { status: 200 })
}

function callLine(name: string, args: unknown): string {
  return JSON.stringify({ message: { content: '', tool_calls: [{ function: { name, arguments: args } }] }, done: false })
}

function doneLine(reason: string, content = ''): string {
  return JSON.stringify({ message: { content }, done: true, done_reason: reason, eval_count: 40, prompt_eval_count: 700 })
}

/** Ein Zug ueber den echten Transport des Agenten. */
function turn(...lines: string[]) {
  mockStream.mockResolvedValueOnce(ndjson(...lines))
  return streamOllamaChatWithTools(
    'qwen3:8b',
    [{ role: 'user', content: 'research the three options and write them up' }],
    TOOLS,
    { temperature: 0.7 },
    () => {},
    () => {},
  )
}

const AGENT_SRC = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '..', 'useAgentChat.ts'),
  'utf8',
)

beforeEach(() => {
  mockStream.mockReset()
})

describe('ein Zug, den das Modell nie zu Ende schreiben konnte', () => {
  it('der Transport meldet den Abschnitt, statt ihn wegzuwerfen', async () => {
    const t = await turn(
      JSON.stringify({ message: { content: 'Next I will search for' }, done: false }),
      doneLine('length'),
    )
    expect(t.toolCalls, 'ein abgeschnittener Zug hat keinen Werkzeugaufruf').toHaveLength(0)
    expect(t.doneReason).toBe('length')
  })

  it('ein sauberer Schluss bleibt ein sauberer Schluss', async () => {
    const t = await turn(callLine('web_search', { q: 'a' }), doneLine('stop'))
    expect(t.doneReason).toBe('stop')
    expect(codexCutoffNote(t.doneReason, { done: 1, total: 3, next: 'compare the options' })).toBeNull()
  })

  it('der Nutzer liest, warum der Lauf auf seinem Schritt stehenblieb', () => {
    const note = codexCutoffNote('length', { done: 1, total: 3, next: 'compare the options' })
    expect(note, 'ein abgeschnittener Zug endet weiter wortlos').not.toBeNull()
    expect(note).toContain('compare the options')
    expect(note).toContain('1 of 3')
    expect(note).toMatch(/Max Tokens|context/)
  })

  it('ohne offenen Plan sagt derselbe Satz nichts ueber Schritte', () => {
    const note = codexCutoffNote('length', null)
    expect(note).not.toBeNull()
    expect(note).not.toContain('of 3')
    expect(note).not.toMatch(/still open/)
  })
})

describe('die Schleife des Agenten', () => {
  it('schreibt den Satz hin, bevor sie den Lauf beendet', () => {
    // Quelltextrechnung: `sendMessage` steckt in einem `useCallback`, den kein
    // Test von aussen aufruft. Geprueft wird genau die Reihenfolge, an der es
    // haengt: der Satz muss VOR dem `break` des Schlusszuges stehen, sonst
    // endet der Lauf wieder wortlos.
    const schluss = AGENT_SRC.indexOf('if (isFinalTurn) {')
    expect(schluss, 'die Weiche des Schlusszuges ist verschwunden').toBeGreaterThan(0)
    const zweig = AGENT_SRC.slice(schluss)
    const satz = zweig.indexOf('codexCutoffNote')
    expect(satz, 'der abgeschnittene Zug endet wieder wortlos').toBeGreaterThan(0)
    expect(zweig.indexOf('break', satz), 'der Satz steht hinter dem Ende des Laufs').toBeGreaterThan(satz)
  })

  it('liest den Grund aus BEIDEN Transporten', () => {
    expect(AGENT_SRC, 'Ollama liefert den Grund, die Schleife nimmt ihn nicht').toContain('ollamaTurn.doneReason')
    expect(AGENT_SRC, 'die uebrigen Transporte liefern ihn auch').toContain('providerTurn.finishReason')
    // Der Prompt-Transport laeuft ueber denselben Anbieter und kann genauso
    // mitten im Werkzeugaufruf abgeschnitten werden.
    expect(AGENT_SRC, 'der Prompt-Transport wurde vergessen').toContain('hermesTurn.finishReason')
  })

  it('schreibt den Rueckgabetyp seines Transports nicht mehr ab', () => {
    // Die Abschrift ist der eigentliche Fehler: sie kannte `doneReason` nicht,
    // und kein Werkzeug konnte das melden, weil sie fuer sich genommen
    // stimmte. Abgeleitet faellt ein neues Feld nie wieder still weg.
    expect(AGENT_SRC).toContain('Awaited<ReturnType<typeof streamOllamaChatWithTools>>')
    expect(AGENT_SRC).toContain('Awaited<ReturnType<typeof streamProviderTurn>>')
    expect(
      AGENT_SRC,
      'der Rueckgabetyp des Transports steht wieder von Hand abgeschrieben da',
    ).not.toContain('{ content: string; toolCalls: ToolCall[]; thinking?: string;')
  })
})
