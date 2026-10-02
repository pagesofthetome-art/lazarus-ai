import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useMemoryStore, __setMemoryEmbedFn } from '../memoryStore'
import { loadVectors, saveVector } from '../../lib/memoryEmbedDB'

vi.mock('../../lib/memoryEmbedDB', () => ({
  loadVectors: vi.fn(async () => new Map()),
  saveVector: vi.fn(async () => undefined),
  deleteVector: vi.fn(async () => undefined),
  clearAll: vi.fn(async () => undefined),
}))

beforeEach(() => {
  vi.clearAllMocks()
  useMemoryStore.setState({ entries: [] })
  __setMemoryEmbedFn(async () => [])
})
afterEach(() => __setMemoryEmbedFn())

function seed() {
  return useMemoryStore.getState().addMemory({
    type: 'user', title: 'Preference', description: 'Tea', content: 'Prefers tea',
    tags: [], source: 'chat',
  })
}

for (const action of ['delete', 'clear', 'edit'] as const) {
  it(`does not inject the old snapshot after ${action} during retrieval`, async () => {
    const id = seed()
    await Promise.resolve()
    let finish!: (value: number[][]) => void
    __setMemoryEmbedFn(() => new Promise(resolve => { finish = resolve }))
    vi.mocked(loadVectors).mockResolvedValue(new Map([[id, {
      model: 'test', dim: 2, vector: [1, 0], contentHash: 'test',
    }]]))
    const result = useMemoryStore.getState().getMemoriesForPromptAsync('tea', 8192)
    if (action === 'delete') useMemoryStore.getState().removeMemory(id)
    if (action === 'clear') useMemoryStore.getState().clearAll()
    if (action === 'edit') useMemoryStore.getState().updateMemory(id, { content: 'Prefers coffee' })
    finish([[1, 0]])
    expect(await result).not.toContain('Prefers tea')
  })
}

it('does not start embedding a memory deleted while waiting for cached vectors', async () => {
  const embed = vi.fn(async () => [[1, 0]])
  __setMemoryEmbedFn(embed)
  const id = seed()
  useMemoryStore.getState().removeMemory(id)
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(embed).not.toHaveBeenCalled()
  expect(saveVector).not.toHaveBeenCalled()
})

it('checks current memory identity and content at vector write time', async () => {
  __setMemoryEmbedFn(async () => [[1, 0]])
  const id = seed()
  await vi.waitFor(() => expect(saveVector).toHaveBeenCalled())
  const guard = vi.mocked(saveVector).mock.calls.at(-1)![2]!
  expect(guard()).toBe(true)
  useMemoryStore.getState().removeMemory(id)
  expect(guard()).toBe(false)
})
