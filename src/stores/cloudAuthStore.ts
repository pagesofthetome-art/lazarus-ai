// retired hosted service account state. Deliberately NOT persisted: the session itself
// lives in the OS keychain (api/cloud/supabase.ts storage adapter) and
// user/tier/quota are re-derived from /api/me + /api/jobs/quota on boot —
// a persisted copy could only ever be stale.

import { create } from 'zustand'
import type { CloudQuota } from '../lib/render/cloud-jobs'

export interface CloudUser {
  id: string
  email?: string
}

export interface CloudAccount {
  licenseActive: boolean
  /** Canonical tier slug from /api/me, null while signed out/unknown. */
  tier: string | null
  /** Server-driven access gate. Used by the 2.5.7 Max-only closed beta;
   *  the beta is fully open since, so servers now send true for every
   *  licensed account — kept as a kill-switch the server owns. */
  access: boolean
  quota: CloudQuota | null
}

interface CloudAuthState extends CloudAccount {
  paidPlan: boolean | null
  /** Changes across every sign-in/sign-out boundary so in-flight work can be revoked. */
  sessionRevision: number
  /** 'probing' until the keychain session restore + first /api/me resolve. */
  status: 'probing' | 'signed-out' | 'signed-in'
  user: CloudUser | null

  setSignedOut: () => void
  setSignedIn: (user: CloudUser, account: CloudAccount) => void
  setQuota: (quota: CloudQuota | null) => void
}

export const useCloudAuthStore = create<CloudAuthState>()((set) => ({
  status: 'probing',
  user: null,
  licenseActive: false,
  tier: null,
  access: true,
  paidPlan: null,
  sessionRevision: 0,
  quota: null,

  setSignedOut: () =>
    set((state) => ({ status: 'signed-out', user: null, licenseActive: false, tier: null, access: true, paidPlan: null, quota: null, sessionRevision: state.sessionRevision + 1 })),
  setSignedIn: (user, account) =>
    set((state) => ({ status: 'signed-in', user, ...account, paidPlan: account.licenseActive ? true : null, sessionRevision: state.sessionRevision + 1 })),
  setQuota: (quota) => set({ quota }),
}))

/** The whole cloud axis in one predicate: signed in, actively licensed,
 *  through the launch gate, and on a tier whose monthly credit budget is > 0
 *  (self-host tiers report 0). */
export function deriveCloudAvailable(state: {
  user: CloudUser | null
  licenseActive: boolean
  access: boolean
  quota: CloudQuota | null
}): boolean {
  void state
  return false
}
