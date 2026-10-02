import { isTauri } from './backend'

export type AndroidRuntimeStatus = {
  platform: 'android'
  modelsLoaded: boolean
  nativeBackend: string
  storage: string
  capabilities: string[]
}

export function isAndroidRuntime(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
}

/** Reads Android capabilities without loading a model or starting a worker. */
export async function readAndroidRuntimeStatus(): Promise<AndroidRuntimeStatus | null> {
  if (!isTauri() || !isAndroidRuntime()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<AndroidRuntimeStatus>('android_runtime_status')
}
