/** The mobile relay keeps its monochrome mark inline in the delivered HTML. */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { codeOnly } from './mobile-client-shell'

const ROOT = resolve(__dirname, '..', '..', '..')
const read = (...parts: string[]) => readFileSync(resolve(ROOT, ...parts), 'utf8')
const HTML = read('mobile-client', 'index.html')
const JS = read('mobile-client', 'client.js')
const CSS = read('mobile-client', 'styles.css')

function symbolGroup(source: string): string {
  const group = source.match(/<symbol id="lu-monogram"[^>]*>([\s\S]*?)<\/symbol>/)?.[1] ?? ''
  expect(group, 'mobile HTML should contain its inline mark symbol').not.toBe('')
  return group.match(/<g [\s\S]*?<\/g>/)?.[0] ?? ''
}

describe('mobile inline mark', () => {
  it('is an inline vector sprite with a viewBox and path geometry', () => {
    const symbol = HTML.match(/<symbol id="lu-monogram"[^>]*>/)?.[0] ?? ''
    expect(symbol).toContain('viewBox=')
    expect(symbolGroup(HTML)).toContain('<path d=')
    expect(symbolGroup(HTML)).not.toContain('<image')
    expect(HTML).not.toContain('data:image/')
  })

  it('is referenced from the client without requesting a separate brand image', () => {
    expect(codeOnly(JS).match(/<use href="#lu-monogram"\/>/g)).toHaveLength(1)
    expect(codeOnly(JS).match(/monogram\('/g)).toHaveLength(4)
    for (const [name, source] of [['client.js', JS], ['styles.css', CSS]] as const) {
      expect(codeOnly(source), name).not.toMatch(/(?:src|href|url\()[^\n]*\/(?:Lazarus|lazarus)-[^\n]*\.(?:png|svg)/)
    }
  })

  it('shares one white fill and the SVG sprite remains visually hidden', () => {
    const group = symbolGroup(HTML)
    expect([...group.matchAll(/fill="([^"]+)"/g)].map((match) => match[1])).toEqual(['#ffffff'])
    const rule = CSS.match(/\.svg-sprite\{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toContain('position:absolute')
    expect(rule).toContain('width:0')
    expect(rule).not.toContain('display:none')
  })
})
