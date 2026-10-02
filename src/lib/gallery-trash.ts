// Gallery delete reaches the file (Discord 2026-09-25, boromirofgeo: "when
// deleting files in app from gallery, they are still in output folder, which
// is getting bigger and bigger"). A local ComfyUI render goes to the Recycle
// Bin / Trash through commands/gallery_files.rs, so a misclick stays
// recoverable. Cloud renders, MLX files and anything another gallery entry
// still shows are left alone.

import { backendCall, isTauri } from '../api/backend'

/**
 * The fields of a gallery item read here. Declared locally rather than
 * imported from createStore: the store loads this module, so even a type
 * import back is a cycle for `npm run cycles`, which CI runs.
 */
interface GalleryRender {
  filename?: string
  subfolder?: string
  comfyType?: string
  jobId?: string
  remoteUrl?: string
  localPath?: string
}

export function isTrashableRender(item: GalleryRender, remaining: GalleryRender[]): boolean {
  if (!item.filename || item.jobId || item.remoteUrl || item.localPath) return false
  if ((item.comfyType ?? 'output') !== 'output') return false
  return !remaining.some((g) => g.filename === item.filename && (g.subfolder ?? '') === (item.subfolder ?? ''))
}

/** Returns an error line for the user, or null when all went well. */
export async function trashGalleryFile(item: GalleryRender, remaining: GalleryRender[]): Promise<string | null> {
  if (!isTauri() || !isTrashableRender(item, remaining)) return null
  try {
    await backendCall('trash_comfy_output', { filename: item.filename, subfolder: item.subfolder ?? '' })
    return null
  } catch (err) {
    return `Removed from the gallery, but the file stayed in the ComfyUI output folder: ${err instanceof Error ? err.message : String(err)}`
  }
}
