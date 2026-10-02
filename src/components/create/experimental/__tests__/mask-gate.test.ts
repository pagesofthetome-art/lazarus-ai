/**
 * R5-66: before this fix, `Composer.tsx`'s `canGenerate` never looked at
 * `useCreateStore.mask` at all: a cloud edit or an eraser run with no mask
 * painted was submitted anyway and came back as a server error, instead of
 * the Create button simply staying off. `needsMaskFor` (maskGate.ts) is the
 * pure rule `canGenerate` now folds in via `!needsMask || !!mask`.
 *
 * Run: npx vitest run src/components/create/experimental/__tests__/mask-gate.test.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { needsMaskFor } from '../maskGate'

describe('R5-66: needsMaskFor', () => {
  it('eraser always needs a mask, on every backend', () => {
    expect(needsMaskFor('eraser', 'cloud', undefined)).toBe(true)
    expect(needsMaskFor('eraser', 'local', undefined)).toBe(true)
  })

  it('cloud edit needs a mask unless the resolved model is maskless', () => {
    expect(needsMaskFor('edit', 'cloud', undefined)).toBe(true)
    expect(needsMaskFor('edit', 'cloud', false)).toBe(true)
    expect(needsMaskFor('edit', 'cloud', true)).toBe(false)
  })

  it('NEGATIVE CONTROL: local edit never needs a mask, matching the maskless restyle design', () => {
    expect(needsMaskFor('edit', 'local', undefined)).toBe(false)
    expect(needsMaskFor('edit', 'local', false)).toBe(false)
    expect(needsMaskFor('edit', 'local', true)).toBe(false)
  })

  it('every other intent never needs a mask', () => {
    for (const id of ['image', 'video', 'animate', 'removebg', 'upscale', 'character', 'lipsync', 'music', 'extend', 'motion'] as const) {
      expect(needsMaskFor(id, 'cloud', undefined)).toBe(false)
      expect(needsMaskFor(id, 'local', undefined)).toBe(false)
    }
  })
})

describe('R5-66: Composer.tsx actually wires needsMaskFor into canGenerate', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const src = readFileSync(resolve(here, '../Composer.tsx'), 'utf8')

  it('reads the mask from the store', () => {
    expect(src).toContain("const mask = useCreateStore((s) => s.mask)")
  })

  it('calls needsMaskFor and folds the result into canGenerate', () => {
    expect(src).toContain('needsMaskFor(intent, backend,')
    const canGenerateBlock = src.slice(src.indexOf('const canGenerate ='), src.indexOf('const canGenerate =') + 400)
    expect(canGenerateBlock).toContain('!needsMask || !!mask')
  })
})
