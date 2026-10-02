import { existsSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('has no Lazarus checkout or subscription surface', () => {
  expect(existsSync('docs/pricing/index.html')).toBe(false)
  expect(existsSync('docs/cloud/index.html')).toBe(false)
  const home = readFileSync('docs/index.html', 'utf8')
  const guide = readFileSync('docs/guide/index.html', 'utf8')
  const redirect = readFileSync('docs/vs/ollama-cloud/index.html', 'utf8')
  for (const source of [home, guide, redirect]) {
    expect(source).not.toMatch(/former supplier host|lu-labs\.ai|checkout|manage subscription/i)
  }
  expect(readFileSync('docs/sitemap.xml', 'utf8')).not.toMatch(/<loc>[^<]*\/(pricing|cloud)\//i)
})

it('keeps optional remote providers separate from a Lazarus hosted service', () => {
  const providerGuide = readFileSync('docs/guide/remote-providers/index.html', 'utf8')
  expect(providerGuide).toContain('providers you select')
  expect(providerGuide).toContain('first-party hosted model catalog or inference account')
  expect(providerGuide).toContain('requests leave your device')
})