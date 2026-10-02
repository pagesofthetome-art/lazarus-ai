export type DeveloperSessionStatus = 'starting' | 'ready' | 'applying' | 'discarding' | 'failed'

export interface DeveloperSession {
  readonly id: string
  readonly workspaceRoot: string
  readonly backupName: string
  readonly status: DeveloperSessionStatus
  readonly modelsLoaded: readonly string[]
}

export function createDeveloperSession(workspaceRoot: string, backupName: string, id = crypto.randomUUID()): DeveloperSession {
  return { id, workspaceRoot, backupName, status: 'starting', modelsLoaded: [] }
}

export function transitionDeveloperSession(session: DeveloperSession, status: DeveloperSessionStatus): DeveloperSession {
  return { ...session, status }
}

export function rotateBackupNames(names: readonly string[], keep = 2): string[] {
  const count = Math.max(0, Math.floor(keep))
  return count === 0 ? [] : names.slice(-count)
}
