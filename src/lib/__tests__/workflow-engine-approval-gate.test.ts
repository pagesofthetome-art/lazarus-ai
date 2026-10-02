/**
 * Nebenbefund, bau/review-wfplay.md Teil B (Schweregrad hoch): die Engine
 * fuehrte Werkzeugschritte bisher direkt ueber `toolRegistry.execute` aus und
 * bot Prompt-Schritten `DEFAULT_PERMISSIONS` an statt des Berechtigungs-
 * Stores, dieselbe Luecke, die AGT-1 in `tool-executor.ts`/`sub-agent.ts`
 * schon einmal geschlossen hat. Dieser Test prueft den Fix: ein Pflicht-Gate
 * im Konstruktor (`approve: ApprovalGate`), gleiche Politik wie im
 * Agenten-Chat.
 *
 * Fuenf Faelle, jeder mit Negativkontrolle gegen den Stand vor diesem Fix
 * (Zahlen im Baubericht, bau/wfgate.md):
 *   (a) ablehnendes Gate: execute laeuft nie.
 *   (b) Prompt-Schritt bietet ein blockiertes Werkzeug nicht an und fuehrt
 *       einen erfundenen Aufruf darauf trotzdem nicht aus.
 *   (c) erlaubendes Gate laesst den Schritt normal laufen.
 *   (d) Stop waehrend einer wartenden Freigabe: kein execute, Spur frei.
 *   (e) Konstruktion ohne Gate wirft.
 *
 * Lauf: npx vitest run src/lib/__tests__/workflow-engine-approval-gate.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../agent-strategy', () => ({
  resolveToolCallingStrategy: vi.fn(),
}))

import { WorkflowEngine } from '../workflow-engine'
import { APPROVE_ALL, type ApprovalGate } from '../../api/agents/tool-executor'
import { buildSubAgentGates } from '../../api/agents/sub-agent'
import { toolRegistry, registerBuiltinTools } from '../../api/mcp'
import { useModelStore } from '../../stores/modelStore'
import { usePermissionStore } from '../../stores/permissionStore'
import { useGenerationStore } from '../../stores/generationStore'
import { localLaneHolder, __resetRunLanesForTests } from '../run-lanes'
import { resolveToolCallingStrategy } from '../agent-strategy'
import type { AgentWorkflow, WorkflowStep, WorkflowEngineCallbacks } from '../../types/agent-workflows'
import type { AgentRunContext } from '../../api/agent-context'

/** No prefix means Ollama, and Ollama defaults to this machine in tests
 *  (`isOllamaLocal()` with no configured base), so this resolves LOCAL. */
const LOCAL_MODEL = 'qwen3:8b'
const CLOUD_MODEL = 'anthropic::claude'

function workflowOf(steps: WorkflowStep[]): AgentWorkflow {
  return { id: 'wf', name: 'test', description: '', icon: 'Zap', steps, variables: {}, isBuiltIn: false, createdAt: 0, updatedAt: 0 }
}

function callbacks(): WorkflowEngineCallbacks {
  return {
    onStepStart: () => {}, onStepComplete: () => {}, onStepError: () => {},
    onWaitingForInput: () => {}, onComplete: () => {}, onError: () => {},
  }
}

async function takte(n = 20): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

beforeEach(() => {
  __resetRunLanesForTests()
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  registerBuiltinTools(toolRegistry)
})

afterEach(() => {
  usePermissionStore.getState().resetToDefaults()
  vi.restoreAllMocks()
})

describe('(a) ein ablehnendes Gate laesst den Werkzeugschritt nie ausfuehren', () => {
  it('toolRegistry.execute wird nie gerufen, der Schritt endet mit einer englischen Meldung', async () => {
    useModelStore.setState({ activeModel: CLOUD_MODEL })
    const execSpy = vi.spyOn(toolRegistry, 'execute')
    const rejectAll: ApprovalGate = async () => false

    const workflow = workflowOf([
      { id: 'call', type: 'tool', label: 'call', toolName: 'shell_execute', toolArgs: { command: 'echo hi' } },
    ])
    const engine = new WorkflowEngine(workflow, 'conv-a', callbacks(), rejectAll)
    const results = await engine.run()

    expect(execSpy).not.toHaveBeenCalled()
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('failed')
    expect(results[0].error).toMatch(/rejected/i)
    expect(results[0].error).toMatch(/not approved/i)
  })
})

describe('(b) ein Prompt-Schritt bietet nur, was der Store erlaubt, und fuehrt einen erfundenen verbotenen Aufruf nicht aus', () => {
  it('shell_execute (Kategorie terminal, blockiert) fehlt im Angebot UND ein erfundener Aufruf darauf laeuft nicht', async () => {
    useModelStore.setState({ activeModel: CLOUD_MODEL })
    usePermissionStore.getState().setGlobalPermission('terminal', 'blocked')

    let offeredNames: string[] = []
    const chatWithTools = vi.fn(async (_model: string, _messages: unknown, tools: Array<{ function: { name: string } }>) => {
      offeredNames = tools.map((t) => t.function.name)
      // The model hallucinates a call to a tool that was never offered.
      return {
        content: '',
        toolCalls: [{ id: '1', function: { name: 'shell_execute', arguments: { command: 'rm -rf /' } } }],
      }
    })
    vi.mocked(resolveToolCallingStrategy).mockResolvedValue({
      strategy: 'native',
      modelToUse: 'claude',
      modelId: 'claude',
      providerId: 'anthropic',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      provider: { chatWithTools, chatStream: vi.fn() } as any,
    })

    const execSpy = vi.spyOn(toolRegistry, 'execute')
    // The real gate, resolved from the SAME store the offering just read:
    // 'terminal' is 'blocked', so this refuses without ever queuing.
    const gates = await buildSubAgentGates({
      token: 'wf', chatId: null, conversationId: 'conv-b', workspace: null,
      artifactMode: false, readOnlyShellTurn: false, mode: null, artifacts: [],
    } as AgentRunContext)

    const workflow = workflowOf([{ id: 'p', type: 'prompt', label: 'p', prompt: 'go' }])
    const engine = new WorkflowEngine(workflow, 'conv-b', callbacks(), gates.awaitApproval)
    const results = await engine.run()

    expect(offeredNames).not.toContain('shell_execute')
    expect(execSpy).not.toHaveBeenCalled()
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('failed')
  })
})

describe('(c) ein erlaubendes Gate laesst den Werkzeugschritt normal laufen', () => {
  it('APPROVE_ALL fuehrt zu einem completed-Schritt und einem echten execute-Aufruf', async () => {
    useModelStore.setState({ activeModel: CLOUD_MODEL })
    const execSpy = vi.spyOn(toolRegistry, 'execute').mockResolvedValue('ok-result')

    const workflow = workflowOf([
      { id: 'call', type: 'tool', label: 'call', toolName: 'shell_execute', toolArgs: { command: 'echo hi' } },
    ])
    const engine = new WorkflowEngine(workflow, 'conv-c', callbacks(), APPROVE_ALL)
    const results = await engine.run()

    expect(execSpy).toHaveBeenCalledTimes(1)
    expect(execSpy).toHaveBeenCalledWith('shell_execute', { command: 'echo hi' }, 1, undefined)
    expect(results[0].status).toBe('completed')
    expect(results[0].output).toBe('ok-result')
  })
})

describe('(d) Stop waehrend einer wartenden Freigabe fuehrt nie aus und gibt die Spur frei', () => {
  it('ein Gate, das nie von selbst aufloest: cancel() beantwortet es mit false, execute laeuft nie, die lokale Spur ist danach leer', async () => {
    useModelStore.setState({ activeModel: LOCAL_MODEL })
    const execSpy = vi.spyOn(toolRegistry, 'execute')
    // A real pending approval (a queued "Requesting approval" card the user
    // never clicks) never resolves on its own either.
    const neverResolves: ApprovalGate = () => new Promise<boolean>(() => {})

    const workflow = workflowOf([
      { id: 'call', type: 'tool', label: 'call', toolName: 'shell_execute', toolArgs: { command: 'echo hi' } },
    ])
    const engine = new WorkflowEngine(workflow, 'conv-d', callbacks(), neverResolves)
    const laufend = engine.run()
    await takte(5)

    // The run is genuinely holding the local lane while it awaits approval.
    expect(localLaneHolder()).toBe('conv-d')

    // Stop.
    engine.cancel()
    const results = await laufend

    expect(execSpy).not.toHaveBeenCalled()
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('failed')
    expect(localLaneHolder()).toBeNull()
  })
})

describe('(e) Konstruktion ohne Gate ist ein Typfehler und wirft', () => {
  it('new WorkflowEngine ohne approve wirft statt still zu klaffen', () => {
    const workflow = workflowOf([])
    expect(() => {
      // @ts-expect-error approve is required; a caller that omits it must not
      // type-check, and this run-time check is the defense behind that.
      return new WorkflowEngine(workflow, 'conv-e', callbacks())
    }).toThrow(/approve gate/i)
  })
})
