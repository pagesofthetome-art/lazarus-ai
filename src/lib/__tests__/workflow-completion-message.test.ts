/**
 * B1 (lu-301/bau/klaerung-n7.md): what a workflow's LAST chat message says
 * when it finishes.
 *
 * The tester's "run workflow Research Topic: the history of tea" showed only
 * a second line, "Saved to memory: Research: the history of tea", and then
 * nothing for 5+ minutes with the send button back to idle, read as a hang.
 * Quelltextlage: it was not a hang for a run where every step genuinely
 * succeeded. `runSteps` (workflow-engine.ts) only reaches `onComplete` after
 * every step has run, and the built-in "Research Topic" workflow ends in a
 * `memory_save` step whose own output is, by construction, never empty
 * ("Saved to memory: ${title}", `executeMemorySaveStep`). The old
 * `onComplete` in BOTH callers (`useAgentChat.ts`'s chat trigger and
 * `builtin-tools.ts`'s `run_workflow` tool) picked
 * `results.filter(r => r.output).pop()`, the LAST step with any output,
 * which for a workflow ending in `memory_save` is ALWAYS that receipt,
 * never the actual content a `prompt` step produced.
 *
 * A run that stops on a genuine step failure (a broken web search, an empty
 * model answer) is a SEPARATE concern, covered in
 * workflow-stops-honestly-on-tool-failure.test.ts and
 * web-tools-fail-honestly.test.ts (review-offload2.md Auflage 2.1): this
 * file only covers the "everything genuinely worked" completion message.
 *
 * This test drives the REAL `WorkflowEngine`, not a copy: a `prompt` step
 * (real `chatStream` inference, mocked only at the provider boundary, same
 * pattern as workflow-engine-approval-gate.test.ts) followed by a
 * `memory_save` step, exactly the shape "Research Topic" ends in. It reads
 * the result the same way both production callers now do: through
 * `describeWorkflowCompletion`.
 *
 * Lauf: npx vitest run src/lib/__tests__/workflow-completion-message.test.ts
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../agent-strategy', () => ({
  resolveToolCallingStrategy: vi.fn(),
}))

import { WorkflowEngine, describeWorkflowCompletion } from '../workflow-engine'
import { APPROVE_ALL } from '../../api/agents/tool-executor'
import { useModelStore } from '../../stores/modelStore'
import { useMemoryStore } from '../../stores/memoryStore'
import { useGenerationStore } from '../../stores/generationStore'
import { __resetRunLanesForTests } from '../run-lanes'
import { resolveToolCallingStrategy } from '../agent-strategy'
import type { AgentWorkflow, WorkflowStep, WorkflowEngineCallbacks } from '../../types/agent-workflows'

const CLOUD_MODEL = 'anthropic::claude'
const REAL_CONTENT = 'the printing press changed everything'

function workflowOf(steps: WorkflowStep[]): AgentWorkflow {
  return { id: 'wf', name: 'test', description: '', icon: 'Zap', steps, variables: {}, isBuiltIn: false, createdAt: 0, updatedAt: 0 }
}

/** A single-chunk stream, same shape `executePromptStep`'s `for await`
 *  consumes off `provider.chatStream`. Reads the canned answer back out of
 *  the prompt itself (`promptStep` below writes it as `respond:<answer>`),
 *  so two prompt steps in one run can answer differently. */
async function* respondToPrompt(_model: string, messages: Array<{ content: string }>) {
  const sent = messages[messages.length - 1]?.content || ''
  const answer = sent.startsWith('respond:') ? sent.slice('respond:'.length) : sent
  yield { content: answer, done: true }
}

function promptStep(id: string, content: string): WorkflowStep {
  // The prompt text itself carries which canned answer this step gets;
  // `respondToPrompt` below reads it back out of the messages `chatStream`
  // receives, so two prompt steps in the same run can answer differently.
  return { id, type: 'prompt', label: id, prompt: `respond:${content}`, allowedTools: [] }
}

function memorySaveStep(id: string, titleTemplate = 'note'): WorkflowStep {
  return {
    id, type: 'memory_save', label: id,
    memorySave: { type: 'reference', titleTemplate, contentTemplate: '{{last_output}}', tags: [] },
  }
}

beforeEach(() => {
  __resetRunLanesForTests()
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useModelStore.setState({ activeModel: CLOUD_MODEL })
  vi.spyOn(useMemoryStore.getState(), 'addMemory').mockImplementation(() => 'mem-id')
  // Every prompt step in these tests answers with REAL_CONTENT, good enough
  // for a fixed-content stub, the point here is the SELECTION logic after
  // the run, not varying what the model says.
  vi.mocked(resolveToolCallingStrategy).mockResolvedValue({
    strategy: 'native',
    modelToUse: 'claude',
    modelId: 'claude',
    providerId: 'anthropic',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provider: { chatStream: respondToPrompt, chatWithTools: vi.fn() } as any,
  })
})

function callbacksCollectingAllResults() {
  const collected: { onComplete?: Parameters<WorkflowEngineCallbacks['onComplete']>[0] } = {}
  const errors: string[] = []
  const callbacks: WorkflowEngineCallbacks = {
    onStepStart: () => {},
    onStepComplete: () => {},
    onStepError: (_i, e) => errors.push(e),
    onWaitingForInput: () => {},
    onComplete: (results) => { collected.onComplete = results },
    onError: (e) => errors.push(e),
  }
  return { callbacks, collected, errors }
}

describe('describeWorkflowCompletion: the real content wins over a trailing memory_save receipt', () => {
  it('a real WorkflowEngine.run() ending in memory_save: the chat message shows the prompt step\'s content, not just the receipt', async () => {
    const workflow = workflowOf([promptStep('summary', REAL_CONTENT), memorySaveStep('save', 'Research: tea')])
    const { callbacks, collected, errors } = callbacksCollectingAllResults()
    const engine = new WorkflowEngine(workflow, 'conv-a', callbacks, APPROVE_ALL)
    await engine.run()

    expect(errors).toEqual([])
    expect(collected.onComplete).toBeDefined()
    const message = describeWorkflowCompletion(workflow, collected.onComplete!)

    // The actual bug: before the fix this was ONLY "Saved to memory: ...".
    expect(message).toContain(REAL_CONTENT)
    expect(message).toContain('Workflow complete (2/2 steps).')
    // The receipt is still shown, alongside the content, not instead of it.
    expect(message).toContain('Saved to memory: Research: tea')
    // And the content must come BEFORE the receipt, so a reader who only
    // sees the first line still sees the actual answer.
    expect(message.indexOf(REAL_CONTENT)).toBeLessThan(message.indexOf('Saved to memory:'))
  })

  it('Gegenprobe: a workflow with NO memory_save step keeps showing the last step\'s content unchanged', async () => {
    const workflow = workflowOf([promptStep('first', 'ignored, not the last step'), promptStep('last', REAL_CONTENT)])
    const { callbacks, collected, errors } = callbacksCollectingAllResults()
    const engine = new WorkflowEngine(workflow, 'conv-b', callbacks, APPROVE_ALL)
    await engine.run()

    expect(errors).toEqual([])
    const message = describeWorkflowCompletion(workflow, collected.onComplete!)
    expect(message).toContain(REAL_CONTENT)
    expect(message).not.toContain('ignored, not the last step')
    expect(message).toContain('Workflow complete (2/2 steps).')
  })

  it('a step that produced no output at all is named honestly instead of ending on a bare header', () => {
    const workflow = workflowOf([memorySaveStep('save', 'Research: tea')])
    // Simulate a memory_save-only run where the receipt itself is excluded
    // from "content" by design; the message must say so, not go silent.
    const results = [
      { stepId: 'save', status: 'completed' as const, output: 'Saved to memory: Research: tea', startedAt: 0, completedAt: 1 },
    ]
    const message = describeWorkflowCompletion(workflow, results)
    expect(message).toContain('Workflow complete (1/1 step).')
    expect(message).toContain('No step produced any output to show.')
    expect(message).toContain('Saved to memory: Research: tea')
  })

})
