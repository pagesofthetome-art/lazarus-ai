/**
 * @vitest-environment jsdom
 *
 * bau/review-wfgate.md, Auflage 3 (Waechter je Aufrufstelle) und Auflage 8
 * (Chat-Ausloeser ohne Abbruchsignal): the "run workflow <name>" chat trigger
 * in useAgentChat.ts is the SECOND caller of `WorkflowEngine` (the first is
 * `run_workflow` itself, guarded in build-workflow-approval-gate.test.ts). A
 * future silent swap of `gates.awaitApproval` for `APPROVE_ALL` here must
 * fail a test, and Stop must actually reach this run (it did not before:
 * no `abortSignal` was built, and the run was never registered so `stopAgent`
 * had nothing to call `.abort()` on).
 *
 * Run: npx vitest run src/hooks/__tests__/workflow-trigger-echtes-gate-und-stop.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../api/cloud/supabase', () => ({
  getAccessToken: async () => 'session-token-abc',
}))
vi.mock('../../api/rag', () => ({
  retrieveContext: async () => ({ context: { chunks: [], query: '', documentIds: [] }, scoredChunks: [] }),
  generateEmbeddings: async () => [[0.1, 0.2]],
}))
vi.mock('../../lib/ttsBridge', () => ({ autoSpeak: () => {} }))
vi.mock('../../api/vram-handoff', () => ({ requestGenerationCancel: () => {} }))
vi.mock('../useMemory', () => ({
  useMemory: () => ({ extractAndSave: async () => {} }),
  extractMemoriesFromPair: async () => {},
}))

import { useAgentChat, __activeAgentRunConvIdsForTests } from '../useAgentChat'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProviderStore } from '../../stores/providerStore'
import { useAgentWorkflowStore } from '../../stores/agentWorkflowStore'
import { usePermissionStore } from '../../stores/permissionStore'
import { useAgentTaskStore } from '../../stores/agentTaskStore'
import { useAgentLoopStore } from '../../stores/agentLoopStore'
import { useGenerationStore } from '../../stores/generationStore'
import { useTodoStore } from '../../stores/todoStore'
import { useToolAuditStore } from '../../stores/toolAuditStore'
import { DEFAULT_SETTINGS } from '../../lib/constants'
import { __resetRunStopsForTests } from '../../lib/run-stop'
import { __resetRunLanesForTests } from '../../lib/run-lanes'
import { toolRegistry, registerBuiltinTools } from '../../api/mcp'
import { headApproval, resetApprovals } from '../../lib/approval-queue'

const MODEL = 'openai::local-builtin-model'
const tick = () => new Promise((r) => setTimeout(r, 0))

function seed(): string {
  const convId = useChatStore.getState().createConversation(MODEL, '')
  useChatStore.getState().setActiveConversation(convId)
  return convId
}

function guardWorkflow() {
  return {
    id: 'guard-wf-chat',
    name: 'Guard Chat Workflow',
    description: '',
    icon: 'Zap',
    steps: [{ id: 's1', type: 'tool' as const, label: 'run it', toolName: 'shell_execute', toolArgs: { command: 'echo hi' } }],
    variables: {},
    isBuiltIn: false,
    createdAt: 0,
    updatedAt: 0,
  }
}

/** bau/review-wfgate.md Runde 2, klein 1: a workflow whose first step
 *  genuinely asks a question, to test the chat trigger's colon syntax and
 *  its up-front refusal when no answer is given at all. */
function guardAskWorkflow() {
  return {
    id: 'guard-wf-ask',
    name: 'Guard Ask Workflow',
    description: '',
    icon: 'Zap',
    steps: [
      { id: 's1', type: 'user_input' as const, label: 'Ask', userInputPrompt: 'What topic?' },
      {
        id: 's2', type: 'memory_save' as const, label: 'Save',
        memorySave: { type: 'reference' as const, titleTemplate: '{{user_input}}', contentTemplate: '{{user_input}}', tags: [] },
      },
    ],
    variables: {},
    isBuiltIn: false,
    createdAt: 0,
    updatedAt: 0,
  }
}

beforeEach(() => {
  registerBuiltinTools(toolRegistry)
  __resetRunStopsForTests()
  __resetRunLanesForTests()
  resetApprovals()
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useAgentTaskStore.setState({ byConv: {} })
  useAgentLoopStore.setState({ loops: {} })
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useTodoStore.setState({ byConversation: {}, updatedAt: {} })
  useToolAuditStore.setState({ entries: {} })
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS, cavemanMode: 'off' },
  })
  useProviderStore.setState((s) => ({
    providers: { ...s.providers, openai: { ...s.providers.openai, enabled: true } },
  }))
  useModelStore.setState({ models: [], activeModel: MODEL })
  useAgentWorkflowStore.setState({ workflows: [guardWorkflow(), guardAskWorkflow()] })
})

afterEach(() => {
  usePermissionStore.getState().resetToDefaults()
  vi.restoreAllMocks()
})

describe('Waechter: der Chat-Ausloeser "run workflow <name>" uebergibt ein ECHTES Gate', () => {
  it('ein blockiertes Werkzeug im Ablauf laeuft nie, auch nicht ueber den Chat-Ausloeser', async () => {
    usePermissionStore.getState().setGlobalPermission('terminal', 'blocked')
    const execSpy = vi.spyOn(toolRegistry, 'execute')

    const { result } = renderHook(() => useAgentChat())
    const convId = seed()

    await act(async () => {
      await result.current.sendAgentMessage('run workflow Guard Chat Workflow')
      await tick()
    })

    expect(execSpy.mock.calls.map((c) => c[0])).not.toContain('shell_execute')
    const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!
    const lastAssistant = [...conv.messages].reverse().find((m) => m.role === 'assistant')!
    expect(lastAssistant.content).toMatch(/Workflow stopped at step/)
  })
})

describe('Auflage 8: Stop erreicht den Chat-ausgeloesten Ablauf', () => {
  it('waehrend einer wartenden Freigabe registriert der Ausloeser den Lauf, und Stop raeumt die Warteschlange ab', async () => {
    usePermissionStore.getState().setGlobalPermission('terminal', 'confirm')

    const { result } = renderHook(() => useAgentChat())
    const convId = seed()

    let sendDone!: Promise<void>
    await act(async () => {
      sendDone = result.current.sendAgentMessage('run workflow Guard Chat Workflow')
      await tick()
      await tick()

      // The run is registered (Auflage 8's fix) and its approval is
      // sitting in the queue under the REAL conversation.
      expect(__activeAgentRunConvIdsForTests()).toContain(convId)
      expect(headApproval(convId)).not.toBeNull()

      result.current.stopAgent(convId)
      await sendDone
      await tick()
    })

    expect(headApproval(convId)).toBeNull()
    expect(__activeAgentRunConvIdsForTests()).not.toContain(convId)
  })
})

describe('klein 1: "run workflow <name>: <input>" beantwortet den ersten user_input-Schritt', () => {
  it('ohne Doppelpunkt-Eingabe wird sauber abgewiesen statt zu haengen', async () => {
    const { result } = renderHook(() => useAgentChat())
    const convId = seed()

    await act(async () => {
      await result.current.sendAgentMessage('run workflow Guard Ask Workflow')
      await tick()
    })

    // NEGATIVKONTROLLE fuer klein 1 selbst: vor dem Fix haette dieser Aufruf
    // die Engine gestartet, die am user_input-Schritt fuer immer wartet
    // (nichts ruft `provideUserInput`), und den Lauf registriert gelassen.
    expect(__activeAgentRunConvIdsForTests()).not.toContain(convId)
    const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!
    const lastAssistant = [...conv.messages].reverse().find((m) => m.role === 'assistant')!
    expect(lastAssistant.content).toMatch(/What topic\?/)
    expect(lastAssistant.content).toMatch(/run workflow Guard Ask Workflow:/)
  })

  it('mit "run workflow X: <eingabe>" beantwortet der Text nach dem Doppelpunkt den ersten Schritt, der Ablauf laeuft durch', async () => {
    const { result } = renderHook(() => useAgentChat())
    const convId = seed()

    await act(async () => {
      await result.current.sendAgentMessage('run workflow Guard Ask Workflow: quantum computing')
      await tick()
      await tick()
    })

    expect(__activeAgentRunConvIdsForTests()).not.toContain(convId)
    const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!
    const lastAssistant = [...conv.messages].reverse().find((m) => m.role === 'assistant')!
    expect(lastAssistant.content).not.toMatch(/What topic\?/)
    expect(lastAssistant.content).toMatch(/Saved to memory: quantum computing/)
  })
})

describe('Nachtrag 1, bau/review-wfgate.md Runde 3: ein Ablaufname MIT Doppelpunkt', () => {
  /** Zwei Ablaeufe, deren Namen sich nur durch den Doppelpunkt-Teil
   *  unterscheiden: "Deploy" (fragt nach der Umgebung) und "Deploy: staging"
   *  (fuehrt direkt ein blockiertes Werkzeug aus). Vor dem Fix waere
   *  "run workflow Deploy: staging" am ERSTEN Doppelpunkt gesplittet worden,
   *  haette Name "Deploy" und Eingabe "staging" ergeben und damit den
   *  falschen (oder bei einem echten Doppelpunkt-Namen: GAR keinen) Ablauf
   *  getroffen. */
  function deployWorkflow() {
    return {
      id: 'guard-wf-deploy',
      name: 'Deploy',
      description: '',
      icon: 'Zap',
      steps: [{ id: 's1', type: 'user_input' as const, label: 'Ask', userInputPrompt: 'Which environment?' }],
      variables: {},
      isBuiltIn: false,
      createdAt: 0,
      updatedAt: 0,
    }
  }
  function deployStagingWorkflow() {
    return {
      id: 'guard-wf-deploy-staging',
      name: 'Deploy: staging',
      description: '',
      icon: 'Zap',
      steps: [{ id: 's1', type: 'tool' as const, label: 'run it', toolName: 'shell_execute', toolArgs: { command: 'echo hi' } }],
      variables: {},
      isBuiltIn: false,
      createdAt: 0,
      updatedAt: 0,
    }
  }

  it('"run workflow Deploy: staging" trifft den Ablauf "Deploy: staging", nicht "Deploy" mit Eingabe "staging"', async () => {
    useAgentWorkflowStore.setState((s) => ({ workflows: [...s.workflows, deployWorkflow(), deployStagingWorkflow()] }))
    usePermissionStore.getState().setGlobalPermission('terminal', 'blocked')
    const execSpy = vi.spyOn(toolRegistry, 'execute')

    const { result } = renderHook(() => useAgentChat())
    const convId = seed()

    await act(async () => {
      await result.current.sendAgentMessage('run workflow Deploy: staging')
      await tick()
    })

    // Negativkontrolle: der falsche Treffer waere "Deploy" mit Eingabe
    // "staging" gewesen, dessen einziger Schritt sofort fertig ist und NIE
    // nach der Umgebung fragt und NIE ein Werkzeug ausfuehrt.
    expect(execSpy.mock.calls.map((c) => c[0])).not.toContain('memory_save')
    const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!
    const lastAssistant = [...conv.messages].reverse().find((m) => m.role === 'assistant')!
    expect(lastAssistant.content).not.toMatch(/Which environment\?/)
    // Positivkontrolle: "Deploy: staging" wurde erkannt und sein blockiertes
    // Werkzeug lief nie, meldet aber den Ablehnungsfehler statt zu haengen.
    expect(execSpy.mock.calls.map((c) => c[0])).not.toContain('shell_execute')
    expect(lastAssistant.content).toMatch(/Workflow stopped at step/)
  })

  it('Negativkontrolle: ohne den passenden Namen "Deploy: staging" im Store faellt der alte Doppelpunkt-Split wieder zum kuerzeren Namen zurueck', async () => {
    useAgentWorkflowStore.setState((s) => ({ workflows: [...s.workflows, deployWorkflow()] }))

    const { result } = renderHook(() => useAgentChat())
    const convId = seed()

    await act(async () => {
      await result.current.sendAgentMessage('run workflow Deploy: staging')
      await tick()
      await tick()
    })

    // Ohne den laengeren Namen im Store greift der Fallback (Split am ersten
    // Doppelpunkt): Name "Deploy", Eingabe "staging" fuellt den einzigen
    // user_input-Schritt vor, der Ablauf laeuft durch statt zu fragen.
    expect(__activeAgentRunConvIdsForTests()).not.toContain(convId)
    const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!
    const lastAssistant = [...conv.messages].reverse().find((m) => m.role === 'assistant')!
    expect(lastAssistant.content).not.toMatch(/Which environment\?/)
  })
})
