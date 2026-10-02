import type { CreateIntent } from '../../stores/createStore'
import { STUDIO_MODELS, studioBaseCredits, studioPreviewCredits } from './studio-contract'
import { presetModels, requiredRoleInputs, type PresetModel, type StepRole } from './preset-models'

/** Compatibility type for drafts made by versions that included hosted media. */
export type StudioIntent = CreateIntent | 'video_upscale'

const INTENT_ROLE: Partial<Record<StudioIntent, StepRole[]>> = {
  lipsync: ['talking', 'presenter'],
  music: ['music'],
  extend: ['extend'],
  motion: ['motion'],
  video_upscale: ['upscale'],
}

export function intentRoles(intent: StudioIntent): StepRole[] {
  return INTENT_ROLE[intent] ?? []
}

export function intentRoleFor(intent: StudioIntent, model: string): StepRole | undefined {
  return intentRoles(intent).find((role) => presetModels(role).some((entry) => entry.id === model))
}

/** The hosted media picker is retired and ships no entries. */
export function intentPickerModels(_intent: StudioIntent): PresetModel[] {
  return []
}

/** Keep a saved selection readable; the retired picker cannot substitute a model. */
export function resolveIntentPick(_intent: StudioIntent, picked: string): string {
  return picked
}

export function isStudioModel(id: string): boolean {
  return Object.hasOwn(STUDIO_MODELS, id)
}

export function intentRequiredInputs(intent: StudioIntent, model: string): string[] {
  const role = intentRoleFor(intent, model)
  return role ? requiredRoleInputs(role, model) : []
}

export function createStudioCost(
  model: string,
  options: Record<string, unknown>,
  promptLength = 100,
  seconds?: number,
): number {
  return studioPreviewCredits(model, options, seconds, 1, promptLength) ?? studioBaseCredits(model)
}

export function pricesByInput(model: string): boolean {
  const mode = STUDIO_MODELS[model]?.price.mode
  return mode === 'input' || mode === 'both'
}
