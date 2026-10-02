import type { ProviderId } from '../api/providers/types'

// Text model (Ollama or cloud provider)
export interface OllamaModel {
  name: string
  model: string
  size: number
  digest: string
  modified_at: string
  details: {
    parent_model: string
    format: string
    family: string
    families: string[]
    parameter_size: string
    quantization_level: string
  }
  type: 'text'
  provider?: ProviderId       // 'ollama' | 'openai' | 'anthropic'
  providerName?: string       // Display: "Ollama", "OpenRouter", "Anthropic"
  contextLength?: number      // Known context window size
  supportsTools?: boolean     // Native tool calling support
}

// Cloud text model (OpenAI-compat or Anthropic) — lighter than OllamaModel
export interface CloudModel {
  /** Gemessenes Inhaltsverhalten aus dem Server-Katalog (retired hosted service /models
   *  `unfiltered`), nie aus dem Modellnamen geraten. 'full' = das Modell
   *  antwortet ohne Ablehnung. Fehlt das Feld, ist nichts gemessen und nichts
   *  versprochen. */
  unfiltered?: 'full' | 'partial'

  name: string
  model: string
  size: number
  type: 'text'
  provider: ProviderId
  providerName: string
  contextLength?: number
  supportsTools?: boolean
  supportsVision?: boolean
  thinkMode?: 'toggle' | 'always' | 'never'
  /** The reasoning rungs this model accepts, ascending, and the rung it
   *  defaults to (retired hosted service /models). Absent = no effort control and the old
   *  fixed behaviour. See lib/effort.ts. */
  effortLevels?: string[]
  effortDefault?: string
  /** Friendly picker label when the server provides one (retired hosted service /models
   *  `name`) — pickers fall back to the raw id otherwise. */
  displayName?: string
  /** Where the file lies, for a row that IS a file: the Lazarus Engine's GGUFs.
   *  Absent for everything served over a network API. Two rows naming one
   *  path are one model however differently the two backends spell its name,
   *  which is what the Installed list uses to stop showing it twice. */
  path?: string
}

/**
 * Which ComfyUI models folder a listed file was enumerated out of.
 *
 * THE definition of that set, and it lives here rather than in `api/comfyui`
 * because the inventory rows carry it all the way into the views: a LoRA and a
 * checkpoint are both files under `ComfyUI/models`, they are both `type:
 * 'image'`, and only this field tells them apart. It used to be dropped the
 * moment the inventory became `AIModel`, which is why LoRAs sat nameless
 * between the checkpoints in the Image tab and could be clicked as if one of
 * them were a main model.
 *
 * `api/comfyui` narrows this to its addon half (`AddonSource`) instead of
 * spelling the names a second time.
 */
export type ComfyModelSource =
  | 'checkpoint' | 'diffusion_model' | 'motion_module'
  | 'lora' | 'vae' | 'text_encoder'
  | 'clip_vision' | 'controlnet' | 'upscale_model' | 'embedding' | 'style_model'

// Image model (e.g. Stable Diffusion, SDXL, Fooocus, ComfyUI)
export interface ImageModel {
  name: string
  model: string
  size: number
  format: string
  architecture: string
  previewUrl?: string
  tags?: string[]
  license?: string
  updated_at?: string
  compatibleWith?: string[]
  type: 'image'
  provider?: ProviderId
  providerName?: string
  /** Set for rows the ComfyUI inventory produced, absent for everything else. */
  source?: ComfyModelSource
}

// Video model (e.g. SVD, AnimateDiff, VideoCrafter, ComfyUI)
export interface VideoModel {
  name: string
  model: string
  size: number
  format: string
  architecture: string
  previewUrl?: string
  tags?: string[]
  license?: string
  updated_at?: string
  compatibleWith?: string[]
  type: 'video'
  provider?: ProviderId
  providerName?: string
  /** Set for rows the ComfyUI inventory produced, absent for everything else. */
  source?: ComfyModelSource
}

// Generic model type
export type AIModel = OllamaModel | CloudModel | ImageModel | VideoModel;

export interface PullProgress {
  status: string
  digest?: string
  total?: number
  completed?: number
  // Ollama can stream an `{"error": "..."}` line mid-pull (e.g. HTTP 400 on an
  // incompatible repo). Surfaced so the pull card shows why it failed instead
  // of falsely completing (adhney).
  error?: string
}


export type ModelCategory = 'all' | 'text' | 'image' | 'video'


/**
 * Classify model by type
 */
export function classifyModel(model: AIModel): ModelCategory {
  return model.type
}
