export interface SyncedMemoryRecord {
  memory_id: string
  revision: number
  deleted: boolean
  payload: Record<string, unknown> | null
  updated_at: string
}

export class MemorySyncError extends Error {
  readonly kind: 'account' | 'conflict' | 'network' | 'invalid' | 'cancelled'
  constructor(kind: MemorySyncError['kind'], message: string) {
    super(message)
    this.kind = kind
  }
}

export interface MemorySyncSession {
  assertCurrent(): void
  pull(): Promise<SyncedMemoryRecord[]>
  pullLegacy(): Promise<unknown[]>
  finalizeLegacy(memories: unknown[], revisions: Record<string, number>): Promise<void>
  write(id: string, revision: number, payload: Record<string, unknown> | null): Promise<SyncedMemoryRecord>
}

/** The former account sync endpoint is removed; local memory stays on-device. */
export async function withMemorySyncSession<T>(
  _ownerId: string,
  _work: (session: MemorySyncSession) => Promise<T>,
  _signal?: AbortSignal,
): Promise<T> {
  throw new MemorySyncError('account', 'Account memory sync is not included in Lazarus.')
}
