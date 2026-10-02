/** Schedule optional work after the first interactive frame. */
export function scheduleIdle(task: () => void, timeout = 2000): () => void {
  let cancelled = false
  const run = () => { if (!cancelled) task() }
  const idle = (globalThis as typeof globalThis & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
    cancelIdleCallback?: (id: number) => void
  }).requestIdleCallback
  if (idle) {
    const id = idle(run, { timeout })
    return () => {
      cancelled = true
      globalThis.cancelIdleCallback?.(id)
    }
  }
  const id = globalThis.setTimeout(run, 0)
  return () => { cancelled = true; globalThis.clearTimeout(id) }
}
