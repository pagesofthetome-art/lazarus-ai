import { useEffect } from 'react'
import { isTauri } from '../api/backend'
import { useRemoteStore } from '../stores/remoteStore'

/** Recover native state on app mount, not only when Remote settings open. */
export function useRemoteRecovery(): void {
  useEffect(() => {
    if (isTauri()) void useRemoteStore.getState().refreshStatus()
  }, [])
}
