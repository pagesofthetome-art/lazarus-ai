import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const src = readFileSync(resolve(__dirname, '..', 'CreateExperimental.tsx'), 'utf8')

function body(fnStart: string): string {
  const i = src.indexOf(fnStart)
  expect(i, `could not find "${fnStart}" in CreateExperimental.tsx`).toBeGreaterThan(-1)
  const rest = src.slice(i)
  return rest.slice(0, rest.indexOf('\n  }, ['))
}

describe('animate result stays on the local Create path', () => {
  it('sets the animate intent before adopting the selected result as input', () => {
    const fn = body('const animateResult = useCallback(async (item: GalleryItem) => {')
    const setIntentAt = fn.indexOf("state.setIntent('animate')")
    const setSourceAt = fn.indexOf('state.setSource(await adoptResult(item))')
    expect(setIntentAt).toBeGreaterThan(-1)
    expect(setSourceAt).toBeGreaterThan(setIntentAt)
  })

  it('does not pick a model from a hosted catalog', () => {
    const fn = body('const animateResult = useCallback(async (item: GalleryItem) => {')
    expect(fn).not.toMatch(/cloudVideoModel|modelForOp|setCloudVideoModel/)
  })
})
