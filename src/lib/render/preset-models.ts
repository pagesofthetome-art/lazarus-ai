import { STUDIO_MODELS } from './studio-contract'
import type { RenderKind, RenderOp } from './cloud-jobs'

/** Workflow roles retained for saved Create drafts from older versions. */
export type StepRole =
  | 'image' | 'animate' | 'soundtrack' | 'speech' | 'music' | 'talking' | 'presenter'
  | 'duo' | 'extend' | 'motion' | 'restyle' | 'angles' | 'edit' | 'upscale'

export interface PresetModel {
  id: string
  label: string
  kind: RenderKind
  op: RenderOp
  adult: boolean
}

const ROLES: StepRole[] = [
  'image', 'animate', 'soundtrack', 'speech', 'music', 'talking', 'presenter',
  'duo', 'extend', 'motion', 'restyle', 'angles', 'edit', 'upscale',
]

/** Lazarus has no built-in hosted model list. Preserved drafts resolve to no selectable model. */
export function presetModels(_role: StepRole, _openOnly = false): PresetModel[] {
  return []
}

export function modelHint(_id: string): string | undefined {
  return undefined
}

export function presetModel(_role: StepRole, _id: string): PresetModel | undefined {
  return undefined
}

/** Local Create does not stage remote job inputs. */
export function classicInputs(_role: StepRole, _id: string): Record<string, string> {
  return {}
}

export function roleInputs(_role: StepRole, id: string): Record<string, string> {
  return STUDIO_MODELS[id]?.inputs ?? {}
}

export function requiredRoleInputs(_role: StepRole, id: string): string[] {
  return Object.keys(STUDIO_MODELS[id]?.inputs ?? {})
}

export function rolePrompts(role: StepRole): boolean {
  return ['image', 'animate', 'speech', 'music', 'extend', 'edit', 'restyle'].includes(role)
}

export function roleHasChoice(_role: StepRole, _openOnly = false): boolean {
  return false
}

export const ALL_ROLES: StepRole[] = ROLES

export function roleForModel(_id: string): StepRole | undefined {
  return undefined
}

export function classicCredits(
  _kind: RenderKind,
  _model: string,
  _op: RenderOp,
  _params: { frames?: number; fps?: number; duration?: number; target_resolution?: string },
): number | null {
  return null
}

/** Return the identifier when displaying a legacy result with no model metadata. */
export function modelLabel(id: string): string {
  return STUDIO_MODELS[id]?.label ?? id
}
