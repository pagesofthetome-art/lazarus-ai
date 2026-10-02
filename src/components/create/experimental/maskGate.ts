// R5-66: whether the current lane needs a painted mask before Create can run.
// Pure and testable on its own, same pattern as stageGate.ts / laneHint.ts.
//
// Web gates 'edit' on `meta.needsMask` unconditionally (its edit intent has
// no maskless model at all). Desktop's local 'edit' lane is different by
// design: an empty mask restyles the whole image (VAEEncode at denoise 0.7,
// see the comment on the 'edit' entry in intents.ts), so only the CLOUD lane
// needs a mask, and only when the resolved model is not an instruction-based,
// maskless endpoint (qwen-image-edit). Before this fix nothing gated 'edit' on
// the mask at all, so a cloud edit without one ran the pick-a-model default
// and came back with a server error instead of the button staying off.
import type { CreateBackend, CreateIntent } from '../../../stores/createStore'

export function needsMaskFor(
  intent: CreateIntent,
  backend: CreateBackend,
  /** Whether the model the run will actually use is maskless (undefined = no
   *  catalog entry found, treated as NOT maskless, the safer default). */
  runModelMaskless: boolean | undefined,
): boolean {
  if (intent === 'eraser') return true
  if (intent === 'edit') return backend === 'cloud' && runModelMaskless !== true
  return false
}
