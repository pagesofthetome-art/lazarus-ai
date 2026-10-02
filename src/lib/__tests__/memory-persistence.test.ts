import { beforeEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ value: null as string | null, write: vi.fn(), confirm: vi.fn() }))
vi.mock('../idbStorage', () => ({
  idbStorage: {
    getItem: () => fixture.value,
    setItem: (_key: string, value: string) => fixture.write(value),
    removeItem: () => { fixture.value = null },
  },
  compareAndSetIdbItem: (_key: string, expected: string, value: string, current: () => boolean) => fixture.confirm(expected, value, current),
}))
const KEY = 'locally-uncensored-memory'
beforeEach(() => {
  vi.resetModules()
  fixture.value = null
  fixture.write.mockReset().mockImplementation((value: string) => { fixture.value = value })
  // Mirrors idbStorage's real compareAndSetIdbItem, which swallows a throw from
  // `current` inside its own try/catch (transaction abort) rather than letting
  // it escape: a caller that hands over a THROWING isCurrent must not rely on
  // this mock to pass it through for free.
  fixture.confirm.mockReset().mockImplementation((expected: string, _value: string, current: () => boolean) => {
    try { return fixture.value === expected && current() } catch { return false }
  })
})

it('serializes normal writes and confirms the requested snapshot before a later write', async () => {
  const { memoryPersistence, flushMemoryPersist } = await import('../memory-persistence')
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  fixture.write.mockImplementationOnce(async (value: string) => { await gate; fixture.value = value })
  memoryPersistence.setItem(KEY, 'first')
  memoryPersistence.setItem(KEY, 'second')
  const confirmation = flushMemoryPersist()
  memoryPersistence.setItem(KEY, 'third')
  expect(fixture.value).toBeNull()
  release()
  expect(await confirmation).toBe('second')
  expect(await memoryPersistence.getItem(KEY)).toBe('third')
  expect(fixture.confirm).toHaveBeenCalledWith('second', 'second', expect.any(Function))
})
it('reports a silently failed backend write and permits a later successful recovery', async () => {
  const { memoryPersistence, flushMemoryPersist } = await import('../memory-persistence')
  fixture.value = 'original'
  fixture.write.mockImplementationOnce(() => {})
  memoryPersistence.setItem(KEY, 'lost')
  await expect(flushMemoryPersist()).rejects.toThrow('Could not confirm saved memories')
  expect(fixture.value).toBe('original')
  memoryPersistence.setItem(KEY, 'recovered')
  expect(await flushMemoryPersist()).toBe('recovered')
})
it('rejects a revoked confirmation without failing subsequent writes', async () => {
  const { memoryPersistence, flushMemoryPersist } = await import('../memory-persistence')
  memoryPersistence.setItem(KEY, 'saved')
  await expect(flushMemoryPersist(() => false)).rejects.toThrow('Memories changed while saving')
  memoryPersistence.setItem(KEY, 'later')
  expect(await flushMemoryPersist()).toBe('later')
})
it('R2-38: a thrown cancellation reason from isCurrent comes out of flushMemoryPersist, not a generic message', async () => {
  const { memoryPersistence, flushMemoryPersist } = await import('../memory-persistence')
  memoryPersistence.setItem(KEY, 'saved')
  const cancelled = new Error('Memory synchronization cancelled. Some changes may already be saved.')
  await expect(flushMemoryPersist(() => { throw cancelled })).rejects.toBe(cancelled)
})
it('rehydration accepts a new authoritative persisted snapshot without stale expectations', async () => {
  const { memoryPersistence, flushMemoryPersist } = await import('../memory-persistence')
  memoryPersistence.setItem(KEY, 'old')
  await flushMemoryPersist()
  fixture.value = 'restored'
  expect(await memoryPersistence.getItem(KEY)).toBe('restored')
  expect(await flushMemoryPersist()).toBe('restored')
})
