import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeJSONStorage } from '../lib/storage-quota'

/**
 * Tracks which installed Ollama models have stale manifests (rejected by
 * Ollama 0.20.7 with "does not support (chat|completion|generate)").
 *
 * Populated by the startup health scan (AppShell) and consumed by:
 *   - StaleModelsBanner — top-of-app notice with "Refresh All"
 *   - Header Lichtschalter — knows without a load attempt that the model is stale
 *   - DiscoverModels — shows "Needs Refresh" badge instead of green "Installed"
 *
 * `dismissed` is PERSISTED, as of 2.5.9 (a3b05a44): see the note on
 * `partialize` below for why, and `setStaleModels` for the one thing that
 * clears it again. `lastScanTime` is persisted so we can skip re-scan for a
 * cool-down window on app restart.
 */

interface ModelHealthState {
  staleModels: string[]
  lastScanTime: number
  scanning: boolean
  dismissed: boolean
  // actions
  setStaleModels: (models: string[]) => void
  markFresh: (name: string) => void
  setScanning: (scanning: boolean) => void
  dismiss: () => void
  reset: () => void
}

export const useModelHealthStore = create<ModelHealthState>()(
  persist(
    (set) => ({
      staleModels: [],
      lastScanTime: 0,
      scanning: false,
      dismissed: false,
      // Only un-dismiss when the stale set actually CHANGED. The health scan
      // runs once per launch, so clearing the flag unconditionally meant the
      // banner returned on every start over the same untouched model and
      // "dismiss" was decorative.
      //
      // R2-40: `same` fiel bei jeder Laengenaenderung, also auch beim
      // SCHRUMPFEN. Wer ein veraltetes Modell aktualisierte, bekam den eben
      // weggeklickten Hinweis fuer die uebrigen sofort wieder, obwohl die
      // Beschriftung genau das ausschliesst: "Dismiss. It comes back only when
      // a different model goes stale." Zurueckgesetzt wird deshalb nur, wenn
      // wirklich ein Modell dazugekommen ist, das vorher nicht dabei war.
      setStaleModels: (models) =>
        set((s) => ({
          staleModels: models,
          lastScanTime: Date.now(),
          dismissed: models.some((m) => !s.staleModels.includes(m)) ? false : s.dismissed,
        })),
      markFresh: (name) =>
        set((s) => ({ staleModels: s.staleModels.filter((m) => m !== name) })),
      setScanning: (scanning) => set({ scanning }),
      dismiss: () => set({ dismissed: true }),
      reset: () =>
        set({ staleModels: [], scanning: false, dismissed: false, lastScanTime: 0 }),
    }),
    {
      name: 'locally-uncensored-model-health',
      storage: safeJSONStorage(),
      // `dismissed` persists as of 2.5.9: the banner re-ran its startup scan and
      // came back on EVERY launch while a stale model sat on disk, so closing it
      // meant nothing. A fresh scan that finds stale models clears the flag
      // again (setStaleModels), so a genuinely new problem still speaks up.
      // `scanning` stays session-only — a crash mid-scan must not persist as
      // "still scanning".
      partialize: (s) => ({ staleModels: s.staleModels, lastScanTime: s.lastScanTime, dismissed: s.dismissed }),
    }
  )
)
