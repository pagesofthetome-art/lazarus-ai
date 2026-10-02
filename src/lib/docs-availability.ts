/** Who gets the Docs button, its setup state, and where document text is indexed. */
import type { EmbedLane, EmbedLaneInfo } from '../api/embed-availability'

export interface DocsAvailability {
  /** Render the button at all. Always true now, which is the fix. */
  visible: boolean
  /** Pressable. Also always true: the panel behind it is the repair shop (B1). */
  enabled: boolean
  /** No embedding lane yet. Damped look, and the click goes to the install card. */
  needsSetup: boolean
  /** The measured lane, or null in local mode and while the probe is running. */
  lane: EmbedLane | null
  /** The button's tooltip. */
  title: string
}

/** Before the embedding lane probe answers. */
export const DOCS_TITLE_PLAIN = 'Document Chat (RAG)'

/** Indexing on this machine. The panel carries the full statement once open. */
export const DOCS_TITLE_LOCAL_INDEX =
  'Document Chat (RAG). Full documents stay on this device; matching passages are added to the chat request.'

/** Indexing on a configured remote Ollama. Names the host that receives files. */
export function docsTitleRemote(endpoint: string | null): string {
  return `Document Chat (RAG). Indexing runs on ${endpoint ?? 'your configured Ollama host'}, so the full text of each document is sent there. Matching passages are added to the chat request.`
}

/** No embedding lane. The wording David asked for, plus the way out. */
export const DOCS_TITLE_NO_EMBEDDINGS =
  'Documents need the local embeddings engine. Click to install it.'

/**
 * @param info  the measured embedding lane, or `null` while the probe is still
 *   running. Unknown counts as fine on purpose: the button remains usable while
 *   the shared probe settles, and the panel can still offer setup.
 */
export function docsAvailability(
  info: EmbedLaneInfo | null,
): DocsAvailability {
  if (info === null) {
    return { visible: true, enabled: true, needsSetup: false, lane: null, title: DOCS_TITLE_PLAIN }
  }
  const base = { visible: true as const, enabled: true as const, lane: info.lane }
  switch (info.lane) {
    case 'none':
      return { ...base, needsSetup: true, title: DOCS_TITLE_NO_EMBEDDINGS }
    case 'ollama-remote':
      return { ...base, needsSetup: false, title: docsTitleRemote(info.endpoint) }
    default:
      return { ...base, needsSetup: false, title: DOCS_TITLE_LOCAL_INDEX }
  }
}
