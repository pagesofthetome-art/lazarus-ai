import type { AIModel } from '../types/models'

/**
 * Is this inventory row a file out of ComfyUI's `loras` folder?
 *
 * The `source` field is carried all the way from `api/comfyui`'s addon lanes
 * (useModels keeps it now); without it a LoRA and a checkpoint are the same
 * shape, both `type: 'image'`, both a file under `ComfyUI/models`.
 *
 * It lives in lib rather than beside the Models view because two very
 * different callers need the same answer: the view, which lists LoRAs on their
 * own rail, and the model store, which must never let one become the active
 * model. A LoRA is not a model you switch to.
 */
export function isLoraRow(m: AIModel): boolean {
  return 'source' in m && m.source === 'lora'
}
