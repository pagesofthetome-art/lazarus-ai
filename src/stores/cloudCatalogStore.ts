// In-memory compatibility shape for old Create code. Lazarus ships no hosted
// catalog, has no production refresh path, and does not persist this state.

import { create } from 'zustand'
import type { CloudModel } from '../lib/render/cloud-models'
import type { RenderKind, RenderOp } from '../lib/render/cloud-jobs'
import type { CatalogOps, CloudCatalog } from '../api/cloud/catalog'

interface CloudCatalogState {
  fetchedAt: number | null
  models: CloudModel[]
  ops: CatalogOps | null
  voice: { stt: number; tts_per_1k_chars: number } | null
  mediaLive: boolean | null

  setCatalog: (c: CloudCatalog) => void
}

export const useCloudCatalogStore = create<CloudCatalogState>()((set) => ({
  fetchedAt: null,
  models: [],
  ops: null,
  voice: null,
  mediaLive: false,

  // Keep the legacy action shape for old callers. No hosted catalog is
  // accepted, fetched, or written to persistent storage.
  setCatalog: (_catalog) => set({ fetchedAt: null, models: [], ops: null, voice: null, mediaLive: false }),
}))

/** Legacy caller compatibility. No hosted catalog is fetched. */
export async function refreshCatalog(): Promise<void> {
  // Hosted catalogs were removed. Keep this action as a no-op for legacy callers.
}

// Classic per-kind list (the Image / Video pickers): op-specialized 2.5.8
// models (`ops` set) are excluded — they live behind their own intents via
// modelsForOp below.
export function cloudModelsFor(kind: RenderKind): CloudModel[] {
  return useCloudCatalogStore.getState().models.filter((m) => m.kind === kind && !m.ops)
}

/** Review B1 (Runde 2, 20.09.2026): the ONLY signal that the connected
 *  server knows the Studio endpoints at all (Portplan Abschnitt 4, "nie
 *  eine Serverversion fest verdrahten"): absence, not a version number, is
 *  what an older catalog payload looks like. The default seed
 *  (CLOUD_MODEL_SEED) carries `quote_required` on no entry, so a fresh
 *  install reads false here until the first successful catalog fetch, same
 *  as an old server that never gained Studio. Every caller that would
 *  otherwise pick a Studio model as a role intent's DEFAULT (create-
 *  studio.ts's `intentPickerModels`, which `resolveIntentPick` and five
 *  downstream components all read) must gate on this, or a Create-tab run
 *  on an old server picks an endpoint that server has never heard of
 *  (review-studio-B.md B1: Extend/Motion broke on today's server). Already
 *  used the same way by PresetShelf.tsx to hide the shelf entirely. */
export function catalogHasStudio(): boolean {
  return useCloudCatalogStore.getState().models.some((m) => m.quote_required === true)
}

// Does this catalog entry serve this op? Classic models (no `ops`) keep their
// flag contract: generate always, edit per flag, animate = video i2v.
export function cloudModelSupportsOp(m: CloudModel, op: RenderOp): boolean {
  if (m.ops) return m.ops.includes(op)
  if (op === 'generate') return m.kind !== 'video' || m.t2v !== false
  if (op === 'edit') return m.edit === true
  if (op === 'animate') return m.kind === 'video' && m.i2v !== false
  return false
}

/** The pickers behind the 2.5.8 intents; 'generate' + kind image restricted to
 *  LoRA-capable models yields the Character-Studio generation list. */
export function modelsForOp(kind: RenderKind, op: RenderOp): CloudModel[] {
  return useCloudCatalogStore.getState().models.filter(
    (m) => m.kind === kind && cloudModelSupportsOp(m, op),
  )
}

/** Exactly the rows the specialized-op picker offers. Character training is
 *  image trainers only for now: the LTX video trainer needs a video training
 *  set (and a video use-lane) that no surface can provide yet. */
export function opPickerModels(op: RenderOp): CloudModel[] {
  return useCloudCatalogStore
    .getState()
    .models.filter((m) => m.ops?.includes(op) && (op !== 'lora-train' || m.kind === 'image'))
}

/** Chip, meter and submit all resolve the stored op pick through this one
 *  rule — a pick left over from another intent (p-video-avatar surviving from
 *  lipsync into character training) falls to the op's first model instead of
 *  silently steering the submit to a different family than the chip shows. */
export function resolveOpPick(op: RenderOp, pickedId: string): string {
  const list = opPickerModels(op)
  return list.some((m) => m.id === pickedId) ? pickedId : (list[0]?.id ?? '')
}

/** Character-Studio generation endpoints (accept `params.loras`). */
export function loraGenModels(): CloudModel[] {
  return useCloudCatalogStore.getState().models.filter((m) => m.lora === true)
}

/** First classic model of the kind; kinds whose models are ALL op-specialized
 *  (audio — every entry carries `ops`, in the live catalog and the seed alike)
 *  fall back to the kind's first entry so callers never explode on `.id`. */
export function defaultCloudModel(kind: RenderKind): CloudModel | undefined {
  return cloudModelsFor(kind)[0] ?? useCloudCatalogStore.getState().models.find((m) => m.kind === kind)
}

export function cloudModelById(id: string): CloudModel | undefined {
  return useCloudCatalogStore.getState().models.find((m) => m.id === id)
}

// R5-58: a model serves 'edit' either the classic way (`edit: true`, e.g.
// flux-dev) or the 2.5.8 op-specialized way (`ops: ['edit']`, e.g.
// qwen-image-edit). `cloudModelSupportsOp` already branches on `m.ops` first
// so it got this right; `isEditCapable` and `defaultEditModel` below checked
// only `m.edit` and silently could not see an ops-based edit model at all.
export function isEditModel(m: CloudModel): boolean {
  return m.edit === true || m.ops?.includes('edit') === true
}

export function isEditCapable(id: string): boolean {
  const m = cloudModelById(id)
  return m !== undefined && isEditModel(m)
}

/** First edit-capable image model in the catalog (flux-dev today) — the
 *  submit-time fallback when the picker holds a t2i-only model for an edit. */
export function defaultEditModel(): CloudModel | undefined {
  return useCloudCatalogStore.getState().models.find((m) => m.kind === 'image' && isEditModel(m))
}

// Video models that render text-to-video (the "Video" intent) / image-to-video
// (the "Animate Image" intent). Absent flag = capable, so a persisted catalog
// cached before this field existed still lists every clip model; only an
// explicit false hides a capability-restricted model from that picker.
export function t2vModels(): CloudModel[] {
  return useCloudCatalogStore.getState().models.filter((m) => m.kind === 'video' && !m.ops && m.t2v !== false)
}

export function i2vModels(): CloudModel[] {
  return useCloudCatalogStore.getState().models.filter((m) => m.kind === 'video' && !m.ops && m.i2v !== false)
}

/** The model a run will really use for this op — coerces a leftover/incapable
 *  pick onto a capable one (edit→i2i, animate→i2v, video→t2v) so submit + the
 *  credits gate agree. Mirrors each picker's per-op filter. */
export function modelForOp(kind: RenderKind, op: RenderOp, pickedId: string): string {
  if (op === 'edit') return isEditCapable(pickedId) ? pickedId : (defaultEditModel()?.id ?? pickedId)
  if (kind === 'video' && (op === 'generate' || op === 'animate')) {
    const list = op === 'animate' ? i2vModels() : t2vModels()
    return list.some((m) => m.id === pickedId) ? pickedId : (list[0]?.id ?? pickedId)
  }
  // 2.5.8 op-specialized intents: coerce a stale pick onto a model that
  // actually serves the op (same rule the pickers apply).
  if (op === 'lipsync' || op === 'extend' || op === 'motion' || op === 'music' || op === 'tts' || op === 'lora-train') {
    const list = modelsForOp(kind, op)
    return list.some((m) => m.id === pickedId) ? pickedId : (list[0]?.id ?? pickedId)
  }
  return pickedId
}

/** Credits the upcoming run draws, priced from the server catalog: per-op
 *  utility rates, per-model base/long clip rates (the long rate books from
 *  ~6.5 s, mirroring the server's mediaCredits split). Edit coerces onto the
 *  edit-capable model exactly like useCloudCreate's submit, so gate + meter
 *  price the model the run actually uses. Falls back to the quota's
 *  representative per-kind figure when the catalog carries no price
 *  (seed/offline). */
export function runCredits(
  kind: RenderKind,
  op: RenderOp,
  pickedModel: string,
  seconds: number | undefined,
  fallback: number,
  resolution?: string,
): number {
  const { ops } = useCloudCatalogStore.getState()
  // Music bills per second: catalog per_s × the requested duration (60 s
  // default, mirroring the server's MUSIC_SECONDS fallback).
  if (op === 'music') {
    const m = cloudModelById(modelForOp(kind, op, pickedModel))
    const perS = m?.credits?.per_s
    if (perS === undefined) return m?.credits?.base ?? fallback
    return Math.ceil(perS * (seconds && seconds > 0 ? seconds : 60))
  }
  if (op === 'removebg' || op === 'eraser' || op === 'upscale') {
    // Video upscale is per-second with a floor; the server defaults to 8 s
    // when the submit carries no clip length (mirrors mediaCredits).
    const upscale = !ops
      ? undefined
      : kind === 'video'
        ? Math.ceil(Math.max(ops.upscale_video_min, ops.upscale_video_per_s * (seconds && seconds > 0 ? seconds : 8)))
        : ((resolution && ops.upscale_image_res?.[resolution]) || ops.upscale_image)
    const rate = ops ? { removebg: ops.removebg, eraser: ops.eraser, upscale }[op] : undefined
    return rate ?? fallback
  }
  const model = modelForOp(kind, op, pickedModel)
  const entry = cloudModelById(model)
  // P3, Studio-Zweig (P9 rescoped): a Studio model (`quote_required` on the
  // catalog entry) prices its OWN generation run live from POST
  // /api/jobs/studio-quote, see studio.ts and studio-contract.ts's own
  // `studioCredits()` formula, which is a PREVIEW, not this function's job.
  // Computing this generic base/long/by_duration figure for a Studio
  // generation would drift from the provider's real price the moment it
  // changes there, and a run must never book a different number than what
  // got shown (Portplan Abschnitt 7, Risiko 1); no UI path does this today
  // (Composer/CreditsMeter route a Studio pick around runCredits entirely,
  // preset-models.ts/create-presets.ts only call runCredits for non-studio
  // steps), this guard is the safety net for the day one of them slips.
  //
  // The guard sits HERE, not before the op branches above, on purpose: a
  // Studio-originated video can still reach the generic video-upscale
  // 'enhance' action from the gallery Lightbox, a wholly separate WaveSpeed
  // utility endpoint, priced from the flat per-second `ops` rate table, not
  // from this model's own Studio price. Blocking that call too (the
  // original, wider guard did) forced the enhance-credits gate onto the
  // quota's generic per-kind fallback for every Studio-originated clip,
  // silently hiding the real per-second rate. Scoping the guard to only the
  // generic-model-credits branch below fixes that and is what actually makes
  // Lightbox's `runCredits('video', 'upscale', item.model, ...)` call
  // correct for a Studio clip.
  if (entry?.quote_required) return fallback
  const credits = entry?.credits
  if (!credits) return fallback
  // P3, by_duration: dd29f359 lets a video model book any advertised length,
  // not just the short/long pair; an exact catalog price for the requested
  // length beats rounding it onto one of the two buckets below. Falls
  // through to the base/long split when the catalog carries no per-duration
  // table yet (older payload) or no entry for this exact length.
  if (kind === 'video' && seconds !== undefined && credits.by_duration) {
    const exact = credits.by_duration[String(seconds)]
    if (exact !== undefined) return exact
  }
  return kind === 'video' && seconds !== undefined && seconds >= 6.5
    ? (credits.long ?? credits.base)
    : credits.base
}

export function shortCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  return n.toLocaleString('en-US')
}

/** One run's wallet draw as a picker sublabel. The single biggest cost lever
 *  (wan-2.2-720p costs 5x wan-2.2-fast) was invisible before picking. Music
 *  prices the CURRENT length-slider value, not a static 60 s quote: the old
 *  hint said 1,800 cr while a 3:10 run really billed 5,700, which read as a
 *  hidden price hike (sockenmonster, bug-reports 2026-08-08). Video quotes the
 *  short clip; the meter refines it to the exact run. Undefined when the entry
 *  carries no price (seed/offline).
 *
 *  Review B7 (Runde 2): the same `quote_required` guard `runCredits()` has
 *  twenty lines up: a Studio entry must never print a self-computed hint,
 *  its real price lives in `studio-contract.ts`/`studioQuote()`, not in this
 *  model's `credits` field. Harmless today (a Studio entry carries `pricing`,
 *  not `credits`, so `c` is already undefined below), but a future catalog
 *  payload that sends both must not silently start printing a wrong number
 *  here just because the other guard was three lines away. */
export function modelCostHint(m: CloudModel, op: RenderOp, seconds?: number): string | undefined {
  if (m.quote_required) return undefined
  const c = m.credits
  if (!c) return undefined
  const cr =
    op === 'music' && c.per_s !== undefined
      ? Math.ceil(c.per_s * (seconds && seconds > 0 ? seconds : 60))
      : c.base
  return `${shortCount(cr)} cr`
}

/** Media-live switch from the server (MEDIA_LIVE env). Unknown = live so the
 *  first-ever session doesn't false-block before the catalog arrives. */
export function cloudMediaLive(): boolean {
  return useCloudCatalogStore.getState().mediaLive !== false
}
