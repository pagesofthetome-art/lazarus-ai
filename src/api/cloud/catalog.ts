// GET /api/jobs/catalog — the server-authoritative render/voice catalog
// (models, per-op credit costs, media-live switch). Pure HTTP; the persisted
// cache + fallback ordering live in stores/cloudCatalogStore.

import { cloudFetch, jsonOrError } from './client'
import type { CloudModel } from '../../lib/render/cloud-models'

export interface CatalogOps {
  removebg: number
  eraser: number
  upscale_image: number
  // Per-target image-upscale rates (2k/4k/8k). Optional: older catalog
  // payloads (persisted cache) carry only the flat 4k figure above.
  upscale_image_res?: Record<string, number>
  upscale_video_per_s: number
  upscale_video_min: number
}

export interface CloudCatalog {
  models: CloudModel[]
  ops: CatalogOps
  voice: { stt: number; tts_per_1k_chars: number }
  media_live: boolean
  tier: string
  monthly_credits: number
}

export async function getCatalog(): Promise<CloudCatalog> {
  // v=2: this build understands op-specialized models (trainers, lipsync,
  // voice, music, extend, motion) — without the flag the server serves only
  // the classic list so pre-2.5.8 clients never mis-list them.
  //
  // P3: no query bump for Studio. A server that knows Studio simply adds
  // `api_schema`/`pricing`/`quote_required` to the entries this same v=2
  // response already carries, and cloudCatalogStore/runCredits key off the
  // PRESENCE of those fields, never a version number (portplan Abschnitt 4/7).
  const res = await cloudFetch('/api/jobs/catalog?v=2')
  return jsonOrError<CloudCatalog>(res)
}
