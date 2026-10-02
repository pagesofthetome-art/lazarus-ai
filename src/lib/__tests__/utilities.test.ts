/**
 * Utility Function Tests
 *
 * Tests privacy.ts und systemCheck.ts pure logic functions.
 *
 * formatBytes, formatDate und truncate standen hier ein zweites Mal, Wort fuer
 * Wort dieselben Faelle wie in ./formatters.test.ts. Zwei Kopien einer
 * Zusicherung sind keine doppelte Sicherheit, sondern eine Stelle, die beim
 * naechsten Mal vergessen wird: beim Wechsel auf die richtigen Einheitennamen
 * (Fund 5) haette eine von beiden stehenbleiben koennen. Sie stehen jetzt
 * einmal, in der Datei, die nach der Sache heisst.
 *
 * Run: npx vitest run src/lib/__tests__/utilities.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getRecommendations } from '../systemCheck'
import type { SystemTier } from '../systemCheck'

// ── proxyImageUrl ────────────────────────────────────────────────

// proxyImageUrl imports isTauri from ../api/backend, which accesses window.__TAURI__
// We mock the entire module to avoid DOM/Tauri dependencies.
vi.mock('../../api/backend', () => ({
  isTauri: vi.fn(() => false),
  localFetch: vi.fn(),
  ollamaUrl: vi.fn((path: string) => `http://localhost:11434${path}`),
}))

describe('proxyImageUrl', () => {
  let proxyImageUrl: typeof import('../privacy').proxyImageUrl
  let isTauri: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    const privacyModule = await import('../privacy')
    proxyImageUrl = privacyModule.proxyImageUrl

    const backendModule = await import('../../api/backend')
    isTauri = backendModule.isTauri as ReturnType<typeof vi.fn>
  })

  it('returns undefined for undefined input', () => {
    expect(proxyImageUrl(undefined)).toBeUndefined()
  })

  it('returns local URLs unchanged (starts with /)', () => {
    expect(proxyImageUrl('/images/photo.png')).toBe('/images/photo.png')
  })

  it('returns blob: URLs unchanged', () => {
    expect(proxyImageUrl('blob:http://localhost/abc')).toBe('blob:http://localhost/abc')
  })

  it('returns data: URLs unchanged', () => {
    const dataUrl = 'data:image/png;base64,iVBOR...'
    expect(proxyImageUrl(dataUrl)).toBe(dataUrl)
  })

  it('proxies external URLs through local API in dev mode', () => {
    isTauri.mockReturnValue(false)
    const external = 'https://example.com/photo.jpg'
    const result = proxyImageUrl(external)
    expect(result).toBe(`/local-api/proxy-image?url=${encodeURIComponent(external)}`)
  })

  it('returns external URLs directly in Tauri mode', () => {
    isTauri.mockReturnValue(true)
    const external = 'https://example.com/photo.jpg'
    expect(proxyImageUrl(external)).toBe(external)
  })
})

// ── getRecommendations ───────────────────────────────────────────

describe('getRecommendations', () => {
  it('returns models for low tier', () => {
    const recs = getRecommendations('low')
    expect(recs.length).toBeGreaterThan(0)
    for (const rec of recs) {
      expect(rec).toHaveProperty('name')
      expect(rec).toHaveProperty('label')
      expect(rec).toHaveProperty('description')
      expect(rec).toHaveProperty('reason')
    }
  })

  it('returns models for medium tier', () => {
    const recs = getRecommendations('medium')
    expect(recs.length).toBeGreaterThan(0)
  })

  it('returns models for high tier', () => {
    const recs = getRecommendations('high')
    expect(recs.length).toBeGreaterThan(0)
  })

  it('returns different models for different tiers', () => {
    const low = getRecommendations('low')
    const medium = getRecommendations('medium')
    const high = getRecommendations('high')

    const lowNames = low.map((r) => r.name)
    const mediumNames = medium.map((r) => r.name)
    const highNames = high.map((r) => r.name)

    // Every tier recommends a different set — medium was fetched but never
    // asserted on before, so a medium list identical to low/high slipped through.
    expect(lowNames).not.toEqual(highNames)
    expect(mediumNames).not.toEqual(lowNames)
    expect(mediumNames).not.toEqual(highNames)
  })

  it('low tier recommends smaller models', () => {
    const low = getRecommendations('low')
    // Low tier should recommend 7b/8b models
    const hasSmallModel = low.some(
      (r) => r.name.includes('7b') || r.name.includes('8b')
    )
    expect(hasSmallModel).toBe(true)
  })

  it('high tier recommends larger models', () => {
    const high = getRecommendations('high')
    // High tier should include 12b+ models
    const hasLargeModel = high.some(
      (r) => r.name.includes('14b') || r.name.includes('12b') || r.name.includes('24b')
    )
    expect(hasLargeModel).toBe(true)
  })

  it('all recommendations have non-empty fields', () => {
    const tiers: SystemTier[] = ['low', 'medium', 'high']
    for (const tier of tiers) {
      for (const rec of getRecommendations(tier)) {
        expect(rec.name.length).toBeGreaterThan(0)
        expect(rec.label.length).toBeGreaterThan(0)
        expect(rec.description.length).toBeGreaterThan(0)
        expect(rec.reason.length).toBeGreaterThan(0)
      }
    }
  })
})
