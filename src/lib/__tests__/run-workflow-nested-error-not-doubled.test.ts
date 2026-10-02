/**
 * R2-5 (lu-301/bau/review-offload2.md, Runde 2, kosmetisch): `run_workflow`'s
 * own tool result needs an "Error:" prefix so an OUTER engine's
 * `executeToolStep` (`startsWith('Error:')`) recognizes a nested workflow
 * failure (see the long comment on `onStepError` in
 * `api/mcp/builtin-tools.ts`, `executeRunWorkflow`). The step's own `error`
 * is often ALREADY a tool's raw "Error: ..." text (a failed `web_search` or
 * `web_fetch`), so prefixing it a second time used to read "Error: Workflow
 * stopped at step 1 of 1: Error: Web search failed: ...". This drives
 * `run_workflow` for real over a workflow whose only step is a failing
 * `web_search`, and checks the returned tool result carries "Error:" exactly
 * once.
 *
 * Run: npx vitest run src/lib/__tests__/run-workflow-nested-error-not-doubled.test.ts
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const backendCall = vi.fn(async (..._args: unknown[]) => ({}))

vi.mock('../../api/backend', async () => {
  const actual = await vi.importActual<typeof import('../../api/backend')>('../../api/backend')
  return { ...actual, backendCall: (...a: unknown[]) => backendCall(...a) }
})

import { toolRegistry, registerBuiltinTools } from '../../api/mcp'
import { useAgentWorkflowStore } from '../../stores/agentWorkflowStore'
import { useModelStore } from '../../stores/modelStore'
import { useGenerationStore } from '../../stores/generationStore'
import { __resetRunLanesForTests } from '../run-lanes'
import type { AgentWorkflow, WorkflowStep } from '../../types/agent-workflows'

function workflowOf(id: string, name: string, steps: WorkflowStep[]): AgentWorkflow {
  return { id, name, description: '', icon: 'Zap', steps, variables: {}, isBuiltIn: false, createdAt: 0, updatedAt: 0 }
}

beforeEach(() => {
  __resetRunLanesForTests()
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useModelStore.setState({ activeModel: 'anthropic::claude' })
  backendCall.mockClear()
  registerBuiltinTools(toolRegistry)
  const inner = workflowOf('inner-fail-id', 'inner-fail', [
    { id: 'search', type: 'tool', label: 'Search the web', toolName: 'web_search', toolArgTemplates: { query: '{{user_input}}' } },
  ])
  useAgentWorkflowStore.setState({ workflows: [inner] })
})

describe('a failing tool step inside a nested run_workflow carries exactly one "Error:"', () => {
  it('the returned tool result is not doubled', async () => {
    backendCall.mockImplementation(async (...args: unknown[]) => {
      const cmd = args[0] as string
      if (cmd === 'web_search') return { error: 'All search tiers failed' }
      throw new Error(`unexpected backendCall: ${cmd}`)
    })

    const output = await toolRegistry.execute('run_workflow', { name: 'inner-fail', input: 'the history of tea' })

    // Still detectable as a failure by an outer engine.
    expect(output.startsWith('Error:')).toBe(true)
    // But the word appears only once now, not doubled.
    expect(output.match(/Error:/g)?.length).toBe(1)
    expect(output).toBe('Error: Workflow stopped at step 1 of 1: Web search failed: All search tiers failed')
  })

  it('Gegenprobe: a working search reports completion with no "Error:" at all', async () => {
    backendCall.mockImplementation(async (...args: unknown[]) => {
      const cmd = args[0] as string
      if (cmd === 'web_search') return { results: [{ title: 'Tea', url: 'https://tea.example', snippet: 'history of tea' }] }
      throw new Error(`unexpected backendCall: ${cmd}`)
    })

    const output = await toolRegistry.execute('run_workflow', { name: 'inner-fail', input: 'the history of tea' })

    expect(output).not.toContain('Error:')
    expect(output).toContain('Workflow complete')
  })
})
