import type { RenderKind, RenderOp } from './cloud-jobs'
import type { StepRole } from './preset-models'

export interface PresetStep { model: string; kind: RenderKind; op: RenderOp; title: string; role: StepRole; models?: string[] }
export interface CreatePreset {
  id: string
  title: string
  summary: string
  category: 'Character' | 'Horror' | 'Product' | 'Video' | 'Audio'
  adult: boolean
  accent: string
  steps: PresetStep[]
  note?: string
}

// Lazarus ships no first-party hosted model catalog or hosted generation presets.
export const CREATE_PRESETS: CreatePreset[] = []

export function presetBaseCredits(_preset: CreatePreset): number | null {
  return null
}