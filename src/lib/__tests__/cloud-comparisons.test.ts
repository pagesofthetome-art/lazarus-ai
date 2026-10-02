// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const LEGACY_ROUTES = [
  'ollama-cloud', 'featherless', 'venice', 'chutes', 'infermatic',
  'arliai', 'cerebras-code', 'backyard-ai', 'sillyhost',
] as const

it('retired provider comparison routes point to Lazarus provider setup guidance', () => {
  const sitemap = readFileSync('docs/sitemap.xml', 'utf8')
  const alternatives = readFileSync('docs/alternatives/index.html', 'utf8')
  for (const slug of LEGACY_ROUTES) {
    const html = readFileSync(`docs/vs/${slug}/index.html`, 'utf8')
    const page = new DOMParser().parseFromString(html, 'text/html')
    expect(page.title).toBe('Page moved | Lazarus')
    expect(page.querySelector('meta[http-equiv="refresh"]')?.getAttribute('content'))
      .toBe('0; url=/guide/remote-providers/')
    expect(page.querySelector('link[rel="canonical"]')?.getAttribute('href'))
      .toBe('/guide/remote-providers/')
    expect(page.body.textContent).not.toMatch(/checkout|pricing|credits|subscription|former supplier/i)
    expect(sitemap).not.toContain(`<loc>/vs/${slug}/</loc>`)
    expect(alternatives).not.toContain(`href="/vs/${slug}/"`)
  }
})