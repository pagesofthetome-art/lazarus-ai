/**
 * Audit M1 — the terminal tool itself now sees Stop.
 *
 * "Stop is the only brake the product offers for an unattended agent with full
 * shell access, and it is ineffective for exactly the case you reach for it."
 * What the tool can promise depends on the phase:
 *
 *   not started yet  → refused; nothing runs.
 *   background task  → really killed, via the bridge's shell_task_kill.
 *   foreground child → killed, via shell_execute_cancel.
 *
 * Die dritte Zeile stand hier bis zur 3.0.0-Runde anders: der Vordergrundfall
 * war NICHT abbrechbar, weil `shell_execute` keine Kennung nahm und es kein
 * `shell_execute_cancel` gab. Der Ausfuehrer hoerte auf zu warten, damit endeten
 * Lauf und Oberflaeche, und der Prozess lief bis zu seiner eigenen Zeitgrenze
 * weiter: bis zu zwei Minuten Build oder Skript auf der Maschine des Nutzers,
 * nachdem er Stop gedrueckt hat. Der alte Kommentar war der Merker dafuer, wo
 * der echte Abbruch hingehoert; jetzt steht er dort, und diese Datei prueft ihn
 * am Verhalten statt am Kommentar.
 *
 * Run: npx vitest run src/api/mcp/__tests__/shell-honours-stop.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const backendCalls: { cmd: string; body: Record<string, unknown> }[] = []

/**
 * Ein `shell_execute`, das haengen bleibt, bis der Test es loslaesst.
 *
 * Ohne das gaebe es kein Fenster, in dem der Befehl LAEUFT — und genau in dem
 * Fenster passiert der Fehler, um den es hier geht. Ein Aufruf, der sofort
 * zurueckkehrt, koennte gar nicht abgebrochen werden und der Test waere gruen,
 * ohne je etwas geprueft zu haben.
 */
let laufenLassen: (() => void) | null = null

/** Same latch as `laufenLassen`, its own so the two tools don't interfere. */
let codeLaufenLassen: (() => void) | null = null

vi.mock('../../backend', () => ({
  backendCall: vi.fn(async (cmd: string, body: Record<string, unknown>) => {
    backendCalls.push({ cmd, body })
    if (cmd === 'shell_execute') {
      if (laufenLassen === null) return { stdout: 'ran', stderr: '', exitCode: 0, timedOut: false }
      await new Promise<void>((r) => { laufenLassen = r })
      return { stdout: '', stderr: 'Cancelled: the user stopped the run.', exitCode: -1, timedOut: false, cancelled: true }
    }
    if (cmd === 'execute_code') {
      if (codeLaufenLassen === null) return { stdout: 'ran', stderr: '', exitCode: 0, timedOut: false }
      await new Promise<void>((r) => { codeLaufenLassen = r })
      return { stdout: '', stderr: 'Cancelled: the user stopped the run.', exitCode: -1, timedOut: false, cancelled: true }
    }
    if (cmd === 'shell_task_start') return { id: 'task-1' }
    if (cmd === 'shell_task_kill') return { ok: true, cancelled: true }
    return { ok: true }
  }),
  fetchExternal: vi.fn(async () => ({ ok: true, status: 200, text: async () => '' })),
}))
vi.mock('../../agents/sub-agent', () => ({
  DELEGATE_TASK_TOOL_DEF: { name: 'delegate_task', description: '', category: 'system', inputSchema: {} },
  buildDelegateExecutor: () => async () => 'stub',
}))
vi.mock('../../../lib/workflow-engine', () => ({ WorkflowEngine: class {} }))

import { registerBuiltinTools } from '../builtin-tools'
import { ToolRegistry } from '../tool-registry'
import type { AgentRunContext } from '../../agent-context'

/** A complete run context — the shape the executors are really handed. */
function makeRun(over: Partial<AgentRunContext> = {}): AgentRunContext {
  return {
    token: 'test-run',
    chatId: null,
    conversationId: null,
    workspace: null,
    artifactMode: false,
    readOnlyShellTurn: false,
    mode: null,
    artifacts: [],
    ...over,
  }
}

const registry = new ToolRegistry()
registerBuiltinTools(registry)

const ran = () => backendCalls.filter((c) => c.cmd === 'shell_execute')
const killed = () => backendCalls.filter((c) => c.cmd === 'shell_task_kill')

const cancelled = () => backendCalls.filter((c) => c.cmd === 'shell_execute_cancel')
const codeRan = () => backendCalls.filter((c) => c.cmd === 'execute_code')
const codeCancelled = () => backendCalls.filter((c) => c.cmd === 'execute_code_cancel')

beforeEach(() => { backendCalls.length = 0; laufenLassen = null; codeLaufenLassen = null })

describe('shell_execute honours the run\'s Stop', () => {
  it('a command that has not started yet does not start', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    const out = await registry.execute(
      'shell_execute',
      { command: 'rm -rf build' },
      1,
      undefined,
      ctrl.signal,
    )
    expect(ran()).toHaveLength(0)
    expect(out).toMatch(/cancelled/i)
  })

  it('reads the signal off the run object too, for a nested sub-agent loop', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    await registry.execute('shell_execute', { command: 'ls' }, 1, makeRun({ abortSignal: ctrl.signal }))
    expect(ran()).toHaveLength(0)
  })

  it('NEGATIVE CONTROL: a live run still runs its command', async () => {
    const ctrl = new AbortController()
    const out = await registry.execute('shell_execute', { command: 'echo hi' }, 1, undefined, ctrl.signal)
    expect(ran()).toHaveLength(1)
    expect(out).toBe('ran')
  })

  it('a BACKGROUND task started by the run is killed when the run is stopped', async () => {
    // The one shell path the bridge can genuinely cancel. Detached by design,
    // but nothing polls it once the run ends — so an unattended build or deploy
    // script would otherwise keep writing to the repo with no owner and no way
    // to reach it from the UI.
    const ctrl = new AbortController()
    const out = await registry.execute(
      'shell_execute',
      { command: 'npm run build', background: true },
      1,
      undefined,
      ctrl.signal,
    )
    expect(out).toContain('Task started: task-1')
    expect(killed()).toHaveLength(0)

    ctrl.abort()
    await new Promise((r) => setTimeout(r, 0))

    expect(killed()).toEqual([{ cmd: 'shell_task_kill', body: { args: { id: 'task-1' } } }])
  })

  it('NEGATIVE CONTROL: a background task on a live run is left alone', async () => {
    const ctrl = new AbortController()
    await registry.execute('shell_execute', { command: 'npm run dev', background: true }, 1, undefined, ctrl.signal)
    await new Promise((r) => setTimeout(r, 0))
    expect(killed()).toHaveLength(0)
  })

  it('ein schon GESTARTETER Vordergrundbefehl wird abgebrochen, nicht nur vergessen', async () => {
    // Der Fall, der bis zur 3.0.0-Runde offen war. Bis zu zwei Minuten Build
    // auf der Maschine des Nutzers, nachdem er Stop gedrueckt hat.
    laufenLassen = () => {}
    const ctrl = new AbortController()
    const lauf = registry.execute('shell_execute', { command: 'npm run build' }, 1, undefined, ctrl.signal)
    await new Promise((r) => setTimeout(r, 0))

    const gestartet = ran()
    expect(gestartet).toHaveLength(1)
    const kennung = (gestartet[0].body as { callId?: string }).callId
    expect(typeof kennung).toBe('string')
    expect(kennung).toBeTruthy()
    expect(cancelled()).toHaveLength(0)

    ctrl.abort()
    await new Promise((r) => setTimeout(r, 0))

    // Dieselbe Kennung: ein Abbruch auf eine andere waere Buchhaltung ohne Wirkung.
    expect(cancelled()).toEqual([{ cmd: 'shell_execute_cancel', body: { callId: kennung } }])

    laufenLassen?.()
    await expect(lauf).resolves.toMatch(/cancelled/i)
  })

  it('NEGATIVE CONTROL: ein Befehl, der durchlaeuft, wird nicht abgebrochen', async () => {
    const ctrl = new AbortController()
    await registry.execute('shell_execute', { command: 'echo hi' }, 1, undefined, ctrl.signal)
    // Der Horcher muss beim Verlassen wieder ab: sonst schluege ein spaeterer
    // Stop auf eine Kennung durch, hinter der laengst kein Prozess mehr steht.
    ctrl.abort()
    await new Promise((r) => setTimeout(r, 0))
    expect(cancelled()).toHaveLength(0)
  })

  it('R2-44: code_execute (retired name, redirected) is also cancelled once started', async () => {
    // `code_execute` has no entry in the registry itself, it only runs via
    // the retired-tool redirect (`runRetiredTool`), which used to drop the
    // signal `execute()` had already resolved from run/signal.
    codeLaufenLassen = () => {}
    const ctrl = new AbortController()
    const lauf = registry.execute('code_execute', { code: 'print(1)' }, 1, undefined, ctrl.signal)
    await new Promise((r) => setTimeout(r, 0))

    const gestartet = codeRan()
    expect(gestartet).toHaveLength(1)
    const kennung = (gestartet[0].body as { callId?: string }).callId
    expect(typeof kennung).toBe('string')
    expect(kennung).toBeTruthy()
    expect(codeCancelled()).toHaveLength(0)

    ctrl.abort()
    await new Promise((r) => setTimeout(r, 0))

    expect(codeCancelled()).toEqual([{ cmd: 'execute_code_cancel', body: { callId: kennung } }])

    codeLaufenLassen?.()
    await expect(lauf).resolves.toMatch(/cancelled/i)
  })

  it('NEGATIVE CONTROL: a code_execute run that finishes on its own is not cancelled', async () => {
    const ctrl = new AbortController()
    await registry.execute('code_execute', { code: 'print(1)' }, 1, undefined, ctrl.signal)
    ctrl.abort()
    await new Promise((r) => setTimeout(r, 0))
    expect(codeCancelled()).toHaveLength(0)
  })

  it('der Vordergrundpfad schickt seine Kennung wirklich mit', () => {
    // Ohne sie haette die Rust-Seite nichts, worauf ein Abbruch zeigen koennte,
    // und `shell_execute_cancel` waere eine Zeile, die nie etwas findet.
    const here = dirname(fileURLToPath(import.meta.url))
    const src = readFileSync(resolve(here, '../builtin-tools.ts'), 'utf8')
    expect(src).toContain("backendCall('shell_execute_cancel', { callId })")
    expect(src).not.toContain('the bridge has NO cancel for it')
  })
})
