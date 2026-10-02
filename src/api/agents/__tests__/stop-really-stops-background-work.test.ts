/**
 * B1 Nachbesserung 4 (Opus-Review, 3.0.1): der Wirkungsbeweis, der bisher
 * fehlte.
 *
 * Was vorher stand (`run-stop.test.ts`, `sub-agent.test.ts`) war ein
 * Quelltext-Grep und eine Aufrufform-Pruefung, beides wird gruen, wenn
 * `cancelAll` zu einem No-op gemacht wird, solange die Zeile im Quelltext
 * stehenbleibt. Dieser Test laesst stattdessen einen ECHTEN Unteragentenlauf
 * gegen einen gemockten Anbieter mit Schleife laufen (`defaultSubAgentRunner`,
 * nicht der gestubbte `SubAgentRunner` aus den Nachbardateien), loest mitten
 * in einer laufenden Anfrage denselben Griff aus, den der Stop-Knopf selbst
 * benutzt (`useAgentTaskStore.cancelAll` + `lib/run-stop`s `stopRun`), und
 * behauptet danach: kein weiterer `chatWithTools`-Aufruf, auch nach einer
 * Wartezeit; das Signal der zuletzt gestellten Anfrage ist `aborted`; und der
 * Wachposten aus `lib/agent-wake.ts` (`shouldWakeParent`) weigert sich,
 * deswegen den Hauptagenten zu wecken.
 *
 * Negativkontrolle (siehe Commit-Text): die Wettlauf-Sperre in
 * `buildDelegateExecutor` (isRunStopped-Pruefung direkt nach `start(...)`)
 * kurz zurueckgenommen, dieser Test bleibt gruen (die Aufgabe stand zum
 * Stop-Zeitpunkt schon im Store), aber ein eigener Test unten deckt genau die
 * Luecke ab; das `gates.abortSignal`-Threading aus `chatWithTools`
 * zurueckgenommen (den `{ signal: ... }`-Parameter entfernt) macht
 * `'das aktuelle Signal ist nach dem Stop aborted'` rot, weil dann kein
 * Aufruf je ein Signal traegt, das abbricht.
 *
 * Lauf: npx vitest run src/api/agents/__tests__/stop-really-stops-background-work.test.ts
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const chatWithTools = vi.fn()
const toolExecute = vi.fn(async () => 'tool output')

vi.mock('../../../stores/modelStore', () => ({
  useModelStore: { getState: () => ({ activeModel: 'ollama::qwen', models: [] }) },
}))
vi.mock('../../providers', () => ({
  getProviderForModel: () => ({ provider: { chatWithTools }, modelId: 'qwen' }),
}))
vi.mock('../../mcp/tool-registry', () => ({
  toolRegistry: {
    getAll: () => [{
      name: 'shell_execute',
      description: 'run a command',
      inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
      category: 'system',
      source: 'builtin',
    }],
    resolveExecutable: (name: string) => (name === 'shell_execute' ? {} : undefined),
    execute: (...args: unknown[]) => toolExecute(...(args as [])),
    getPermissionLevelWithOverrides: () => 'auto',
  },
}))
vi.mock('../../../stores/permissionStore', () => ({
  usePermissionStore: { getState: () => ({ getEffectivePermissions: () => ({}), perToolOverrides: {} }) },
}))
vi.mock('../../../stores/toolAuditStore', () => ({
  useToolAuditStore: { getState: () => ({ record: () => 'audit-1', complete: vi.fn() }) },
}))
const verlaufsZeilen: Array<{ convId: string; msg: Record<string, unknown> }> = []
vi.mock('../../../stores/chatStore', () => ({
  useChatStore: {
    getState: () => ({
      addMessage: (convId: string, msg: Record<string, unknown>) => { verlaufsZeilen.push({ convId, msg }) },
    }),
  },
}))

import { buildDelegateExecutor, defaultSubAgentRunner, _setDepth } from '../sub-agent'
import { useAgentTaskStore } from '../../../stores/agentTaskStore'
import { stopRun, isRunStopped, __resetRunStopsForTests } from '../../../lib/run-stop'
import { shouldWakeParent } from '../../../lib/agent-wake'
import type { AgentRunContext } from '../../agent-context'

const CONV = 'conv-1'
const makeRun = (over: Partial<AgentRunContext> = {}): AgentRunContext => ({
  token: 'run-test', chatId: null, conversationId: CONV, workspace: null,
  artifactMode: false, readOnlyShellTurn: false, mode: null, artifacts: [], ...over,
})

const tick = () => new Promise((r) => setTimeout(r, 0))
async function warteBis(pruefung: () => boolean, was: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (pruefung()) return
    await tick()
  }
  throw new Error(`Zeitueberschreitung beim Warten auf: ${was}`)
}

/**
 * Ein Anbieter mit einer echten Schleife: jede Antwort traegt einen
 * Werkzeugaufruf, also bricht `defaultSubAgentRunner` nie von selbst ab,
 * nur der Stop kann diese Schleife beenden. Ab dem zweiten Aufruf loest die
 * Implementierung selbst denselben Griff aus, den der Stop-Knopf benutzt,
 * MITTEN in der laufenden Anfrage, genau der Moment, den T4 gemessen hat
 * (ein Aufruf, der schon unterwegs war, als Stop gedrueckt wurde).
 */
function baueSchleifendenAnbieter() {
  let calls = 0
  const gesehenesSignal: AbortSignal[] = []
  chatWithTools.mockImplementation(async (_m: string, _msgs: unknown, _tools: unknown, opts?: { signal?: AbortSignal }) => {
    calls++
    if (opts?.signal) gesehenesSignal.push(opts.signal)
    if (calls === 2) {
      // Stop, mitten in dieser (der zweiten) Anfrage, derselbe Griff, den
      // stopAgent/stopCodex seit der B1-Nachbesserung benutzen.
      useAgentTaskStore.getState().cancelAll(CONV)
      stopRun(CONV)
    }
    return {
      content: '',
      toolCalls: [{ id: `tc${calls}`, function: { name: 'shell_execute', arguments: { command: 'ls' } } }],
    }
  })
  return { callCount: () => calls, letztesSignal: () => gesehenesSignal[gesehenesSignal.length - 1] }
}

beforeEach(() => {
  _setDepth(0)
  useAgentTaskStore.setState({ byConv: {} })
  __resetRunStopsForTests()
  verlaufsZeilen.length = 0
  chatWithTools.mockReset()
  toolExecute.mockReset()
  toolExecute.mockResolvedValue('tool output')
})

describe('Stop mitten in einer laufenden Hintergrundanfrage beendet den Lauf wirklich', () => {
  it('kein weiterer chatWithTools-Aufruf, auch nach einer Wartezeit', async () => {
    const { callCount } = baueSchleifendenAnbieter()
    const exec = buildDelegateExecutor(defaultSubAgentRunner)

    await exec({ goal: 'lange Recherche', context: '', background: true }, makeRun())
    await warteBis(() => callCount() >= 2, 'den zweiten Anbieteraufruf')

    const aufgabe = useAgentTaskStore.getState().forConv(CONV)[0]
    await warteBis(
      () => useAgentTaskStore.getState().get(aufgabe.id)?.status === 'cancelled',
      'den Abbruch der Aufgabe',
    )

    const standNachAbbruch = callCount()
    // Eine grosszuegige Wartezeit, waere die Sperre am Schleifenkopf
    // (`gates.abortSignal?.aborted`) nicht da, liefe die Schleife bis zum
    // Budget weiter und `callCount()` waechse.
    await new Promise((r) => setTimeout(r, 50))
    expect(callCount()).toBe(standNachAbbruch)
    // Und nicht einfach "irgendwann aufgehoert", genau zwei: die erste
    // Anfrage plus die, die schon unterwegs war, als Stop gedrueckt wurde.
    expect(standNachAbbruch).toBe(2)
  })

  it('das Signal der zuletzt gestellten Anfrage ist nach dem Stop aborted', async () => {
    const { letztesSignal } = baueSchleifendenAnbieter()
    const exec = buildDelegateExecutor(defaultSubAgentRunner)

    await exec({ goal: 'lange Recherche', context: '', background: true }, makeRun())
    const aufgabe = useAgentTaskStore.getState().forConv(CONV)[0]
    await warteBis(
      () => useAgentTaskStore.getState().get(aufgabe.id)?.status === 'cancelled',
      'den Abbruch der Aufgabe',
    )

    expect(letztesSignal()).toBeDefined()
    expect(letztesSignal()!.aborted).toBe(true)
  })

  it('shouldWakeParent weigert sich, den Hauptagenten deswegen zu wecken', async () => {
    baueSchleifendenAnbieter()
    const exec = buildDelegateExecutor(defaultSubAgentRunner)

    await exec({ goal: 'lange Recherche', context: '', background: true }, makeRun())
    const aufgabe = useAgentTaskStore.getState().forConv(CONV)[0]
    await warteBis(
      () => useAgentTaskStore.getState().get(aufgabe.id)?.status === 'cancelled',
      'den Abbruch der Aufgabe',
    )

    const entscheidung = shouldWakeParent({
      conversationId: CONV,
      tasks: useAgentTaskStore.getState().forConv(CONV),
      isRunning: false,
      isStopped: isRunStopped(CONV),
      activeModel: 'ollama::qwen',
    })
    expect(entscheidung.wake).toBe(false)
    expect(entscheidung.reason).toBe('user-stopped')
  })
})

describe('Wettlauf: Stop im Startfenster (Opus-Review, Nachbesserung 2)', () => {
  /**
   * Der von Opus gefundene zweite Fall: der Nutzer druecke Stop nicht waehrend
   * eine Anfrage laeuft, sondern GENAU in dem Fenster, in dem die Aufgabe noch
   * gar nicht im Store steht (zwischen `_inFlight++` und `start(...)` liegen
   * zwei `await`s). Das laesst sich von aussen nicht zeitlich treffen, aber
   * die Sperre selbst deckt einen strengeren Fall ab: schon VOR dem ersten
   * `runner()`-Aufruf steht der Stop-Merker. `buildDelegateExecutor` prueft
   * `isRunStopped(convId)` direkt nach `start(...)`, also muss der Anbieter in
   * diesem Fall NIE aufgerufen werden.
   */
  it('ein Stop, der schon vor dem Start feststeht, laesst den Anbieter nie laufen', async () => {
    const { callCount } = baueSchleifendenAnbieter()
    stopRun(CONV)
    const exec = buildDelegateExecutor(defaultSubAgentRunner)

    const out = await exec({ goal: 'zu spaet', context: '', background: true }, makeRun())
    await tick()

    expect(out).toMatch(/cancelled before it started/)
    expect(callCount()).toBe(0)
    const aufgabe = useAgentTaskStore.getState().forConv(CONV)[0]
    expect(aufgabe.status).toBe('cancelled')
  })
})
