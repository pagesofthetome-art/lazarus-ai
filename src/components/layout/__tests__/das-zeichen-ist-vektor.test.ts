/** Current brand asset contract: shared UI mark and platform-specific icons. */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, resolve } from 'node:path'

const ROOT = resolve(__dirname, '..', '..', '..', '..')
const PUBLIC = resolve(ROOT, 'public')
const SRC = resolve(ROOT, 'src')
const BRAND_PATH = resolve(SRC, 'components', 'layout', 'brand.ts')
const BRAND = readFileSync(BRAND_PATH, 'utf8')
const INDEX_HTML = readFileSync(resolve(ROOT, 'index.html'), 'utf8')

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

describe('shared brand asset', () => {
  it('has one canonical path in brand.ts and the referenced public asset exists', () => {
    const assetPath = BRAND.match(/export const MONOGRAM\s*=\s*'([^']+)'/)?.[1]
    expect(assetPath).toBeTruthy()
    expect(assetPath).toMatch(/^\/[\w.-]+\.(?:png|svg)$/)
    expect(existsSync(resolve(PUBLIC, assetPath!.slice(1)))).toBe(true)
  })

  it('UI consumers use the shared constant instead of copying the asset path', () => {
    const files = sourceFiles(resolve(SRC, 'components'))
    const consumers = files.filter((path) => {
      if (path === BRAND_PATH) return false
      const code = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
      return code.includes('MONOGRAM')
    })
    expect(consumers.length).toBeGreaterThan(0)
    for (const path of consumers) {
      const code = readFileSync(path, 'utf8')
      expect(code, `${path} should import the shared brand constant`).toMatch(/from ['"][^'"]*layout\/brand|from ['"]\.\/brand/)
    }
  })

  it('the HTML loading splash points at the same shipped mark', () => {
    const assetPath = BRAND.match(/export const MONOGRAM\s*=\s*'([^']+)'/)?.[1]
    expect(assetPath).toBeTruthy()
    expect(INDEX_HTML).toContain(`src=".${assetPath}"`)
    expect(existsSync(resolve(PUBLIC, basename(assetPath!)))).toBe(true)
  })
})

describe('platform icons remain in native formats', () => {
  it('the app bundle keeps raster icon sizes plus .icns/.ico', () => {
    const conf = JSON.parse(readFileSync(resolve(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf-8'))
    const icons: string[] = conf.bundle.icon
    expect(icons.length).toBeGreaterThan(0)
    for (const icon of icons) expect(icon).toMatch(/\.(png|ico|icns)$/)
    expect(icons.some((icon) => icon.endsWith('.icns'))).toBe(true)
    expect(icons.some((icon) => icon.endsWith('.ico'))).toBe(true)
  })

  it('the browser tab continues to use its shipped PNG favicon', () => {
    expect(INDEX_HTML).toMatch(/<link rel="icon" type="image\/png" href="\/favicon\.png" \/>/)
    const png = readFileSync(resolve(PUBLIC, 'favicon.png'))
    expect(png.readUInt32BE(16)).toBeGreaterThan(0)
    expect(png.readUInt32BE(20)).toBeGreaterThan(0)
  })
})
