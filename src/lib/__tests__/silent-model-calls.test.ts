import { describe, expect, it } from 'vitest'
import { silentCallAllowed, pickSilentCallModel, paramSizeB } from '../silent-model-calls'

describe('silentCallAllowed', () => {
  it('blocks the retired provider even when an old profile opted in', () => {
    expect(silentCallAllowed('lu-cloud', false)).toBe(false)
    expect(silentCallAllowed('lu-cloud', true)).toBe(false)
  })

  it('keeps user-configured and local providers eligible', () => {
    for (const id of ['ollama', 'openai', 'anthropic', 'custom-compatible']) {
      expect(silentCallAllowed(id, false)).toBe(true)
      expect(silentCallAllowed(id, true)).toBe(true)
    }
  })
})

describe('pickSilentCallModel', () => {
  it('keeps background work on the user-selected model', () => {
    const candidates = [
      { name: 'old-catalog-model', type: 'text' },
      { name: 'small-local-model', type: 'text' },
    ]
    expect(pickSilentCallModel('openai::user-selected-model', 'openai', candidates))
      .toBe('openai::user-selected-model')
  })
})

describe('paramSizeB', () => {
  it('reads total parameter counts from model identifiers', () => {
    expect(paramSizeB('Qwen3-30B-A3B')).toBe(30)
    expect(paramSizeB('model-8.5B-instruct')).toBe(8.5)
    expect(paramSizeB('model-without-size')).toBeNull()
  })
})
