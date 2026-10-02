import type { TrainerStatus } from '../api/trainer'

/**
 * The sentence under the trainer's install-path field.
 *
 * K5 Blockers 2 and 3 (Opus review of `4fda5a0a`): the old sentence was one
 * hardcoded claim, "Installs to your app data folder by default", that
 * stayed on screen even after a customer had a customized `trainer_root` --
 * at that point it was false, and pressing "Set up trainer" in the belief it
 * went to app data reinstalled at the customized (possibly now unplugged)
 * drive instead, with no way back through the field. This reads the CURRENT
 * backend state instead of assuming the default, always names where the two
 * things that land here actually go (Blocker 3: the trainer's own
 * environment and caches follow this field, base model downloads always go
 * to the configured model folder in Settings, regardless of it), and says
 * plainly that clearing the field is the way back and nothing at the old
 * location is deleted (point 4).
 *
 * K5 Nachbesserung Teil 10, N1 (Opus review of `3ef38668`): a customer typing
 * a DIFFERENT path into the pre-filled field used to still read the old
 * `status.root`, so the caption named the drive being abandoned instead of
 * the one the button was about to install to. Every branch below that names
 * a target now names `trimmed`, the value on screen, not `status.root`.
 *
 * `suggestedRoot`, when given and equal to `trimmed`, marks the one state
 * where the field was pre-filled with a suggestion rather than typed or
 * loaded from a customized root (K5 architecture point 5): the caption then
 * explains why a folder is already sitting there instead of just naming it.
 */
export function trainerRootHint(
  status: Pick<TrainerStatus, 'root' | 'customized'>,
  fieldValue: string,
  suggestedRoot?: string | null,
): string {
  const trimmed = fieldValue.trim()
  const baseModels = 'Base model downloads always go to your configured model folder (Settings, ComfyUI), not here.'
  if (status.customized && trimmed === '') {
    return `Leaving this empty and pressing Set up trainer installs to your app data folder instead. Files already at ${status.root} are kept, not deleted. ${baseModels}`
  }
  if (!status.customized && trimmed !== '' && suggestedRoot && trimmed === suggestedRoot) {
    return `Installs to ${trimmed}. Your model folder is on another drive, so we suggest this folder too. Clear this field to use the app data folder instead. ${baseModels}`
  }
  if (trimmed !== '') {
    const goBack = status.customized ? 'Clear this field to go back to the app data folder.' : 'Clear this field to use the app data folder instead.'
    return `Installs to ${trimmed}. ${goBack} ${baseModels}`
  }
  return `Installs to your app data folder by default. Set a path above to use another drive. ${baseModels}`
}
