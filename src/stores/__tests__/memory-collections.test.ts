import { afterEach, beforeEach, expect, it } from 'vitest'
import { useMemoryStore, __setMemoryEmbedFn } from '../memoryStore'
import { useCloudAuthStore } from '../cloudAuthStore'

const account = { licenseActive: false, tier: null, access: true, quota: null }
const signIn = (id: string) => useCloudAuthStore.getState().setSignedIn({ id }, account)
const add = (content: string) => useMemoryStore.getState().addMemory({ type: 'user', title: content, content, description: '', tags: [], source: 'manual' })

beforeEach(() => {
  useCloudAuthStore.getState().setSignedOut()
  useMemoryStore.setState({ entries: [], localEntries: [], accountCollections: {}, activeMemoryOwner: null, memoryCollectionRevision: 0 })
  __setMemoryEmbedFn(async () => [])
})
afterEach(() => { useCloudAuthStore.getState().setSignedOut(); __setMemoryEmbedFn() })

it('keeps memory local and refuses account collection selection', () => {
  add('Local fact')
  signIn('A')
  expect(useMemoryStore.getState().selectMemoryCollection('A')).toBe(false)
  expect(useMemoryStore.getState().activeMemoryOwner).toBeNull()
  expect(useMemoryStore.getState().entries.map(entry => entry.content)).toEqual(['Local fact'])

  add('Another local fact')
  expect(useMemoryStore.getState().exportAsJSON()).toContain('Local fact')
  expect(useMemoryStore.getState().exportAsJSON()).toContain('Another local fact')
  useCloudAuthStore.getState().setSignedOut()
  expect(useMemoryStore.getState().entries.map(entry => entry.content)).toEqual(['Local fact', 'Another local fact'])
})

it('imports valid legacy account memories to local data without deleting their saved copies', () => {
  add('Local original')
  const local = useMemoryStore.getState().entries
  const legacy = {
    id: 'legacy-account-memory', type: 'user' as const, title: 'Account original',
    description: '', content: 'Account original', tags: [], source: 'manual', createdAt: 1, updatedAt: 1,
  }
  useMemoryStore.setState({ accountCollections: { A: [legacy] } })

  const merge = useMemoryStore.persist.getOptions().merge!
  const restored = merge(undefined, useMemoryStore.getState())
  expect(restored.activeMemoryOwner).toBeNull()
  expect(restored.entries.map(entry => entry.content)).toEqual(['Local original', 'Account original'])
  expect(restored.accountCollections.A).toEqual([legacy])
  expect(local).toHaveLength(1)
})

it('preserves unreadable legacy account data and refuses to select it', () => {
  signIn('A')
  const malformed = [{ invalid: 'preserve this' }]
  useMemoryStore.setState({ accountCollections: { A: malformed } } as unknown as Partial<ReturnType<typeof useMemoryStore.getState>>)
  expect(useMemoryStore.getState().selectMemoryCollection('A')).toBe(false)
  expect(useMemoryStore.getState().accountCollections.A).toBe(malformed)
})

it('keeps large local memories accessible', () => {
  const content = 'x'.repeat(20000)
  add(content)
  expect(useMemoryStore.getState().entries[0].content).toBe(content)
  expect(useMemoryStore.getState().selectMemoryCollection('A')).toBe(false)
  expect(useMemoryStore.getState().entries[0].content).toBe(content)
})

it('captures the local source memory IDs without assigning an account owner', async () => {
  const id = add('A local fact')
  const selected = await useMemoryStore.getState().getMemoryContextAsync('', 8192)
  expect(selected.owner).toBeUndefined()
  expect(selected.memoryIds).toEqual([id])
})

it('does not return a stale retrieval after the memory collection changes', async () => {
  add('Private local fact')
  let release!: (value: number[][]) => void
  __setMemoryEmbedFn(() => new Promise(resolve => { release = resolve }))
  const pending = useMemoryStore.getState().getMemoryContextAsync('private', 8192)
  useMemoryStore.setState(state => ({ memoryCollectionRevision: state.memoryCollectionRevision + 1 }))
  release([])
  expect(await pending).toEqual({ text: '', memoryIds: [] })
})
