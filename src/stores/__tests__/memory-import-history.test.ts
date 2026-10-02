import { afterEach, beforeEach, expect, it } from 'vitest'
import { useMemoryStore, __setMemoryEmbedFn } from '../memoryStore'
beforeEach(() => { useMemoryStore.setState({ entries: [] }); __setMemoryEmbedFn(async () => []) })
afterEach(() => __setMemoryEmbedFn())
it('keeps outdated records excluded and remaps internal history after JSON round trip', async () => {
  const store = useMemoryStore.getState()
  store.importFromJSON(JSON.stringify([
    { id: 'old', content: 'private old fact', supersededBy: 'new' },
    { id: 'new', content: 'private current fact', supersedesId: 'old', validFrom: 1000 },
    { id: 'stale', content: 'private stale fact', stale: true },
  ]))
  const exported = store.exportAsJSON()
  store.clearAll()
  store.importFromJSON(exported)
  const [old, current, stale] = useMemoryStore.getState().entries
  expect(old.supersededBy).toBe(current.id)
  expect(current.supersedesId).toBe(old.id)
  expect(current.validFrom).toBe(1000)
  expect(stale.stale).toBe(true)
  const selected = await store.getMemoryContextAsync('private', 8192)
  expect(selected.memoryIds).toEqual([current.id])
  expect(selected.text).not.toContain('old fact')
  expect(selected.text).not.toContain('stale fact')
})
it('does not bind missing or ambiguous imported history IDs to existing records', () => {
  const store = useMemoryStore.getState()
  store.importFromJSON(JSON.stringify([{ id: 'target', content: 'existing' }]))
  const existingId = useMemoryStore.getState().entries[0].id
  store.importFromJSON(JSON.stringify([
    { content: 'missing replacement', supersededBy: existingId },
    { content: 'ambiguous replacement', supersededBy: 'duplicate' },
    { id: 'duplicate', content: 'first' }, { id: 'duplicate', content: 'second' },
  ]))
  const imported = useMemoryStore.getState().entries.slice(1, 3)
  for (const entry of imported) {
    expect(entry.stale).toBe(true)
    expect(entry.supersededBy).toBeUndefined()
  }
})
