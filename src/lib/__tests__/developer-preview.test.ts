import { describe, expect, it } from 'vitest'
import { createPreviewState, previewStateAfter } from '../developer-preview'

describe('developer preview lifecycle', () => {
  it('starts stopped and enters running state for a sandbox workspace', () => {
    const state = createPreviewState('sandbox-root')
    expect(state.status).toBe('stopped')
    expect(previewStateAfter(state, 'start').status).toBe('running')
    expect(previewStateAfter(state, 'start').workspaceRoot).toBe('sandbox-root')
  })

  it('records build errors without changing the workspace', () => {
    const state = previewStateAfter(createPreviewState('sandbox-root'), 'start')
    const failed = previewStateAfter(state, 'error', 'build failed')
    expect(failed.status).toBe('error')
    expect(failed.error).toBe('build failed')
    expect(failed.workspaceRoot).toBe('sandbox-root')
  })
})
