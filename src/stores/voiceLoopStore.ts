import { createStore } from 'zustand/vanilla'
import type { ToolArgs } from '../api/mcp/types'

export interface VoiceApproval {
  id: string
  name: string
  args: ToolArgs
}

export interface VoiceLoopState {
  generation: number
  status: 'idle' | 'connected' | 'stopped' | 'error'
  profile: 'local' | 'hybrid' | 'cloud'
  mode: 'assistant' | 'live'
  pendingApproval: VoiceApproval | null
  currentTool: string | null
  error: string | null
}

// A separate, non-persisted store per voice session. Never store auth tokens.
export const createVoiceLoopStore = (profile: VoiceLoopState['profile'], mode: VoiceLoopState['mode']) =>
  createStore<VoiceLoopState>(() => ({
    generation: 0, status: 'idle', profile, mode, pendingApproval: null, currentTool: null, error: null,
  }))

export type VoiceLoopStore = ReturnType<typeof createVoiceLoopStore>
