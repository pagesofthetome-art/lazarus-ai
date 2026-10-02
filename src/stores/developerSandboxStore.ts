import { create } from 'zustand'
import type { DeveloperSession, DeveloperSessionStatus } from '../lib/developer-sandbox'

interface DeveloperSandboxState {
  session: DeveloperSession | null
  previewUrl: string | null
  setSession: (session: DeveloperSession | null) => void
  setStatus: (status: DeveloperSessionStatus) => void
  setPreviewUrl: (url: string | null) => void
  beginApply: () => void
  beginDiscard: () => void
  reset: () => void
}

export const useDeveloperSandboxStore = create<DeveloperSandboxState>((set) => ({
  session: null,
  previewUrl: null,
  setSession: (session) => set({ session }),
  setStatus: (status) => set((state) => state.session ? { session: { ...state.session, status } } : state),
  setPreviewUrl: (previewUrl) => set({ previewUrl }),
  beginApply: () => set((state) => state.session ? { session: { ...state.session, status: 'applying' } } : state),
  beginDiscard: () => set((state) => state.session ? { session: { ...state.session, status: 'discarding' } } : state),
  reset: () => set({ session: null, previewUrl: null }),
}))
