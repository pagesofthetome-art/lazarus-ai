export type PreviewStatus = 'stopped' | 'starting' | 'running' | 'error'

export interface PreviewState {
  readonly workspaceRoot: string
  readonly status: PreviewStatus
  readonly error?: string
}

export type PreviewEvent = 'start' | 'ready' | 'stop' | 'error'

export function createPreviewState(workspaceRoot: string): PreviewState {
  return { workspaceRoot, status: 'stopped' }
}

export function previewStateAfter(state: PreviewState, event: PreviewEvent, error?: string): PreviewState {
  if (event === 'start') return { ...state, status: 'running', error: undefined }
  if (event === 'error') return { ...state, status: 'error', error: error ?? 'Preview failed' }
  return { ...state, status: event === 'ready' ? 'running' : 'stopped', error: undefined }
}
