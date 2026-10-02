/**
 * Compatibility shape for old hosted-media metadata. Lazarus does not ship a
 * hosted catalog; this list is deliberately empty. Local model discovery is
 * handled by each configured backend.
 */
import type { RenderKind, RenderOp } from './cloud-jobs'
import type { Schema, StudioModel } from './studio-contract'

export interface CloudModel {
  id: string
  label: string
  kind: RenderKind
  api_schema?: Schema
  pricing?: StudioModel['price']
  quote_required?: boolean
  edit?: boolean
  maskless?: boolean
  t2v?: boolean
  i2v?: boolean
  adult?: boolean
  ops?: RenderOp[]
  lora?: boolean
  lipsync_source?: 'image' | 'video'
  lyrics?: boolean
  cfg?: boolean
  negative_prompt?: boolean
  clip?: { short: number; long?: number; durations?: number[] }
  credits?: { base: number; long?: number; per_s?: number; lora?: number; by_duration?: Record<string, number> }
}

export const CLOUD_MODEL_SEED: CloudModel[] = []
