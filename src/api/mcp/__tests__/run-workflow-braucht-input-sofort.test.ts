/**
 * bau/review-wfgate.md Runde 2, klein 2: `run_workflow` on a workflow whose
 * FIRST `user_input` step gets no `input` argument used to hang forever
 * (nothing wires `provideUserInput`), holding whatever lane it booked.
 * `executeRunWorkflow` (builtin-tools.ts) now refuses immediately, with a
 * message the model can act on, and honors `input` exactly as before when
 * it IS given.
 *
 * Run: npx vitest run src/api/mcp/__tests__/run-workflow-braucht-input-sofort.test.ts
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { toolRegistry, registerBuiltinTools } from '../index'
import { useAgentWorkflowStore } from '../../../stores/agentWorkflowStore'
import { useModelStore } from '../../../stores/modelStore'
import type { AgentWorkflow, WorkflowStep } from '../../../types/agent-workflows'

function workflowOf(id: string, name: string, steps: WorkflowStep[]): AgentWorkflow {
  return { id, name, description: '', icon: 'Zap', steps, variables: {}, isBuiltIn: false, createdAt: 0, updatedAt: 0 }
}

beforeEach(() => {
  registerBuiltinTools(toolRegistry)
  useModelStore.setState({ activeModel: 'anthropic::claude' })
  const asksFirst = workflowOf('id-ask', 'Asks First', [
    { id: 's1', type: 'user_input', label: 'Ask', userInputPrompt: 'What topic?' },
    { id: 's2', type: 'memory_save', label: 'Save', memorySave: { type: 'reference', titleTemplate: '{{user_input}}', contentTemplate: '{{user_input}}', tags: [] } },
  ])
  const noAsk = workflowOf('id-noask', 'No Ask', [
    { id: 's1', type: 'memory_save', label: 'Save', memorySave: { type: 'reference', titleTemplate: 'x', contentTemplate: 'y', tags: [] } },
  ])
  useAgentWorkflowStore.setState({ workflows: [asksFirst, noAsk] })
})

describe('ein Ablauf mit user_input-Schritt ohne input: sofortiger Fehler statt Haengen', () => {
  it('run_workflow({ name }) ohne input liefert einen englischen Fehler, kein Haengen', async () => {
    const output = await toolRegistry.execute('run_workflow', { name: 'Asks First' })

    expect(output).toMatch(/^Error:/)
    expect(output).toMatch(/What topic\?/)
    expect(output).toMatch(/input/i)
  })

  it('NEGATIVKONTROLLE: mit input laeuft derselbe Ablauf ganz normal durch', async () => {
    const output = await toolRegistry.execute('run_workflow', { name: 'Asks First', input: 'quantum computing' })

    expect(output).not.toMatch(/^Error:/)
  })

  it('ein Ablauf ganz ohne user_input-Schritt braucht weiterhin kein input', async () => {
    const output = await toolRegistry.execute('run_workflow', { name: 'No Ask' })

    expect(output).not.toMatch(/^Error:/)
  })
})
