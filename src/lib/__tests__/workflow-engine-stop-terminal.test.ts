/**
 * review-wfprogress.md, BLOCKER (Runde 2): `runSteps` used to leave a run
 * with NO terminal callback at all when Stop cancelled it BETWEEN two steps,
 * or DURING a step that itself finished normally despite the abort signal
 * (a step type that does not watch the signal, e.g. `memory_save`). Opus's
 * own repro measured `CALLBACKS=["start0","complete0"]` and nothing after.
 * The chat trigger's progress block (useAgentChat.ts) only ever leaves
 * 'running' inside onStepStart/onStepComplete/onStepError/onComplete/
 * onError/onStopped, so that gap left the block on 'running' forever, with
 * its spinner, and THAT stuck state got persisted.
 *
 * This drives the REAL `WorkflowEngine` (not a mock of it) over a two-step
 * `memory_save` workflow, synchronous and local, same fixture the branching
 * tests already use, so no Tauri backend is needed, and cancels the run
 * from inside the engine's own callbacks to land exactly on the two gaps the
 * review measured. A third test re-confirms the case the review found
 * ALREADY correct (Stop during a pending approval), so a future change
 * cannot regress it while "fixing" this file.
 *
 * Run: npx vitest run src/lib/__tests__/workflow-engine-stop-terminal.test.ts
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { WorkflowEngine } from '../workflow-engine'
import { APPROVE_ALL } from '../../api/agents/tool-executor'
import { useMemoryStore } from '../../stores/memoryStore'
import type { AgentWorkflow, WorkflowEngineCallbacks, StepResult } from '../../types/agent-workflows'
import type { ApprovalGate } from '../../api/agents/tool-executor'

// A gate that never approves, so a tool step's own approval wait genuinely
// hangs until Stop resolves it via the abort race in `gatedApproval`, the
// scenario review-wfprogress.md already found correct.
const REJECT_ALL: ApprovalGate = () => new Promise(() => {})

function twoMemoryStepWorkflow(): AgentWorkflow {
  return {
    id: 'wf-stop-terminal', name: 'stop terminal test', description: '', icon: 'Zap',
    steps: [
      { id: 's1', type: 'memory_save', label: 'First step', memorySave: { type: 'reference', titleTemplate: 'one', contentTemplate: 'first result', tags: [] } },
      { id: 's2', type: 'memory_save', label: 'Second step', memorySave: { type: 'reference', titleTemplate: 'two', contentTemplate: 'second result', tags: [] } },
    ],
    variables: {}, isBuiltIn: false, createdAt: 0, updatedAt: 0,
  }
}

function oneToolStepWorkflow(): AgentWorkflow {
  return {
    id: 'wf-stop-approval', name: 'stop approval test', description: '', icon: 'Zap',
    steps: [{ id: 's1', type: 'tool', label: 'Run it', toolName: 'shell_execute', toolArgs: { command: 'echo hi' } }],
    variables: {}, isBuiltIn: false, createdAt: 0, updatedAt: 0,
  }
}

interface Recorder {
  events: string[]
  stoppedResults: StepResult[][]
  callbacks: WorkflowEngineCallbacks
}

function recordingCallbacks(onStepStart?: (i: number) => void, onStepComplete?: (i: number) => void): Recorder {
  const events: string[] = []
  const stoppedResults: StepResult[][] = []
  return {
    events,
    stoppedResults,
    callbacks: {
      onStepStart: (i) => { events.push(`start${i}`); onStepStart?.(i) },
      onStepComplete: (i) => { events.push(`complete${i}`); onStepComplete?.(i) },
      onStepError: (i) => { events.push(`error${i}`) },
      onWaitingForInput: () => { events.push('waiting') },
      onComplete: () => { events.push('done') },
      onError: () => { events.push('failed') },
      onStopped: (results) => { events.push('stopped'); stoppedResults.push(results) },
    },
  }
}

beforeEach(() => {
  vi.spyOn(useMemoryStore.getState(), 'addMemory').mockImplementation(() => 'mem-id')
})

describe('B1: jeder Lauf endet GENAU EINMAL in einem Endzustand, auch bei Abbruch', () => {
  it('Stop ZWISCHEN zwei Schritten: Schritt 2 startet nie, onStopped feuert genau einmal', async () => {
    // Forward-declared: assigned once below, but referenced inside a callback
    // defined before that assignment runs.
    // eslint-disable-next-line prefer-const
    let engine!: WorkflowEngine
    const rec = recordingCallbacks(undefined, (i) => {
      // Cancel right as step 0 finishes, BEFORE the loop can start step 1:
      // this is "between two steps", step 1's onStepStart must never fire.
      if (i === 0) engine.cancel()
    })
    engine = new WorkflowEngine(twoMemoryStepWorkflow(), 'conv-between', rec.callbacks, APPROVE_ALL)
    const results = await engine.run()

    expect(rec.events).toEqual(['start0', 'complete0', 'stopped'])
    expect(rec.events).not.toContain('start1')
    expect(rec.events).not.toContain('done')
    expect(rec.events).not.toContain('failed')
    expect(rec.stoppedResults).toHaveLength(1)
    // Exactly one terminal callback total.
    expect(rec.events.filter((e) => ['stopped', 'done', 'failed'].includes(e))).toHaveLength(1)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('completed')
  })

  it('Stop WAEHREND eines Schritts, der trotzdem normal fertig wird: onStopped feuert trotzdem genau einmal', async () => {
    // Forward-declared: assigned once below, but referenced inside a callback
    // defined before that assignment runs.
    // eslint-disable-next-line prefer-const
    let engine!: WorkflowEngine
    const rec = recordingCallbacks((i) => {
      // Cancel as step 1 STARTS: memory_save does not watch the signal, so
      // it finishes normally anyway. This is the "step finished normally
      // despite the abort" gap the review measured.
      if (i === 1) engine.cancel()
    })
    engine = new WorkflowEngine(twoMemoryStepWorkflow(), 'conv-during', rec.callbacks, APPROVE_ALL)
    const results = await engine.run()

    expect(rec.events).toEqual(['start0', 'complete0', 'start1', 'complete1', 'stopped'])
    expect(rec.events).not.toContain('done')
    expect(rec.events).not.toContain('failed')
    expect(rec.stoppedResults).toHaveLength(1)
    expect(rec.stoppedResults[0]).toHaveLength(2)
    expect(rec.events.filter((e) => ['stopped', 'done', 'failed'].includes(e))).toHaveLength(1)
    expect(results).toHaveLength(2)
  })

  it('NEGATIVKONTROLLE: ohne den B1-Fix bliebe ein solcher Lauf ganz ohne Endzustand-Callback', async () => {
    // Reproduces Opus's own repro directly, without touching the engine
    // file: a callback set that matches the OLD (pre-fix) contract, i.e.
    // one with no `onStopped` at all, proves nothing else in this file
    // silently supplies the missing terminal state; if it did, this would
    // fail instead of passing.
    // Forward-declared: assigned once below, but referenced inside a callback
    // defined before that assignment runs.
    // eslint-disable-next-line prefer-const
    let engine!: WorkflowEngine
    const events: string[] = []
    const oldStyleCallbacks: WorkflowEngineCallbacks = {
      onStepStart: (i) => { events.push(`start${i}`); if (i === 0) queueMicrotask(() => {}) },
      onStepComplete: (i) => {
        events.push(`complete${i}`)
        if (i === 0) engine.cancel()
      },
      onStepError: () => { events.push('error') },
      onWaitingForInput: () => {},
      onComplete: () => { events.push('done') },
      onError: () => { events.push('failed') },
      // onStopped deliberately omitted, matching the pre-fix contract.
    }
    engine = new WorkflowEngine(twoMemoryStepWorkflow(), 'conv-negctrl', oldStyleCallbacks, APPROVE_ALL)
    await engine.run()

    expect(events).toEqual(['start0', 'complete0'])
    expect(events).not.toContain('done')
    expect(events).not.toContain('failed')
  })

  it('Stop bei wartender Freigabe bleibt korrekt: onStepError feuert, onStopped NICHT (bereits gefixt, gegengeprueft)', async () => {
    // Forward-declared: assigned once below, but referenced inside a callback
    // defined before that assignment runs.
    // eslint-disable-next-line prefer-const
    let engine!: WorkflowEngine
    const rec = recordingCallbacks((i) => {
      if (i === 0) engine.cancel()
    })
    engine = new WorkflowEngine(oneToolStepWorkflow(), 'conv-approval', rec.callbacks, REJECT_ALL)
    const results = await engine.run()

    // REJECT_ALL + an already-aborted signal both resolve `gatedApproval` to
    // `approved: false`, so the step fails honestly instead of hanging,
    // the case review-wfprogress.md found already correct.
    expect(rec.events).toContain('error0')
    expect(rec.events).not.toContain('stopped')
    expect(results[0].status).toBe('failed')
  })
})
