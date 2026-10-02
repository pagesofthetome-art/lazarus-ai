export type StageOperationKind = 'file-write' | 'file-delete' | 'plugin-write' | 'upload' | 'download'

export interface StageOperation {
  readonly kind: StageOperationKind
  readonly target: string
  readonly summary: string
}

export interface DeveloperStage {
  readonly sessionId: string
  readonly operations: readonly StageOperation[]
  readonly applied: boolean
}

export function createStage(sessionId: string): DeveloperStage {
  return { sessionId, operations: [], applied: false }
}

export function stageOperation(stage: DeveloperStage, operation: StageOperation): DeveloperStage {
  return { ...stage, operations: [...stage.operations, operation], applied: false }
}

/** Route a plugin-side effect into the same sandbox queue as file changes. */
export function stagePluginOperation(stage: DeveloperStage, target: string, summary: string): DeveloperStage {
  return stageOperation(stage, { kind: 'plugin-write', target, summary })
}

export function discardStage(stage: DeveloperStage): DeveloperStage {
  return { ...stage, operations: [], applied: false }
}
