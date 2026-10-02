// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const html = readFileSync('docs/guide/index.html', 'utf8')
const page = new DOMParser().parseFromString(html, 'text/html')

it('discloses local setup and optional network boundaries in visible guide content', () => {
  const section = page.querySelector('[aria-labelledby="data-boundaries"]')!
  expect(section).not.toBeNull()
  for (const fact of ['runs locally by default', 'Hosted requests leave your machine',
    'Model downloads', 'embedding model', 'Remote access', 'tool permissions']) {
    expect(section.textContent).toContain(fact)
  }
  expect(section.querySelector('a')?.getAttribute('href')).toBe('/cloud/')
  const description = page.querySelector('meta[name="description"]')!.getAttribute('content')
  expect(page.querySelector('meta[property="og:description"]')!.getAttribute('content')).toBe(description)
  expect(JSON.parse(page.querySelector('script[type="application/ld+json"]')!.textContent!).description).toBe(description)
  expect(html).not.toMatch(/fully private|zero config|under 10 minutes|Run anyway|exceptions list|This is a false positive/i)
})

it('keeps security warnings actionable without advising bypasses or private uploads', () => {
  const section = page.querySelector('[aria-labelledby="antivirus-warning"]')!
  for (const fact of ['Keep protection enabled', 'blocked or quarantined',
    'Do not add a blanket folder exclusion', 'must be investigated',
    'Do not post private files, credentials or unredacted logs']) {
    expect(section.textContent).toContain(fact)
  }
  expect(section.querySelector('a')?.hostname).toBe('support.microsoft.com')
  expect(page.body.textContent).toContain('Source availability alone does not verify a downloaded executable')
  expect(page.body.textContent).toContain('Stop if the source or checksum does not match')
})
