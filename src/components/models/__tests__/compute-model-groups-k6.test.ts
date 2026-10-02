/**
 * K6 (3.0.1): GitHub locally-uncensored #132, AppImage/Ubuntu 24.04,
 * "closing... it looks like it adds models and then breaks the selection
 * field... it's fixed by restarting". A restart-only fix for a component with
 * no error boundary of its own is the signature of an uncaught render throw:
 * ChatView wraps the WHOLE chat area in one ErrorBoundary, so one bad row
 * from a freshly finished download would take the entire chat view down,
 * and only a full remount clears a tripped error boundary.
 *
 * computeModelGroups is the extracted, testable core: grouping wrapped in a
 * try/catch that falls back to a flat list instead of throwing, with a log
 * line naming the models in play.
 *
 * Run: npx vitest run src/components/models/__tests__/compute-model-groups-k6.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AIModel } from '../../../types/models'

vi.mock('../../../lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

// A deterministic stand-in for "something in the real grouping pipeline
// threw", the point of this test is the try/catch in computeModelGroups
// itself, not any particular crash in splitBackendSwitchRows (which is
// defensively written elsewhere in this codebase; the mock proves the SAFETY
// NET works regardless of whether today's helper code happens to have a
// hole tomorrow, a freshly downloaded, not-yet-fully-normalized model entry
// is exactly the kind of value that could reach it).
let throwOnSplit = false
vi.mock('../../../lib/lazarus-engine-rows', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/lazarus-engine-rows')>()
  return {
    ...actual,
    splitBackendSwitchRows: (...args: Parameters<typeof actual.splitBackendSwitchRows>) => {
      if (throwOnSplit) throw new TypeError("Cannot read properties of undefined (reading 'toLowerCase')")
      return actual.splitBackendSwitchRows(...args)
    },
  }
})

const { computeModelGroups } = await import('../ModelSelector')

function textModel(name: string): AIModel {
  return {
    name, model: name, size: 0, digest: '', modified_at: '',
    details: { parent_model: '', format: '', family: '', families: [], parameter_size: '', quantization_level: '' },
    type: 'text', provider: 'ollama', providerName: 'Ollama',
  } as AIModel
}

describe('K6: computeModelGroups never crashes the picker', () => {
  beforeEach(() => { vi.clearAllMocks(); throwOnSplit = false })

  it('groups normally when nothing throws', () => {
    const models = [textModel('qwen2.5-0.5b-instruct'), textModel('llama3.1:8b')]
    const { groups, groupingFailed } = computeModelGroups(models, false, null, null)
    expect(groupingFailed).toBe(false)
    expect(groups.flatMap((g) => g.models)).toHaveLength(2)
  })

  it('a throw during grouping falls back to one flat list instead of propagating', () => {
    throwOnSplit = true
    const models = [textModel('qwen2.5-0.5b-instruct'), textModel('llama3.1:8b')]
    expect(() => computeModelGroups(models, false, null, null)).not.toThrow()
    const { groups, groupingFailed, showHeadings } = computeModelGroups(models, false, null, null)
    expect(groupingFailed).toBe(true)
    expect(showHeadings).toBe(false)
    // Nothing is lost, the fallback is flat, not empty. This is the
    // difference between "the picker looks a little plain" and "the picker
    // (and with it the whole chat view, see ChatView's ErrorBoundary) is
    // gone until the user restarts the app".
    expect(groups).toHaveLength(1)
    expect(groups.flatMap((g) => g.models)).toHaveLength(2)
  })

  it('logs which models were in play, so the next report carries a real trace', async () => {
    throwOnSplit = true
    const { log } = await import('../../../lib/logger')
    computeModelGroups([textModel('broken-model')], false, null, null)
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('grouping the model list threw'),
      expect.objectContaining({ modelNames: ['broken-model'] }),
    )
  })

  it('an empty model list is not an error, just an empty result', () => {
    const { groups, groupingFailed } = computeModelGroups([], false, null, null)
    expect(groupingFailed).toBe(false)
    expect(groups).toEqual([])
  })
})
