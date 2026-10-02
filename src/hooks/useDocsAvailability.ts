/**
 * Docs-button state for the composer (A9).
 *
 * Reads the shared embedding-lane measurement so the button can explain where
 * full documents are indexed and when the embeddings engine needs setup.
 */
import { useMemo } from 'react'
import { useEmbedLane } from './useEmbedLane'
import { docsAvailability, type DocsAvailability } from '../lib/docs-availability'

export function useDocsAvailability(): DocsAvailability {
  const info = useEmbedLane()
  // Memoised (review N1): this object is a prop on the button, and a fresh
  // identity on every keystroke in the composer is a re-render nobody asked for.
  return useMemo(() => docsAvailability(info), [info])
}
