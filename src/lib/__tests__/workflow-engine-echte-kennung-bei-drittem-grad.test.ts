/**
 * bau/review-wfgate.md Auflage 2: ein Werkzeugschritt, der `run_workflow`
 * aufruft, hat der ZWEITEN Engine bisher `conversationId: this.conversationId`
 * mitgegeben (builtin-tools.ts's `executeRunWorkflow` bucht IMMER unter der
 * erfundenen Kennung `'tool-execution'`, egal wie tief verschachtelt). Ruft
 * DIESE zweite Engine ihrerseits `run_workflow` (DRITTER Grad), bekam die
 * DRITTE Engine also `'tool-execution'` als "echte Unterhaltung" vorgesetzt,
 * eine Kennung, die kein Fenster je anzeigt.
 *
 * Aufbau: eine echte Unterhaltung 'real-conv' ruft `run_workflow('level-b')`
 * auf. `level-b`s einziger Schritt ruft selbst `run_workflow('level-c')`.
 * `level-c`s einziger Schritt ist ein `shell_execute` mit Kategorie
 * 'confirm'. Die Frage dazu muss unter 'real-conv' liegen, NIE unter
 * 'tool-execution', sonst kann sie niemand beantworten (headApproval liest
 * nur `activeConversationId`).
 *
 * Lauf: npx vitest run src/lib/__tests__/workflow-engine-echte-kennung-bei-drittem-grad.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { toolRegistry, registerBuiltinTools } from '../../api/mcp'
import { useAgentWorkflowStore } from '../../stores/agentWorkflowStore'
import { usePermissionStore } from '../../stores/permissionStore'
import { useModelStore } from '../../stores/modelStore'
import { headApproval, dequeueApproval, resetApprovals } from '../approval-queue'
import type { AgentWorkflow, WorkflowStep } from '../../types/agent-workflows'
import type { AgentRunContext } from '../../api/agent-context'

function workflowOf(id: string, name: string, steps: WorkflowStep[]): AgentWorkflow {
  return { id, name, description: '', icon: 'Zap', steps, variables: {}, isBuiltIn: false, createdAt: 0, updatedAt: 0 }
}

beforeEach(() => {
  registerBuiltinTools(toolRegistry)
  resetApprovals()
  // Cloud lane: nested run_workflow calls at every level book under the SAME
  // lane-booking string ('tool-execution', unchanged scope of this fix), so
  // a local model would need the ride-along mechanism this test does not
  // exercise. Cloud bookings do not serialize against each other at all.
  useModelStore.setState({ activeModel: 'anthropic::claude' })

  const levelC = workflowOf('id-c', 'level-c', [
    { id: 'shell', type: 'tool', label: 'shell', toolName: 'shell_execute', toolArgs: { command: 'echo hi' } },
  ])
  const levelB = workflowOf('id-b', 'level-b', [
    { id: 'call-c', type: 'tool', label: 'call-c', toolName: 'run_workflow', toolArgs: { name: 'level-c' } },
  ])
  useAgentWorkflowStore.setState({ workflows: [levelB, levelC] })
  usePermissionStore.getState().setGlobalPermission('workflow', 'auto')
  usePermissionStore.getState().setGlobalPermission('terminal', 'confirm')
})

afterEach(() => {
  usePermissionStore.getState().resetToDefaults()
  vi.restoreAllMocks()
})

describe('dritter Verschachtelungsgrad reicht die ECHTE Unterhaltung durch, nicht die Buchungskennung', () => {
  it('die Freigabefrage von level-c liegt unter real-conv, nicht unter tool-execution', async () => {
    const run: AgentRunContext = {
      token: 'wf-real', chatId: null, conversationId: 'real-conv', workspace: null,
      artifactMode: false, readOnlyShellTurn: false, mode: null, artifacts: [],
    }

    const outputPromise = toolRegistry.execute('run_workflow', { name: 'level-b' }, 1, run)

    // Let the two nested engines run until the shell_execute step parks its
    // approval.
    for (let i = 0; i < 200 && !headApproval('real-conv'); i++) await Promise.resolve()

    expect(headApproval('real-conv')).not.toBeNull()
    expect(headApproval('real-conv')!.toolName).toBe('shell_execute')
    // NEGATIVKONTROLLE (was Auflage 2 describes as the pre-fix behaviour):
    // the entry must NOT be sitting under the internal lane-booking string,
    // which no window ever reads.
    expect(headApproval('tool-execution')).toBeNull()

    dequeueApproval('real-conv')?.resolve(true)
    const output = await outputPromise

    // The approval itself is what this test is about, not whatever the real
    // shell_execute backend call does in a test environment with no server
    // behind it (it errors on the network call, a separate, expected
    // failure): the point is that resolving the REAL conversation's approval
    // actually reached this step, so it must NOT still be the rejection this
    // test's own sibling checks for below.
    expect(output).not.toMatch(/not approved|rejected/i)
  })

  it('NEGATIVKONTROLLE: eine Ablehnung unter real-conv erreicht auch tatsaechlich level-c, level-b meldet den Fehler', async () => {
    const run: AgentRunContext = {
      token: 'wf-real-2', chatId: null, conversationId: 'real-conv-2', workspace: null,
      artifactMode: false, readOnlyShellTurn: false, mode: null, artifacts: [],
    }

    const outputPromise = toolRegistry.execute('run_workflow', { name: 'level-b' }, 1, run)
    for (let i = 0; i < 200 && !headApproval('real-conv-2'); i++) await Promise.resolve()

    dequeueApproval('real-conv-2')?.resolve(false)
    const output = await outputPromise

    expect(output).toMatch(/Workflow stopped at step/)
    expect(output).toMatch(/not approved|rejected/i)
  })
})
