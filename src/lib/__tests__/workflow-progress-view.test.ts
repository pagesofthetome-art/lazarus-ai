/**
 * Pure-function tests for workflow-progress-view.ts (bau/wfprogress.md).
 *
 * This module builds the text a running workflow's ToolCallBlock shows once
 * expanded: every step's status, each finished step's truncated args/result,
 * and the running step's live text. Kept independent of React/the chat store
 * so the rendering logic itself is directly testable.
 *
 * Run: npx vitest run src/lib/__tests__/workflow-progress-view.test.ts
 */
import { describe, it, expect } from 'vitest'
import {
  renderWorkflowStepList,
  workflowProgressHeader,
  truncateForProgress,
  PROGRESS_DISPLAY_TRUNCATE_CHARS,
  isWorkflowProgressToolName,
  markStaleWorkflowProgressStopped,
  type WorkflowStepView,
} from '../workflow-progress-view'
import type { WorkflowStep } from '../../types/agent-workflows'

function step(id: string, label: string): WorkflowStep {
  return { id, type: 'tool', label }
}

describe('renderWorkflowStepList: die vollstaendige Schrittliste', () => {
  it('zeigt ALLE Schritte, auch die, die noch nicht gelaufen sind (wartet)', () => {
    const views: WorkflowStepView[] = [
      { step: step('a', 'Search the web'), status: 'completed', output: 'found tea history' },
      { step: step('b', 'Summarize'), status: 'running', output: 'Tea has a' },
      { step: step('c', 'Save to memory'), status: 'pending' },
    ]
    const text = renderWorkflowStepList(views)
    expect(text).toContain('Step 1 of 3: Search the web - done')
    expect(text).toContain('Step 2 of 3: Summarize - running...')
    expect(text).toContain('Step 3 of 3: Save to memory - waiting')
    // The running step's partial text is labelled differently from a
    // finished step's result, so "still going" never reads as "done".
    expect(text).toContain('so far: Tea has a')
    expect(text).toContain('result: found tea history')
  })

  it('zeigt Argumente und Resultat fuer einen Werkzeug-Schritt, gekuerzt', () => {
    const views: WorkflowStepView[] = [
      {
        step: step('a', 'Search the web'),
        status: 'completed',
        args: { query: 'history of tea' },
        output: 'Tea originated in China thousands of years ago.',
      },
    ]
    const text = renderWorkflowStepList(views)
    expect(text).toContain('args: {"query":"history of tea"}')
    expect(text).toContain('result: Tea originated in China thousands of years ago.')
  })

  it('zeigt einen Fehler am fehlgeschlagenen Schritt', () => {
    const views: WorkflowStepView[] = [
      { step: step('a', 'Search the web'), status: 'failed', error: 'All search tiers failed' },
    ]
    const text = renderWorkflowStepList(views)
    expect(text).toContain('Step 1 of 1: Search the web - failed')
    expect(text).toContain('error: All search tiers failed')
  })

  it('markiert einen nie erreichten Schritt als uebersprungen, nicht als ewig wartend', () => {
    const views: WorkflowStepView[] = [
      { step: step('a', 'Ask'), status: 'failed', error: 'boom' },
      { step: step('b', 'Never runs'), status: 'skipped' },
    ]
    const text = renderWorkflowStepList(views)
    expect(text).toContain('Step 2 of 2: Never runs - skipped')
  })
})

describe('truncateForProgress: Kuerzung fuer die Chat-Anzeige', () => {
  it('laesst kurzen Text unveraendert', () => {
    expect(truncateForProgress('short result')).toBe('short result')
  })

  it('kuerzt langen Text auf das Anzeige-Budget und nennt die Restlaenge', () => {
    const long = 'x'.repeat(PROGRESS_DISPLAY_TRUNCATE_CHARS + 250)
    const truncated = truncateForProgress(long)
    expect(truncated.length).toBeLessThan(long.length)
    expect(truncated.startsWith('x'.repeat(PROGRESS_DISPLAY_TRUNCATE_CHARS))).toBe(true)
    expect(truncated).toContain('[250 more chars]')
  })

  it('NEGATIVKONTROLLE: ohne Kuerzung stuende der volle Text in der Stufenliste', () => {
    // Same assembly renderWorkflowStepList does, but skipping truncateForProgress
    // entirely: the shape a regression would take if someone inlined the
    // field instead of calling the helper.
    const long = 'y'.repeat(5000)
    const untouched = `  result: ${long}`
    expect(untouched.length).toBeGreaterThan(PROGRESS_DISPLAY_TRUNCATE_CHARS)
    // The real helper never lets that happen:
    const views: WorkflowStepView[] = [{ step: step('a', 'Fetch'), status: 'completed', output: long }]
    const rendered = renderWorkflowStepList(views)
    const resultLine = rendered.split('\n').find((l) => l.trim().startsWith('result:'))!
    expect(resultLine.length).toBeLessThan(long.length)
  })
})

describe('workflowProgressHeader: der eingeklappte Titel', () => {
  it('nennt den GERADE laufenden Schritt', () => {
    const views: WorkflowStepView[] = [
      { step: step('a', 'Search the web'), status: 'completed' },
      { step: step('b', 'Summarize'), status: 'running' },
      { step: step('c', 'Save'), status: 'pending' },
    ]
    expect(workflowProgressHeader('Research Topic', views)).toBe('Step 2 of 3: Summarize')
  })

  it('zeigt eine Zusammenfassung, sobald kein Schritt mehr laeuft', () => {
    const views: WorkflowStepView[] = [
      { step: step('a', 'Search the web'), status: 'completed' },
      { step: step('b', 'Summarize'), status: 'completed' },
    ]
    expect(workflowProgressHeader('Research Topic', views)).toBe('Workflow: Research Topic (2/2 steps)')
  })
})

describe('markStaleWorkflowProgressStopped: App-Neustart mitten im Lauf (Runde 2, BLOCKER)', () => {
  it('macht aus einem noch "running" persistierten Fortschrittsblock ehrlich "stopped"', () => {
    const call = { toolName: 'Step 2 of 3: Summarize', status: 'running' }
    const changed = markStaleWorkflowProgressStopped(call)
    expect(changed).toBe(true)
    expect(call.status).toBe('stopped')
    expect(call.toolName).not.toMatch(/running/)
  })

  it('erkennt auch den abgeschlossenen Kopfzeilen-Stil ("Workflow: ...")', () => {
    const call = { toolName: 'Workflow: Research Topic (1/3 steps)', status: 'running' }
    expect(isWorkflowProgressToolName(call.toolName)).toBe(true)
    expect(markStaleWorkflowProgressStopped(call)).toBe(true)
    expect(call.status).toBe('stopped')
  })

  it('laesst einen bereits fertigen Fortschrittsblock unangetastet (idempotent)', () => {
    const call = { toolName: 'Workflow: Research Topic (3/3 steps)', status: 'completed' }
    expect(markStaleWorkflowProgressStopped(call)).toBe(false)
    expect(call.status).toBe('completed')
  })

  it('NEGATIVKONTROLLE: ruehrt einen echten Werkzeug-Aufruf mit Status "running" NICHT an', () => {
    // A real tool call's toolName never starts with "Step " or "Workflow:":
    // this is exactly what tells the two apart with no dedicated marker
    // field. If this ever matched, a genuinely still-running shell command
    // shown right after app start would get relabelled "stopped" too.
    const call = { toolName: 'shell_execute', status: 'running' }
    expect(isWorkflowProgressToolName(call.toolName)).toBe(false)
    expect(markStaleWorkflowProgressStopped(call)).toBe(false)
    expect(call.status).toBe('running')
  })
})
