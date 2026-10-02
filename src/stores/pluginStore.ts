import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeJSONStorage } from '../lib/storage-quota'
import type { InstalledPlugin, PluginPermission } from '../api/plugins/types'

interface PluginState {
  installed: Record<string, InstalledPlugin>
  /** Public OAuth app identifier; unlike access tokens, this is not a secret. */
  googleOAuthClientId: string
  install: (manifestId: string) => void
  uninstall: (manifestId: string) => void
  setEnabled: (manifestId: string, enabled: boolean) => void
  setConnected: (manifestId: string, connected: boolean) => void
  setPermission: (manifestId: string, permission: PluginPermission) => void
  setGoogleOAuthClientId: (clientId: string) => void
}

export const usePluginStore = create<PluginState>()(
  persist(
    (set) => ({
      installed: {},
      googleOAuthClientId: '',
      install: (manifestId) => set((state) => ({
        installed: {
          ...state.installed,
          [manifestId]: {
            manifestId,
            enabled: true,
            permission: 'confirm',
            configuredAt: new Date().toISOString(),
          },
        },
      })),
      uninstall: (manifestId) => set((state) => {
        const { [manifestId]: _, ...rest } = state.installed
        return { installed: rest }
      }),
      setEnabled: (manifestId, enabled) => set((state) => ({
        installed: state.installed[manifestId]
          ? { ...state.installed, [manifestId]: { ...state.installed[manifestId], enabled } }
          : state.installed,
      })),
      setConnected: (manifestId, connected) => set((state) => ({
        installed: state.installed[manifestId]
          ? {
              ...state.installed,
              [manifestId]: {
                ...state.installed[manifestId],
                connectedAt: connected ? new Date().toISOString() : undefined,
              },
            }
          : state.installed,
      })),
      setPermission: (manifestId, permission) => set((state) => ({
        installed: state.installed[manifestId]
          ? { ...state.installed, [manifestId]: { ...state.installed[manifestId], permission } }
          : state.installed,
      })),
      setGoogleOAuthClientId: (googleOAuthClientId) => set({ googleOAuthClientId }),
    }),
    {
      name: 'lazarus-plugin-connections',
      storage: safeJSONStorage(),
      // A live adapter connection is process-local. Persisting connectedAt
      // would make a restarted app claim that tools were still registered.
      partialize: (state) => ({
        googleOAuthClientId: state.googleOAuthClientId,
        installed: Object.fromEntries(
          Object.entries(state.installed).map(([id, plugin]) => [id, { ...plugin, connectedAt: undefined }]),
        ),
      }),
    },
  ),
)
