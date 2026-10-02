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

it('requires the matching signed-in owner and preserves local data', () => {
  add('Local fact')
  expect(useMemoryStore.getState().selectMemoryCollection('A')).toBe(false)
  signIn('A')
  expect(useMemoryStore.getState().selectMemoryCollection('B')).toBe(false)
  expect(useMemoryStore.getState().selectMemoryCollection('A')).toBe(true)
  expect(useMemoryStore.getState().entries).toEqual([])
  add('Account A fact')
  useCloudAuthStore.getState().setSignedOut()
  expect(useMemoryStore.getState().entries.map(e => e.content)).toEqual(['Local fact'])
  expect(useMemoryStore.getState().activeMemoryOwner).toBeNull()
})
it('isolates edits, deletion and exports across two account collections', () => {
  signIn('A')
  useMemoryStore.getState().selectMemoryCollection('A')
  add('Account A fact')
  signIn('B')
  useMemoryStore.getState().selectMemoryCollection('B')
  add('Account B fact')
  expect(useMemoryStore.getState().exportAsJSON()).not.toContain('Account A fact')
  useMemoryStore.getState().clearAll()
  signIn('A')
  useMemoryStore.getState().selectMemoryCollection('A')
  expect(useMemoryStore.getState().entries.map(e => e.content)).toEqual(['Account A fact'])
})
it('preserves unreadable account data and refuses selection', () => {
  signIn('A')
  const malformed = [{ invalid: 'preserve this' }]
  useMemoryStore.setState({ accountCollections: { A: malformed } } as unknown as Partial<ReturnType<typeof useMemoryStore.getState>>)
  expect(useMemoryStore.getState().selectMemoryCollection('A')).toBe(false)
  expect(useMemoryStore.getState().accountCollections.A).toBe(malformed)
})
it('never treats the active account as local data when a hydration read is absent', () => {
  add('Local original')
  signIn('A')
  useMemoryStore.getState().selectMemoryCollection('A')
  add('Account original')
  const merge = useMemoryStore.persist.getOptions().merge!
  const restored = merge(undefined, useMemoryStore.getState())
  expect(restored.activeMemoryOwner).toBeNull()
  expect(restored.entries.map(entry => entry.content)).toEqual(['Local original'])
  expect(restored.accountCollections.A.map(entry => entry.content)).toEqual(['Account original'])
})
it('keeps valid oversized local account records accessible without loosening cloud validation', () => {
  signIn('A')
  useMemoryStore.getState().selectMemoryCollection('A')
  const content = 'x'.repeat(20000)
  add(content)
  useMemoryStore.getState().selectMemoryCollection(null)
  expect(useMemoryStore.getState().selectMemoryCollection('A')).toBe(true)
  expect(useMemoryStore.getState().entries[0].content).toBe(content)
})
it('captures the selected source owner and memory IDs from retrieval', async () => {
  signIn('A')
  useMemoryStore.getState().selectMemoryCollection('A')
  const id = add('Account fact')
  const selected = await useMemoryStore.getState().getMemoryContextAsync('', 8192)
  expect(selected.owner).toBe('A')
  expect(selected.memoryIds).toEqual([id])
})
it('does not substitute another collection after asynchronous retrieval, including A-local-A', async () => {
  signIn('A')
  useMemoryStore.getState().selectMemoryCollection('A')
  add('Private account fact')
  let release!: (value: number[][]) => void
  __setMemoryEmbedFn(() => new Promise(resolve => { release = resolve }))
  const pending = useMemoryStore.getState().getMemoryContextAsync('private', 8192)
  useMemoryStore.getState().selectMemoryCollection(null)
  useMemoryStore.getState().selectMemoryCollection('A')
  release([])
  expect(await pending).toEqual({ text: '', memoryIds: [] })
})
