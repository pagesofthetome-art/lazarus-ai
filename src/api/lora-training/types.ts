/** Portable training contracts. Keep runtime and UI dependencies in adapters. */
export type LoraTrainerId =
  | 'zimage-character-local'
  | 'sdxl-local'
  | 'flux-local'
  | 'text-qlora-local'
  | 'cloud-image'
  | 'cloud-text'
  | (string & {})

export type LoraTrainingTask = 'image' | 'text' | 'code'
export type LoraTrainingIntent = 'character' | 'style' | 'subject' | 'other'

export type LoraDatasetSource =
  | { type: 'file'; path: string; caption?: string }
  | { type: 'gallery'; id: string; path: string; caption?: string }
  | { type: 'folder'; path: string }
  | { type: 'url'; url: string }
  | { type: 'search'; query: string }

export interface LoraTrainingRequest {
  goal: string
  /** Omission means image training. */
  task?: LoraTrainingTask
  intent?: LoraTrainingIntent
  targetModel?: { id?: string; name?: string; family?: string }
  sources: readonly LoraDatasetSource[]
  triggerWord?: string
  outputName?: string
  /** Omission permits public web research when examples are missing. */
  autonomousResearch?: boolean
}

export interface LoraTrainingModel {
  id: string
  name: string
  /** Normalized architecture; null means compatibility is unverified. */
  family: string | null
  task: LoraTrainingTask
  installed: boolean
  createSupported: boolean
  path?: string
}

export interface LoraTrainerReadiness {
  runtimeReady: boolean
  basesReady: boolean
  reason?: string
}

export interface LoraTrainingEnvironment {
  models: readonly LoraTrainingModel[]
  hardware: {
    /** null means unverified, and must not be treated as available. */
    gpuAvailable: boolean | null
    gpuName?: string
    vramGb: number | null
    ramGb: number | null
    freeDiskGb: number | null
  }
  trainerStatuses: Readonly<Partial<Record<LoraTrainerId, LoraTrainerReadiness>>>
  loraDirectory?: string
}

export interface LoraSourceManifestEntry {
  url?: string
  path?: string
  retrievedAt: string
  hash?: string
  perceptualHash?: string
  status: 'accepted' | 'rejected'
  reason: string
  license?: string
}

export interface LoraDatasetItem {
  path: string
  caption: string
  source?: LoraSourceManifestEntry
}

export interface LoraTrainingDataset {
  /** Runtime staging identifier, once the adapter has staged its inputs. */
  setId?: string
  items: readonly LoraDatasetItem[]
  manifest: readonly LoraSourceManifestEntry[]
  summary: string
  minimumItems: number
}

export interface LoraTrainingAdvancedSettings {
  steps?: number
  rank?: number
  learningRate?: number
  resolution?: number
  precision?: string
  /** Adapter-specific scalar settings; never credentials or executable code. */
  extra?: Readonly<Record<string, string | number | boolean>>
}

export interface LoraTrainingPlan {
  id: string
  adapterId: LoraTrainerId
  task: LoraTrainingTask
  baseModel: LoraTrainingModel
  dataset: LoraTrainingDataset
  triggerWord: string
  outputName: string
  estimatedResources: {
    vramGb: number | null
    ramGb: number | null
    diskGb: number | null
    durationMinutes: { min: number; max: number } | null
  }
  explanation: string
  rejectedAlternative?: string
  advancedSettings: LoraTrainingAdvancedSettings
}

export type LoraTrainingState =
  | 'unsupported' | 'missing-input' | 'ready' | 'running'
  | 'complete' | 'cancelled' | 'error'

export interface LoraTrainingOutput {
  path: string
  family: string
  task: LoraTrainingTask
  triggerWord?: string
  sizeBytes?: number
  metadata?: Readonly<Record<string, string>>
}

interface LoraTrainingStatusDetails {
  jobId?: string
  adapterId?: LoraTrainerId
  phase?: string
  logs: readonly string[]
  step?: number
  totalSteps?: number
  /** Progress from 0 to 100; omitted when the duration is unknown. */
  progress?: number
  message: string
}

export type LoraTrainingStatus = LoraTrainingStatusDetails & (
  | { status: 'unsupported' | 'missing-input' | 'ready' | 'running' | 'cancelled' | 'error'; output?: never }
  /** Adapters report completion only after validateOutput succeeds. */
  | { status: 'complete'; output: LoraTrainingOutput }
)

export type LoraMissingInput = 'goal' | 'dataset' | 'base-model' | 'runtime' | 'hardware' | 'cloud-provider'

export interface LoraTrainerCompatibility {
  status: 'unsupported' | 'missing-input' | 'ready'
  /** Higher scores win among adapters with the same readiness state. */
  score: number
  reason: string
  baseModel?: LoraTrainingModel
  missingInputs?: readonly LoraMissingInput[]
}

export type LoraTrainingPreparation =
  | { status: 'ready'; plan: LoraTrainingPlan }
  | { status: 'unsupported' | 'missing-input' | 'error'; reason: string; missingInputs?: readonly LoraMissingInput[] }

export type LoraOutputValidation =
  | { valid: true; output: LoraTrainingOutput }
  | { valid: false; reason: string }

export interface LoraTrainingCallbacks {
  onStatus?: (status: LoraTrainingStatus) => void
  onLog?: (line: string) => void
  signal?: AbortSignal
}

export interface LoraTrainerAdapter {
  id: LoraTrainerId
  label: string
  execution: 'local' | 'cloud'
  canTrain(request: LoraTrainingRequest, environment: LoraTrainingEnvironment):
    LoraTrainerCompatibility | Promise<LoraTrainerCompatibility>
  prepare(request: LoraTrainingRequest, environment: LoraTrainingEnvironment): Promise<LoraTrainingPreparation>
  run(plan: LoraTrainingPlan, callbacks: LoraTrainingCallbacks): Promise<LoraTrainingStatus>
  validateOutput(output: LoraTrainingOutput, plan: LoraTrainingPlan): Promise<LoraOutputValidation>
}

export interface LoraTrainerCandidate {
  adapter: LoraTrainerAdapter
  compatibility: LoraTrainerCompatibility
}

export interface LoraTrainerSelection {
  status: 'ready' | 'missing-input' | 'unsupported' | 'error'
  adapter: LoraTrainerAdapter | null
  candidates: readonly LoraTrainerCandidate[]
  reason: string
}
