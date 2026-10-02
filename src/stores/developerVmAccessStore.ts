import { create } from 'zustand'

interface DeveloperVmAccessState {
  /** Intentionally not persisted: Lazarus restart revokes every capability. */
  tokensByConversation: Record<string, string>
  grant: (conversationId: string, token: string) => void
  revoke: (conversationId: string, token?: string) => void
  tokenFor: (conversationId?: string | null) => string | undefined
}

export const useDeveloperVmAccessStore = create<DeveloperVmAccessState>((set, get) => ({
  tokensByConversation: {},
  grant: (conversationId, token) => set((state) => ({
    tokensByConversation: { ...state.tokensByConversation, [conversationId]: token },
  })),
  revoke: (conversationId, token) => set((state) => {
    const current = state.tokensByConversation[conversationId]
    if (!current || (token && current !== token)) return state
    const { [conversationId]: _removed, ...rest } = state.tokensByConversation
    return { tokensByConversation: rest }
  }),
  tokenFor: (conversationId) => conversationId ? get().tokensByConversation[conversationId] : undefined,
}))
