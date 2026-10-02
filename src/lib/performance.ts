/**
 * Small, production-safe performance probes for the app lifecycle.
 *
 * Measurements stay in the browser's Performance timeline. Nothing is sent
 * anywhere, and the helper becomes a no-op when the API is unavailable. This
 * lets us inspect startup and first-render costs in the desktop webview and in
 * the browser preview without adding a logging dependency or changing state.
 */
const canMeasure = typeof performance !== 'undefined'

export function mark(name: string): void {
  if (!canMeasure || typeof performance.mark !== 'function') return
  try { performance.mark(name) } catch { /* diagnostics must never affect boot */ }
}

export function measure(name: string, start: string, end?: string): void {
  if (!canMeasure || typeof performance.measure !== 'function') return
  try { performance.measure(name, start, end) } catch { /* missing marks are harmless */ }
}

export function measureFromStart(name: string, start: string): void {
  measure(name, start)
}

export function getMeasures(prefix = 'lazarus:'): PerformanceMeasure[] {
  if (!canMeasure || typeof performance.getEntriesByType !== 'function') return []
  return performance
    .getEntriesByType('measure')
    .filter((entry): entry is PerformanceMeasure => entry.name.startsWith(prefix))
}

export function clearMeasures(prefix = 'lazarus:'): void {
  if (!canMeasure) return
  for (const entry of getMeasures(prefix)) {
    try { performance.clearMeasures(entry.name) } catch { /* best effort */ }
  }
}
