// @vitest-environment jsdom
/**
 * bau/review-wfplay.md Teil A, klaerung-n4.md Fund 2: der Play-Knopf neben
 * einem Arbeitsablauf in Settings > Agent > Agent Workflows war tot
 * (`onRun={() => {}}` in SettingsPage.tsx). Der Knopf ist entfernt statt
 * verdrahtet zu werden, denn der Weg, ihn "echt" zu machen, wurde in
 * fix/301-wfplay geprueft und mit Auflagen 1-4 (Blocker) zurueckgewiesen: der
 * verbleibende Startweg fuer einen Ablauf ist das Agenten-Werkzeug
 * `run_workflow` (und der Chat-Ausloeser "run workflow <name>"). Richtigstellung,
 * bau/review-wfgate.md Auflage 6: "funktionierend" war zum Zeitpunkt dieses
 * Kommentars zu grosszuegig formuliert, alle drei eingebauten Ablaeufe
 * haengen ueber diesen Weg am ersten user_input-Schritt, siehe die Korrektur
 * dazu in workflow-engine.ts (`prefilledUserInput`).
 *
 * Dieser Test haelt fest, dass die Liste ohne den Knopf rendert und die
 * beiden anderen Aktionen (Bearbeiten, Loeschen) unveraendert da sind.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { WorkflowList } from '../WorkflowList'
import { useAgentWorkflowStore } from '../../../stores/agentWorkflowStore'
import type { AgentWorkflow } from '../../../types/agent-workflows'

function workflow(overrides: Partial<AgentWorkflow> = {}): AgentWorkflow {
  return {
    id: 'wf-1',
    name: 'Custom workflow',
    description: 'a test workflow',
    icon: 'Zap',
    steps: [],
    variables: {},
    isBuiltIn: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

beforeEach(() => {
  cleanup()
  useAgentWorkflowStore.setState({ workflows: [workflow()] })
})

describe('WorkflowList', () => {
  it('renders without a Run/Play control', () => {
    render(<WorkflowList onEdit={() => {}} onCreate={() => {}} />)

    expect(screen.queryByTitle('Run')).toBeNull()
    // The lucide Play icon renders an svg with this class; the surest
    // negative is simply that no button anywhere is titled "Run".
    expect(screen.queryAllByRole('button').some((b) => b.getAttribute('title') === 'Run')).toBe(false)
  })

  it('keeps Edit and Delete for a custom workflow', () => {
    render(<WorkflowList onEdit={() => {}} onCreate={() => {}} />)

    expect(screen.getByTitle('Edit')).toBeTruthy()
    expect(screen.getByTitle('Delete')).toBeTruthy()
  })

  it('Edit still calls back with the workflow id', () => {
    const onEdit = vi.fn()
    render(<WorkflowList onEdit={onEdit} onCreate={() => {}} />)

    screen.getByTitle('Edit').click()
    expect(onEdit).toHaveBeenCalledWith('wf-1')
  })

  it('does not accept an onRun prop anymore (compile-time contract)', () => {
    // @ts-expect-error onRun was removed with the dead button; a caller
    // that still passes it should not type-check.
    render(<WorkflowList onRun={() => {}} onEdit={() => {}} onCreate={() => {}} />)
  })
})
