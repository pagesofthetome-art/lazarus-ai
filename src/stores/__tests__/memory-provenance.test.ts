import { afterEach, beforeEach, expect, it } from 'vitest'
import { useMemoryStore, __setMemoryEmbedFn } from '../memoryStore'
beforeEach(() => { useMemoryStore.setState({ entries: [] }); __setMemoryEmbedFn(async () => []) })
afterEach(() => __setMemoryEmbedFn())
const add = (content = 'Synthetic fact') => useMemoryStore.getState().addMemory({
  type: 'user', title: 'Fact', description: content, content, tags: [], source: 'original-chat', sourceKind: 'voice', scope: 'p',
})
it('records explicit review, retains it for privacy changes and clears it when the fact changes', () => {
  const id = add()
  const store = useMemoryStore.getState()
  expect(store.entries).toHaveLength(1)
  expect(store.entries[0].confirmedAt).toBeUndefined()
  store.confirmMemory(id)
  const reviewed = useMemoryStore.getState().entries[0].confirmedAt
  expect(reviewed).toBeGreaterThan(0)
  store.updateMemory(id, { sensitive: true })
  expect(useMemoryStore.getState().entries[0].confirmedAt).toBe(reviewed)
  store.updateMemory(id, { content: 'Changed fact' })
  expect(useMemoryStore.getState().entries[0].confirmedAt).toBeUndefined()
  store.confirmMemory(id)
  store.updateMemory(id, { scope: 'different-project' })
  expect(useMemoryStore.getState().entries[0].confirmedAt).toBeUndefined()
})
it('clears human review after an automatic merge and cannot confirm outdated entries', () => {
  const targetId = add()
  const newId = add('New fact')
  useMemoryStore.getState().confirmMemory(targetId)
  useMemoryStore.getState().applyWriteDecision({ action: 'UPDATE', targetId, mergedContent: 'Merged fact' }, { newId })
  useMemoryStore.getState().confirmMemory(newId)
  expect(useMemoryStore.getState().entries.every(entry => entry.confirmedAt === undefined)).toBe(true)
})
it('round trips source identity, modality and review through JSON without inventing legacy metadata', () => {
  const id = add()
  useMemoryStore.getState().confirmMemory(id)
  const original = useMemoryStore.getState().entries[0]
  const json = useMemoryStore.getState().exportAsJSON()
  useMemoryStore.getState().clearAll()
  expect(useMemoryStore.getState().importFromJSON(json).added).toBe(1)
  expect(useMemoryStore.getState().entries[0]).toMatchObject({ source: original.source, sourceKind: 'voice', confirmedAt: original.confirmedAt })
  useMemoryStore.getState().importFromJSON(JSON.stringify([{ content: 'Legacy fact' }, { content: 'Invalid metadata', sourceKind: 'forged', confirmedAt: 1e99 }]))
  for (const entry of useMemoryStore.getState().entries.slice(1)) {
    expect(entry.sourceKind).toBeUndefined()
    expect(entry.confirmedAt).toBeUndefined()
  }
})
