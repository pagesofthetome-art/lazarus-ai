import type { MemoryFile } from '../types/agent-mode'
import { isRecord } from '../types/json-guards'
import type { SyncedMemoryRecord } from '../api/cloud/memory-sync'

export interface MemorySyncBaseline { revision: number; hash: string | null }
export interface MemorySyncPlan {
  pull: Array<{ memory: MemoryFile; baseline: MemorySyncBaseline }>
  remove: Array<{ id: string; baseline: MemorySyncBaseline }>
  push: Array<{ id: string; expectedRevision: number; payload: MemoryFile | null }>
  acknowledge: Array<{ id: string; baseline: MemorySyncBaseline }>
  conflicts: Array<{ id: string; reason: 'both-edited' | 'missing-remote' | 'deleted-baseline' }>
}
const fields = new Set(['id', 'type', 'title', 'description', 'content', 'tags', 'source', 'createdAt', 'updatedAt',
  'sensitive', 'scope', 'sourceKind', 'confirmedAt', 'stale', 'supersededBy', 'supersedesId', 'validFrom'])
const invalid = () => new Error('Invalid synchronized memory data')
const identifier = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128 && v.trim() === v
const stamp = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0

/** Strict boundary for both cloud records and local data before upload. */
export function decodeSyncMemory(raw: unknown): MemoryFile {
  if (!isRecord(raw) || Object.keys(raw).some(key => !fields.has(key)) || !identifier(raw.id) ||
    typeof raw.type !== 'string' || !['user', 'feedback', 'project', 'reference'].includes(raw.type) ||
    typeof raw.title !== 'string' || raw.title.length > 200 ||
    typeof raw.description !== 'string' || raw.description.length > 1000 ||
    typeof raw.content !== 'string' || !raw.content.trim() || raw.content.length > 16000 ||
    typeof raw.source !== 'string' || raw.source.length > 256 ||
    !Array.isArray(raw.tags) || raw.tags.length > 50 || raw.tags.some(tag => typeof tag !== 'string' || tag.length > 100) ||
    !stamp(raw.createdAt) || !stamp(raw.updatedAt)) throw invalid()
  for (const key of ['scope', 'supersededBy', 'supersedesId']) if (raw[key] !== undefined && !identifier(raw[key])) throw invalid()
  for (const key of ['sensitive', 'stale']) if (raw[key] !== undefined && typeof raw[key] !== 'boolean') throw invalid()
  for (const key of ['confirmedAt', 'validFrom']) if (raw[key] !== undefined && !stamp(raw[key])) throw invalid()
  if (raw.sourceKind !== undefined && (typeof raw.sourceKind !== 'string' || !['chat', 'voice', 'screen'].includes(raw.sourceKind))) throw invalid()
  // Fixed key order produces stable hashes, independent of JSON key order.
  const memory: MemoryFile = {
    id: raw.id, type: raw.type as MemoryFile['type'], title: raw.title, description: raw.description,
    content: raw.content, tags: [...raw.tags] as string[], source: raw.source,
    createdAt: raw.createdAt, updatedAt: raw.updatedAt, sensitive: raw.sensitive === true, stale: raw.stale === true,
    scope: raw.scope as string | undefined, sourceKind: raw.sourceKind as MemoryFile['sourceKind'],
    confirmedAt: raw.confirmedAt as number | undefined, supersededBy: raw.supersededBy as string | undefined,
    supersedesId: raw.supersedesId as string | undefined, validFrom: raw.validFrom as number | undefined,
  }
  if (new TextEncoder().encode(JSON.stringify(memory)).length > 32768) throw invalid()
  return memory
}

async function fingerprint(memory: MemoryFile): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(memory)))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function syncMemoryHash(memory: MemoryFile): Promise<string> {
  return fingerprint(decodeSyncMemory(memory))
}

/** Pure three-way comparison. Nothing is persisted, uploaded or applied here.
 * Acknowledgements may be saved only with the corresponding local state.
 * Push revisions must be acknowledged only after the server accepts them. */
export async function planMemorySync(
  localInput: MemoryFile[], baselineInput: Record<string, MemorySyncBaseline>, remoteInput: SyncedMemoryRecord[],
): Promise<MemorySyncPlan> {
  // Snapshot before the first await; concurrent local edits cannot change a plan.
  const local = new Map<string, MemoryFile>()
  for (const raw of localInput) {
    const memory = decodeSyncMemory(raw)
    if (local.has(memory.id)) throw invalid()
    local.set(memory.id, memory)
  }
  const baseline = new Map(Object.entries(baselineInput).map(([id, value]) => {
    if (!identifier(id) || !value || !Number.isSafeInteger(value.revision) || value.revision < 1 ||
      (value.hash !== null && (typeof value.hash !== 'string' || !/^[a-f0-9]{64}$/.test(value.hash)))) throw invalid()
    return [id, { ...value }] as const
  }))
  const remote = new Map<string, { revision: number; memory: MemoryFile | null }>()
  for (const row of remoteInput) {
    if (!identifier(row.memory_id) || remote.has(row.memory_id) || !Number.isSafeInteger(row.revision) || row.revision < 1 ||
      typeof row.deleted !== 'boolean' || (row.deleted && row.payload !== null)) throw invalid()
    const memory = row.deleted ? null : decodeSyncMemory(row.payload)
    if (memory && memory.id !== row.memory_id) throw invalid()
    remote.set(row.memory_id, { revision: row.revision, memory })
  }
  const plan: MemorySyncPlan = { pull: [], remove: [], push: [], acknowledge: [], conflicts: [] }
  for (const id of new Set([...local.keys(), ...baseline.keys(), ...remote.keys()])) {
    const current = local.get(id)
    const base = baseline.get(id)
    const server = remote.get(id)
    const localHash = current ? await fingerprint(current) : null
    if (!server) {
      if (base) plan.conflicts.push({ id, reason: 'missing-remote' })
      else if (current) plan.push.push({ id, expectedRevision: 0, payload: current })
      continue
    }
    if (base && server.revision < base.revision) throw invalid()
    const remoteHash = server.memory ? await fingerprint(server.memory) : null
    if (base && server.revision === base.revision && remoteHash !== base.hash) throw invalid()
    const next = { revision: server.revision, hash: remoteHash }
    if (!server.memory) {
      // Forget wins over pending local edits. Never retain a content copy in
      // conflict metadata for a record the account has explicitly forgotten.
      plan.remove.push({ id, baseline: next })
    } else if (base?.hash === null) {
      plan.conflicts.push({ id, reason: 'deleted-baseline' })
    } else if (!current) {
      if (base) plan.push.push({ id, expectedRevision: server.revision, payload: null })
      else plan.pull.push({ memory: server.memory, baseline: next })
    } else if (localHash === remoteHash) {
      plan.acknowledge.push({ id, baseline: next })
    } else if (base && localHash === base.hash) {
      plan.pull.push({ memory: server.memory, baseline: next })
    } else if (base && remoteHash === base.hash) {
      plan.push.push({ id, expectedRevision: server.revision, payload: current })
    } else {
      plan.conflicts.push({ id, reason: 'both-edited' })
    }
  }
  return plan
}
