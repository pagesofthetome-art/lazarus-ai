import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeJSONStorage } from '../lib/storage-quota'
import { v4 as uuid } from 'uuid'
import type { AgentWorkflow } from '../types/agent-workflows'
import { BUILT_IN_WORKFLOWS } from '../lib/built-in-workflows'
import { isRecord, prop, asString } from '../types/json-guards'

// ── Store Interface ───────────────────────────────────────────

// Auflage 7, bau/review-wfgate.md: this store used to also carry an
// execution-history slice (`executions`, `activeExecutionId`,
// `startExecution`, `updateExecution`, `addStepResult`, `cancelExecution`,
// `clearExecutionHistory`, `MAX_EXECUTION_HISTORY`) written and read only by
// the now-deleted `useWorkflow.ts` hook and `WorkflowRunner.tsx` panel
// (removed in commit 8ca0df85, the dead Settings Play button). Harte Regel
// "alten Code sofort loeschen": a repo-wide grep for every one of those
// names outside this store and its own tests found nothing (WorkflowEngine
// tracks its own run state independently and never touches this slice).
interface AgentWorkflowState {
  workflows: AgentWorkflow[]

  // Workflow CRUD
  addWorkflow: (workflow: Omit<AgentWorkflow, 'id' | 'createdAt' | 'updatedAt'>) => string
  updateWorkflow: (id: string, updates: Partial<Pick<AgentWorkflow, 'name' | 'description' | 'icon' | 'steps' | 'variables'>>) => void
  removeWorkflow: (id: string) => void
  duplicateWorkflow: (id: string) => string | null
  getWorkflow: (id: string) => AgentWorkflow | undefined
}

// ── Store ─────────────────────────────────────────────────────

export const useAgentWorkflowStore = create<AgentWorkflowState>()(
  persist(
    (set, get) => ({
      workflows: [...BUILT_IN_WORKFLOWS],

      // ── Workflow CRUD ─────────────────────────────────────

      addWorkflow: (workflow) => {
        const id = uuid()
        set((state) => ({
          workflows: [
            ...state.workflows,
            { ...workflow, id, createdAt: Date.now(), updatedAt: Date.now() },
          ],
        }))
        return id
      },

      updateWorkflow: (id, updates) =>
        set((state) => ({
          workflows: state.workflows.map((w) =>
            w.id === id ? { ...w, ...updates, updatedAt: Date.now() } : w
          ),
        })),

      removeWorkflow: (id) =>
        set((state) => ({
          workflows: state.workflows.filter((w) => w.id !== id || w.isBuiltIn),
        })),

      duplicateWorkflow: (id) => {
        const original = get().workflows.find(w => w.id === id)
        if (!original) return null
        const newId = uuid()
        set((state) => ({
          workflows: [
            ...state.workflows,
            {
              ...original,
              id: newId,
              name: `${original.name} (copy)`,
              isBuiltIn: false,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          ],
        }))
        return newId
      },

      getWorkflow: (id) => get().workflows.find(w => w.id === id),
    }),
    {
      name: 'locally-uncensored-agent-workflows',
      storage: safeJSONStorage(),
      version: 1,
      migrate: (persistedState, version) => {
        // Persisted state is foreign at read time: an older build wrote it. A
        // read that throws in here costs the WHOLE store — zustand abandons
        // hydration and the next write persists the empty default over the
        // blob — so `workflows` is checked for being an array instead of just
        // being truthy (`{}.length` is undefined, which is not 0, and the
        // `.map` below then threw).
        const state = isRecord(persistedState) ? persistedState : {}
        const workflows = Array.isArray(state.workflows) ? state.workflows : []
        // Ensure built-ins are present (may have been added in updates)
        const existingIds = new Set(workflows.map((w) => asString(prop(w, 'id'))))
        const missingBuiltIns = BUILT_IN_WORKFLOWS.filter(w => !existingIds.has(w.id))
        // A persisted blob from before Auflage 7 (bau/review-wfgate.md) may
        // still carry the now-removed `executions`/`activeExecutionId` keys;
        // dropping `state`'s own copy and building the result from named
        // fields only, instead of spreading `state`, keeps them out of the
        // store going forward without a separate migration step.
        const next = version < 1 || workflows.length === 0
          ? { workflows: BUILT_IN_WORKFLOWS }
          : { workflows: [...missingBuiltIns, ...workflows] }
        // zustand types migrate as returning the FULL store, but a blob only
        // ever carries the partialized slice and `merge` puts the actions
        // back. The cast claims exactly what went in, nothing about actions.
        return next as unknown as AgentWorkflowState
      },
      partialize: (state) => ({
        workflows: state.workflows,
      }),
    }
  )
)
