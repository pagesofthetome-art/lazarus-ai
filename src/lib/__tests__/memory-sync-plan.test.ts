import { expect, it } from 'vitest'
import { decodeSyncMemory, planMemorySync, syncMemoryHash } from '../memory-sync-plan'
import type { MemoryFile } from '../../types/agent-mode'
const memory = (content = 'Original fact'): MemoryFile => ({ id: 'one', type: 'user', title: 'Fact', description: '', content, tags: [], source: 'manual', createdAt: 1, updatedAt: 1 })
const row = (payload: MemoryFile | null, revision = 1) => ({ memory_id: 'one', revision, deleted: payload === null, payload: payload ? { ...payload } : null, updated_at: '2026-09-09T00:00:00Z' })
const baseline = async () => ({ one: { revision: 1, hash: await syncMemoryHash(memory()) } })

it('uploads new local records and downloads new remote records without a fictitious acknowledgement', async () => {
  const outbound = await planMemorySync([memory()], {}, [])
  expect(outbound.push).toEqual([{ id: 'one', expectedRevision: 0, payload: decodeSyncMemory(memory()) }])
  expect(outbound.acknowledge).toEqual([])
  const inbound = await planMemorySync([], {}, [row(memory())])
  expect(inbound.pull[0].memory).toEqual(decodeSyncMemory(memory()))
})
it('uses a stable hash independent of key order and absent false flags', async () => {
  const reordered = Object.fromEntries(Object.entries(memory()).reverse()) as unknown as MemoryFile
  expect(await syncMemoryHash(reordered)).toBe(await syncMemoryHash({ ...memory(), sensitive: false, stale: false }))
  const plan = await planMemorySync([memory()], {}, [row(reordered)])
  expect(plan.acknowledge).toHaveLength(1)
  expect(plan.push).toEqual([])
})
it('pulls remote-only edits and pushes local-only edits against the observed revision', async () => {
  const base = await baseline()
  expect((await planMemorySync([memory()], base, [row(memory('Remote edit'), 2)])).pull).toHaveLength(1)
  const plan = await planMemorySync([memory('Local edit')], base, [row(memory())])
  expect(plan.push[0]).toMatchObject({ expectedRevision: 1, payload: { content: 'Local edit' } })
})
it('does not silently merge both-edited records or store private content in conflict metadata', async () => {
  const plan = await planMemorySync([memory('Private local edit')], await baseline(), [row(memory('Private remote edit'), 2)])
  expect(plan.conflicts).toEqual([{ id: 'one', reason: 'both-edited' }])
  expect(plan.push).toEqual([])
  expect(plan.pull).toEqual([])
  expect(JSON.stringify(plan)).not.toContain('Private')
})
it('remote forgetting wins over pending local edits without retaining the old content', async () => {
  const plan = await planMemorySync([memory('Private pending edit')], await baseline(), [row(null, 2)])
  expect(plan.remove).toEqual([{ id: 'one', baseline: { revision: 2, hash: null } }])
  expect(JSON.stringify(plan)).not.toContain('Private')
  expect(plan.push).toEqual([])
})
it('propagates local deletion using the current remote revision', async () => {
  const plan = await planMemorySync([], await baseline(), [row(memory('Remote edit'), 2)])
  expect(plan.push).toEqual([{ id: 'one', expectedRevision: 2, payload: null }])
})
it('does not recreate missing remote records or accept a revived tombstone', async () => {
  expect((await planMemorySync([memory()], await baseline(), [])).conflicts[0].reason).toBe('missing-remote')
  expect((await planMemorySync([], { one: { revision: 1, hash: null } }, [row(memory(), 2)])).conflicts[0].reason).toBe('deleted-baseline')
})
it('rejects revision rollback and content changes under an unchanged revision', async () => {
  await expect(planMemorySync([memory()], await baseline(), [row(memory('Undocumented edit'))])).rejects.toThrow('Invalid synchronized memory data')
  await expect(planMemorySync([memory()], { one: { revision: 2, hash: await syncMemoryHash(memory()) } }, [row(memory())])).rejects.toThrow()
})
it('rejects malformed privacy, scope, provenance, duplicate IDs and unknown fields', async () => {
  for (const extra of [{ sensitive: 'true' }, { scope: null }, { sourceKind: 'unknown' }, { syncOwnerId: 'another' }, { confirmedAt: -1 }]) {
    expect(() => decodeSyncMemory({ ...memory(), ...extra })).toThrow()
  }
  await expect(planMemorySync([memory(), memory()], {}, [])).rejects.toThrow()
  await expect(planMemorySync([], {}, [row(memory()), row(memory())])).rejects.toThrow()
})
it('snapshots local, remote and baseline inputs before hashing yields', async () => {
  const local = memory('Local edit')
  const base = await baseline()
  const remote = row(memory())
  const planned = planMemorySync([local], base, [remote])
  local.content = 'Changed after start'
  remote.payload!.content = 'Changed server snapshot'
  base.one.revision = 100
  expect((await planned).push[0].payload?.content).toBe('Local edit')
})
