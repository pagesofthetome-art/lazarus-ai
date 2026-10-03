/** Keep the UI mark routed through the shared brand asset constant. */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '..', '..', '..', '..')
const SRC = resolve(ROOT, 'src')
const BRAND_PATH = resolve(SRC, 'components', 'layout', 'brand.ts')
const BRAND = readFileSync(BRAND_PATH, 'utf8')
const INDEX_HTML = readFileSync(resolve(ROOT, 'index.html'), 'utf8')
const assetPath = BRAND.match(/export const MONOGRAM\s*=\s*'([^']+)'/)?.[1]

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') sourceFiles(path, out)
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(path)
    }
  }
  return out
}

describe('the current Lazarus mark has one UI source of truth', () => {
  it('brand.ts names the asset currently shipped by the app', () => {
    expect(assetPath).toBeTruthy()
    expect(assetPath).toBe('/succubus-cutout.png')
    expect(INDEX_HTML).toContain(`src=".${assetPath}"`)
  })

  it('components do not embed their own copy of the image path', () => {
    const files = sourceFiles(resolve(SRC, 'components'))
    const duplicatePaths = files
      .filter((path) => path !== BRAND_PATH)
      .filter((path) => readFileSync(path, 'utf8').includes('succubus-cutout.png'))
    expect(duplicatePaths).toEqual([])
  })

  it('components that display the mark import MONOGRAM from the shared module', () => {
    const consumers = sourceFiles(resolve(SRC, 'components')).filter((path) => {
      if (path === BRAND_PATH) return false
      const source = readFileSync(path, 'utf8')
      return /\bMONOGRAM\b/.test(source)
    })
    expect(consumers.length).toBeGreaterThan(0)
    for (const path of consumers) {
      expect(readFileSync(path, 'utf8'), path).toMatch(/from ['"][^'"]*(?:layout\/brand|\.\/brand)['"]\s*;?/)
    }
  })
})
