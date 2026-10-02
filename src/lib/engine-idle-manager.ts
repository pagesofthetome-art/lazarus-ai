/**
 * Automatic rest mode for the app-managed Lazarus Engine.
 *
 * The UI stays alive; only llama-server is stopped. The existing pre-send
 * ensureBuiltinEngineAlive() path wakes it transparently on the next request.
 * We deliberately use the app's reconciled run registry so chat, Agent,
 * Coding Agent, queued work and tool execution all prevent an idle unload.
 */
import { backendCall } from '../api/backend'
import { runsActive, subscribeRuns } from './run-idle'
import { useProviderStore } from '../stores/providerStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useEngineLifecycleStore } from '../stores/engineLifecycleStore'

let timer: ReturnType<typeof setTimeout> | null = null
let stopping = false

function clearTimer(): void {
  if (timer !== null) clearTimeout(timer)
  timer = null
}

function managedEngineEnabled(): boolean {
  const p = useProviderStore.getState().providers.openai
  return !!p?.enabled && p.managed === true
}

async function sleepManagedEngine(): Promise<void> {
  if (stopping || runsActive() || !managedEngineEnabled()) return
  stopping = true
  useEngineLifecycleStore.getState().setState('unloading')
  try {
    const status = await backendCall<{ running?: boolean }>('bundled_engine_status')
    // Re-check after the await: a user may have started a request meanwhile.
    if (runsActive()) {
      useEngineLifecycleStore.getState().setState('working')
      return
    }
    if (status?.running) await backendCall('stop_bundled_engine')
    useEngineLifecycleStore.getState().setState('sleeping')
  } catch {
    // A failed idle stop must never break chat. Leave the engine usable.
    useEngineLifecycleStore.getState().setState('ready')
  } finally {
    stopping = false
  }
}

function schedule(): void {
  clearTimer()
  if (runsActive()) {
    useEngineLifecycleStore.getState().setState('working')
    return
  }
  const minutes = useSettingsStore.getState().settings.engineIdleTimeoutMinutes ?? 0
  if (!Number.isFinite(minutes) || minutes <= 0 || !managedEngineEnabled()) return
  useEngineLifecycleStore.getState().setState('ready')
  timer = setTimeout(() => { void sleepManagedEngine() }, minutes * 60_000)
}

/** Mount once at app-shell level. Returns cleanup. */
export function startEngineIdleManager(): () => void {
  schedule()
  const unsubRuns = subscribeRuns(schedule)
  const unsubSettings = useSettingsStore.subscribe(schedule)
  const unsubProviders = useProviderStore.subscribe(schedule)
  return () => {
    clearTimer()
    unsubRuns()
    unsubSettings()
    unsubProviders()
  }
}
