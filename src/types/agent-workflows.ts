/**
 * Agent Workflows / Chains — Type Definitions
 *
 * Multi-step agent sequences that can be saved, shared, and reused.
 * Steps execute sequentially with branching and looping support.
 */

import type { MemoryType } from './agent-mode'

// ── Step Types ────────────────────────────────────────────────

export type WorkflowStepType = 'prompt' | 'tool' | 'condition' | 'loop' | 'user_input' | 'memory_save'

export interface WorkflowStep {
  id: string
  type: WorkflowStepType
  label: string
  description?: string

  // prompt step: send message to LLM
  prompt?: string
  allowedTools?: string[]  // tool whitelist (empty = no tools, undefined = all tools)

  // tool step: execute specific tool
  toolName?: string
  /** Static args merged with the interpolated `toolArgTemplates` at run time.
   *  Same `unknown`-valued shape the tool executors receive (mcp/types.ToolArgs)
   *  — a saved workflow's args are JSON the user or an import wrote. */
  toolArgs?: Record<string, unknown>
  toolArgTemplates?: Record<string, string>  // supports {{variable}} interpolation

  // condition step: branch based on output
  condition?: {
    source: 'last_output' | string  // variable name or 'last_output'
    operator: 'contains' | 'not_contains' | 'equals' | 'not_equals' | 'truthy' | 'falsy'
    value: string
    thenStepId: string
    elseStepId: string
  }

  // loop step: repeat until condition
  loop?: {
    maxIterations: number
    condition: {
      source: 'last_output' | string
      operator: 'contains' | 'not_contains' | 'equals' | 'not_equals' | 'truthy' | 'falsy'
      value: string
    }
    bodyStepIds: string[]
  }

  // memory_save step: save to memory store
  memorySave?: {
    type: MemoryType
    titleTemplate: string    // supports {{variable}}
    contentTemplate: string  // supports {{variable}}
    tags?: string[]
  }

  // user_input step: pause for user input
  userInputPrompt?: string
}

// ── Workflow Definition ───────────────────────────────────────

export interface AgentWorkflow {
  id: string
  name: string
  description: string
  icon: string           // Lucide icon name
  steps: WorkflowStep[]
  variables: Record<string, string>  // default variable values
  isBuiltIn: boolean
  createdAt: number
  updatedAt: number
}

// ── Execution ─────────────────────────────────────────────────

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

export interface StepResult {
  stepId: string
  status: StepStatus
  output: string
  startedAt: number
  completedAt?: number
  error?: string
  toolCalls?: Array<{
    name: string
    args: Record<string, unknown>
    result: string
  }>
}

// Auflage 7, bau/review-wfgate.md: `WorkflowExecution` and `WorkflowStatus`
// (a full execution-history record type: id, status, currentStepIndex,
// stepResults, variables, conversationId, timestamps) were removed here
// alongside the dead execution-history slice of `agentWorkflowStore.ts`
// that was their only production reader and writer. `WorkflowEngine`
// (workflow-engine.ts) tracks a run's own state independently via
// `StepResult[]` and never touched this type.

// ── Engine Callbacks ──────────────────────────────────────────

export interface WorkflowEngineCallbacks {
  onStepStart: (stepIndex: number, step: WorkflowStep) => void
  onStepComplete: (stepIndex: number, result: StepResult) => void
  onStepError: (stepIndex: number, error: string) => void
  onWaitingForInput: (stepIndex: number, prompt: string) => void
  onComplete: (results: StepResult[]) => void
  onError: (error: string) => void
  /**
   * Fired with the CUMULATIVE output text as a `prompt` step's model answer
   * streams in (bau/wfprogress.md, harter Befund von der Box: a prompt step
   * used to give no feedback at all while the model produced tokens for
   * minutes). Optional so `builtin-tools.ts`'s `run_workflow` callers, which
   * do not need live text, need not implement it. Never fires for `tool`,
   * `condition`, `loop`, `user_input` or `memory_save` steps, and does not
   * fire for a `prompt` step that calls tools through the native
   * (non-streaming) tool-calling path.
   */
  onStepProgress?: (stepIndex: number, partialOutput: string) => void
  /**
   * Fired EXACTLY ONCE when a run ends because it was aborted (Stop), and
   * no `onStepError`/`onError` already reported a terminal state for it
   * (bau/wfprogress.md Runde 2, B1: `runSteps` used to leave a run that was
   * cancelled between two steps, or during a step that finished normally
   * despite the abort signal, with NO terminal callback at all: the chat
   * trigger's progress block then stayed on 'running' forever, spinner
   * included, and that stuck state was what got persisted). Optional for
   * the same reason `onStepProgress` is: `run_workflow`'s own nested engine
   * (builtin-tools.ts) does not need it. `results` carries whatever steps
   * did complete before the stop.
   */
  onStopped?: (results: StepResult[]) => void
}
