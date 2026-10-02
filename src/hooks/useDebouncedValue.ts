import { useEffect, useState } from 'react'

/**
 * Returns `value`, but only after `ms` have passed with no further change.
 *
 * Built for price-quote keys (Review B4/B5, Runde 3/4, 20.09.2026): a field
 * that changes on every keystroke (a typed prompt) must not restart a
 * rate-limited network call every time, but the field still belongs in the
 * key once it settles. Shared between useStudioPrice.ts (the Composer's live
 * meter) and PresetWorkshop.tsx (the same shape, same fix, one function
 * instead of two copies that could drift apart).
 */
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}
