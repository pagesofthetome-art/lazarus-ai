import { create } from 'zustand'

export type EngineLifecycleState = 'sleeping' | 'waking' | 'ready' | 'working' | 'unloading'

interface EngineLifecycleStore {
  state: EngineLifecycleState
  setState: (state: EngineLifecycleState) => void
}

/** Ephemeral UI-only state for the managed Lazarus Engine lifecycle. */
export const useEngineLifecycleStore = create<EngineLifecycleStore>((set) => ({
  state: 'ready',
  setState: (state) => set({ state }),
}))
