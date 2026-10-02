import { describe, expect, it } from 'vitest'
import { createStage, stageOperation, stagePluginOperation, discardStage } from '../developer-staging'

describe('developer staged operations', () => {
  it('records writes without applying them', () => {
    const stage = createStage('session-1')
    const next = stageOperation(stage, { kind: 'file-write', target: 'src/App.tsx', summary: 'change glow' })
    expect(next.operations).toHaveLength(1)
    expect(next.operations[0].target).toBe('src/App.tsx')
    expect(next.applied).toBe(false)
  })

  it('discards staged operations as a new empty stage', () => {
    const stage = stageOperation(createStage('session-1'), { kind: 'plugin-write', target: 'drive/file.txt', summary: 'upload preview' })
    expect(discardStage(stage).operations).toEqual([])
  })

  it('routes plugin writes into the same staging queue', () => {
    const stage = stagePluginOperation(createStage('session-1'), 'drive/file.txt', 'upload preview')
    expect(stage.operations[0].kind).toBe('plugin-write')
  })
})
