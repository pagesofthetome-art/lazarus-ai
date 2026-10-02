import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-uuid-' + Math.random().toString(36).slice(2, 8)),
}))

vi.mock('../../lib/built-in-workflows', () => ({
  BUILT_IN_WORKFLOWS: [
    {
      id: 'builtin-1',
      name: 'Built-in Workflow',
      description: 'A built-in test workflow',
      icon: 'Search',
      steps: [{ id: 's1', type: 'prompt', label: 'Step 1' }],
      variables: { topic: 'default' },
      isBuiltIn: true,
      createdAt: 1000,
      updatedAt: 1000,
    },
  ],
}))

import { useAgentWorkflowStore } from '../agentWorkflowStore'

describe('agentWorkflowStore', () => {
  beforeEach(() => {
    useAgentWorkflowStore.setState({
      workflows: [
        {
          id: 'builtin-1',
          name: 'Built-in Workflow',
          description: 'A built-in test workflow',
          icon: 'Search',
          steps: [{ id: 's1', type: 'prompt', label: 'Step 1' }],
          variables: { topic: 'default' },
          isBuiltIn: true,
          createdAt: 1000,
          updatedAt: 1000,
        },
      ],
    })
  })

  // ── addWorkflow ────────────────────────────────────────────

  describe('addWorkflow', () => {
    it('returns a UUID for the new workflow', () => {
      const id = useAgentWorkflowStore.getState().addWorkflow({
        name: 'Custom',
        description: 'Custom workflow',
        icon: 'Zap',
        steps: [],
        variables: {},
        isBuiltIn: false,
      })
      expect(id).toBeDefined()
      expect(typeof id).toBe('string')
    })

    it('appends workflow with createdAt and updatedAt timestamps', () => {
      const before = Date.now()
      useAgentWorkflowStore.getState().addWorkflow({
        name: 'Custom',
        description: 'desc',
        icon: 'Zap',
        steps: [],
        variables: {},
        isBuiltIn: false,
      })
      const workflows = useAgentWorkflowStore.getState().workflows
      const added = workflows[workflows.length - 1]
      expect(added.name).toBe('Custom')
      expect(added.createdAt).toBeGreaterThanOrEqual(before)
      expect(added.updatedAt).toBeGreaterThanOrEqual(before)
    })

    it('does not remove existing workflows', () => {
      useAgentWorkflowStore.getState().addWorkflow({
        name: 'Second',
        description: '',
        icon: 'Zap',
        steps: [],
        variables: {},
        isBuiltIn: false,
      })
      expect(useAgentWorkflowStore.getState().workflows.length).toBe(2)
    })
  })

  // ── updateWorkflow ─────────────────────────────────────────

  describe('updateWorkflow', () => {
    it('merges updates and sets updatedAt', () => {
      useAgentWorkflowStore.getState().addWorkflow({
        name: 'Original',
        description: 'desc',
        icon: 'Zap',
        steps: [],
        variables: {},
        isBuiltIn: false,
      })
      const id = useAgentWorkflowStore.getState().workflows[1].id
      const before = Date.now()
      useAgentWorkflowStore.getState().updateWorkflow(id, { name: 'Updated' })
      const updated = useAgentWorkflowStore.getState().workflows.find(w => w.id === id)!
      expect(updated.name).toBe('Updated')
      expect(updated.description).toBe('desc') // unchanged
      expect(updated.updatedAt).toBeGreaterThanOrEqual(before)
    })

    it('is a no-op for non-existent id', () => {
      const before = [...useAgentWorkflowStore.getState().workflows]
      useAgentWorkflowStore.getState().updateWorkflow('nonexistent', { name: 'X' })
      expect(useAgentWorkflowStore.getState().workflows).toEqual(before)
    })
  })

  // ── removeWorkflow ─────────────────────────────────────────

  describe('removeWorkflow', () => {
    it('removes a non-builtIn workflow', () => {
      const id = useAgentWorkflowStore.getState().addWorkflow({
        name: 'Removable',
        description: '',
        icon: 'Zap',
        steps: [],
        variables: {},
        isBuiltIn: false,
      })
      expect(useAgentWorkflowStore.getState().workflows.length).toBe(2)
      useAgentWorkflowStore.getState().removeWorkflow(id)
      expect(useAgentWorkflowStore.getState().workflows.length).toBe(1)
    })

    it('does NOT remove a builtIn workflow', () => {
      useAgentWorkflowStore.getState().removeWorkflow('builtin-1')
      expect(useAgentWorkflowStore.getState().workflows.length).toBe(1)
      expect(useAgentWorkflowStore.getState().workflows[0].id).toBe('builtin-1')
    })
  })

  // ── duplicateWorkflow ──────────────────────────────────────

  describe('duplicateWorkflow', () => {
    it('creates a copy with new UUID', () => {
      const newId = useAgentWorkflowStore.getState().duplicateWorkflow('builtin-1')
      expect(newId).not.toBeNull()
      expect(newId).not.toBe('builtin-1')
    })

    it('sets isBuiltIn to false on the duplicate', () => {
      const newId = useAgentWorkflowStore.getState().duplicateWorkflow('builtin-1')!
      const dup = useAgentWorkflowStore.getState().workflows.find(w => w.id === newId)!
      expect(dup.isBuiltIn).toBe(false)
    })

    it('appends "(copy)" to the name', () => {
      const newId = useAgentWorkflowStore.getState().duplicateWorkflow('builtin-1')!
      const dup = useAgentWorkflowStore.getState().workflows.find(w => w.id === newId)!
      expect(dup.name).toBe('Built-in Workflow (copy)')
    })

    it('returns null for non-existent workflow', () => {
      const result = useAgentWorkflowStore.getState().duplicateWorkflow('nonexistent')
      expect(result).toBeNull()
    })

    it('sets new createdAt and updatedAt timestamps', () => {
      const before = Date.now()
      const newId = useAgentWorkflowStore.getState().duplicateWorkflow('builtin-1')!
      const dup = useAgentWorkflowStore.getState().workflows.find(w => w.id === newId)!
      expect(dup.createdAt).toBeGreaterThanOrEqual(before)
      expect(dup.updatedAt).toBeGreaterThanOrEqual(before)
    })
  })

  // ── getWorkflow ────────────────────────────────────────────

  describe('getWorkflow', () => {
    it('returns the workflow by id', () => {
      const wf = useAgentWorkflowStore.getState().getWorkflow('builtin-1')
      expect(wf).toBeDefined()
      expect(wf!.name).toBe('Built-in Workflow')
    })

    it('returns undefined for unknown id', () => {
      expect(useAgentWorkflowStore.getState().getWorkflow('nope')).toBeUndefined()
    })
  })

  // Auflage 7, bau/review-wfgate.md: the execution-history slice this store
  // used to carry (`startExecution`, `updateExecution`, `addStepResult`,
  // `cancelExecution`, `clearExecutionHistory`, `activeExecutionId`,
  // `MAX_EXECUTION_HISTORY`) was deleted as dead code, its last production
  // reader and writer having gone with the deleted `useWorkflow.ts` (commit
  // 8ca0df85). The test cases that exercised it are removed with it.
})
