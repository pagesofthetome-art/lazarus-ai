// @vitest-environment jsdom
//
// The handbook is one hub page plus one page per
// chapter under docs/guide/. Every chapter page links back to the hub, every
// page carries a JSON-LD block that parses, and the sitemap names every page.
// Without this file a chapter could vanish, or lose its way back to the hub,
// and nothing would notice until a reader did.
import { existsSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const CHAPTERS = [
  'what-it-is', 'install', 'first-start', 'chat', 'agent', 'code', 'create',
  'remote-providers', 'settings-and-troubleshooting', 'faq-and-glossary',
] as const

const parse = (path: string) => new DOMParser().parseFromString(readFileSync(path, 'utf8'), 'text/html')

it('the hub page lists every chapter', () => {
  const hub = parse('docs/guide/index.html')
  expect(hub.querySelector('article[data-handbook-hub]')).not.toBeNull()
  const listed = [...hub.querySelectorAll('.post-card[data-handbook-chapter]')].map((el) => el.getAttribute('data-handbook-chapter'))
  expect(listed).toEqual([...CHAPTERS])
  for (const slug of CHAPTERS) {
    expect(hub.querySelector(`a[href="/guide/${slug}/"]`), slug).not.toBeNull()
  }
})

it('every chapter page exists, links back to the hub, and carries parseable JSON-LD', () => {
  for (const slug of CHAPTERS) {
    const path = `docs/guide/${slug}/index.html`
    expect(existsSync(path), path).toBe(true)
    const page = parse(path)
    expect(page.querySelector(`article[data-handbook-chapter="${slug}"]`), slug).not.toBeNull()
    expect(page.querySelector('a[href="/guide/"]'), `${slug} has no link to the hub`).not.toBeNull()
    expect(page.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(`/guide/${slug}/`)
    const blocks = [...page.querySelectorAll('script[type="application/ld+json"]')]
    expect(blocks.length, slug).toBeGreaterThan(0)
    for (const block of blocks) {
      const ld = JSON.parse(block.textContent!)
      expect(ld['@type'], slug).toBe('TechArticle')
      expect(ld.isPartOf?.url, slug).toBe('/guide/')
    }
    const description = page.querySelector('meta[name="description"]')!.getAttribute('content')
    expect(page.querySelector('meta[property="og:description"]')!.getAttribute('content'), slug).toBe(description)
    expect(description, slug).not.toMatch(/[–—]/u)
  }
})

it('the sitemap names the hub and every chapter', () => {
  const sitemap = readFileSync('docs/sitemap.xml', 'utf8')
  expect(sitemap).toContain('<loc>/guide/</loc>')
  for (const slug of CHAPTERS) {
    expect(sitemap, slug).toContain(`<loc>/guide/${slug}/</loc>`)
  }
})

it('no handbook page carries an em or en dash', () => {
  for (const path of ['docs/guide/index.html', ...CHAPTERS.map((s) => `docs/guide/${s}/index.html`)]) {
    expect(readFileSync(path, 'utf8'), path).not.toMatch(/[–—]|&[mn]dash;/u)
  }
})
