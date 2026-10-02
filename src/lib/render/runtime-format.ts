// Die clientseitige Haelfte der Laufzeiten.
//
// Getrennt von runtime-stats.ts, weil das Messen `next/headers` braucht und
// ein Client-Bundle daran zerbricht. Hier steht nur, was beide Seiten lesen
// duerfen: die Form der Zahl und wie sie geschrieben wird.

export interface ModelRuntime { seconds: number; samples: number }

/** Unter so vielen Laeufen sagen wir gar nichts, statt zu raten. */
export const MIN_SAMPLES = 3

/** "about 45 sec" / "about 3 min". Kurz genug, um neben dem Preis zu stehen. */
export function humanRuntime(seconds: number): string {
  if (seconds < 90) return `about ${Math.max(5, Math.round(seconds / 5) * 5)} sec`
  return `about ${Math.max(2, Math.round(seconds / 60))} min`
}
