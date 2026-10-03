/**
 * The Code composer is ONE row, in both states.
 *
 * David, live test of the Code surface, 2026-08-22:
 *
 *   "das promptfenster ist ueberfuellt, der stop knopf oeffnet eine weitere
 *    zeile, alles sieht asymmetrisch aus"
 *
 * Three things were true at once and each one made the other worse:
 *
 *   1. Plugins sits in the composer action bar and its catalog opens upward,
 *      keeping the full menu above the narrow Code prompt area.
 *   2. The bar was `flex-wrap`, so the moment it ran out of width the tail
 *      (model picker, Send) dropped onto a second line.
 *   3. Starting a run WIDENS that bar: the mode trigger gains a run dot, or a
 *      parked "then bypass" label. That was the trigger David actually hit, so
 *      the composer looked one height standing still and another one working,
 *      and Stop appeared to open a line of its own.
 *
 * What this file pins, so none of the three can come back quietly:
 *   - Plugins stays in composerActions with the open-upward behavior used by
 *     the Code toolbar.
 *   - Send and Stop are ONE fixed-size slot at the end of the row. Stop
 *     replaces Send in place, exactly as Chat has always done.
 *   - The bar never wraps, and everything in it is shrink-0 except the one
 *     spacer that is supposed to give way.
 *
 * Run: npx vitest run src/components/chat/__tests__/the-code-composer-is-one-quiet-row.test.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const CHAT = resolve(here, '..')
const read = (f: string) => readFileSync(resolve(CHAT, f), 'utf8')

const CODEX = read('CodexView.tsx')
const INPUT = read('ChatInput.tsx')
const PLUGINS = read('PluginsDropdown.tsx')

/** The JSX/expression a prop is given, brace balanced from `prop={`. */
function propValue(src: string, prop: string): string {
  const start = src.indexOf(`${prop}={`)
  if (start < 0) return ''
  let i = start + prop.length + 1
  let depth = 0
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  return src.slice(start)
}

describe('Plugins remains reachable from the Code action bar', () => {
  it('is rendered in composerActions and opens upward', () => {
    const actions = propValue(CODEX, 'composerActions')
    expect(actions).toContain('<PluginsDropdown iconOnly openUpward />')
  })

  it('keeps the compact icon accessible with a title and name', () => {
    const actions = propValue(CODEX, 'composerActions')
    expect(actions).toContain('<PluginsDropdown iconOnly openUpward />')
    expect(PLUGINS).toMatch(/title=\{anyPluginActive \? 'Plugins \(active\)' : 'Plugins'\}/)
    expect(PLUGINS).toMatch(/aria-label="Plugins"/)
  })

  it('the dropdown itself is unchanged, only the trigger and the place', () => {
    // Same panel, same four sections. If a rewrite ever guts this, the move
    // stops being a move.
    for (const section of ['Chat Tools', 'Caveman Mode', 'Persona', 'Group chat']) {
      expect(PLUGINS).toContain(section)
    }
  })

  it('keeps both view-specific controls in the Code composer', () => {
    const actions = propValue(CODEX, 'composerActions')
    expect(actions).toContain('<PluginsDropdown iconOnly openUpward />')
    expect(actions).toMatch(/<CodexModeDropdown openUpward \/>/)
    expect(actions.match(/<[A-Z][A-Za-z0-9_]*/g)).toEqual(['<PluginsDropdown', '<CodexModeDropdown'])
  })
})

describe('Stop never opens a second line', () => {
  const slot = INPUT.indexOf('data-testid="composer-send-slot"')
  const stop = INPUT.indexOf('aria-label="Stop generation"')
  const send = INPUT.indexOf('aria-label="Send message"')

  it('Send and Stop are the same single slot, not two places in the row', () => {
    expect(INPUT.match(/data-testid="composer-send-slot"/g)).toHaveLength(1)
    expect(INPUT.match(/aria-label="Stop generation"/g)).toHaveLength(1)
    expect(INPUT.match(/aria-label="Send message"/g)).toHaveLength(1)
    expect(slot).toBeGreaterThan(-1)
    expect(stop).toBeGreaterThan(slot)
    expect(send).toBeGreaterThan(stop)
  })

  it('the slot has a fixed footprint, so the two states cannot differ in size', () => {
    // D-T07: the footprint is still fixed, but it is no longer a loose `26px`
    // twice — it names `--control-h-sm`, the same rung `.lazarus-control` stands on.
    // A literal here would drift the moment the rung moves, which is exactly
    // the finding the audit filed under "11-15 control heights per screen".
    expect(INPUT).toMatch(
      /className="shrink-0 w-\[var\(--control-h-sm\)\] h-\[var\(--control-h-sm\)\]" data-testid="composer-send-slot"/,
    )
    expect(INPUT, 'the slot fell back to a raw pixel height').not.toMatch(/(?<![\w-])[wh]-\[26px\]/)
    // Both buttons fill the slot instead of sizing themselves by padding.
    const both = INPUT.slice(slot)
    expect(both.slice(0, both.indexOf('</div>')).match(/w-full h-full/g)).toHaveLength(2)
  })

  it('Stop is the running state of the send button, one ternary, one handler', () => {
    expect(INPUT).toMatch(/\{isGenerating \? \(/)
    // Called bare (GH #140): handed to onClick as is, Stop got the click
    // event as the conversation to stop and stopped nothing in the Code view.
    expect(INPUT.match(/onClick=\{\(\) => onStop\(\)\}/g)).toHaveLength(1)
    expect(INPUT).not.toMatch(/onClick=\{onStop\}/)
  })
})

describe('the action bar is one quiet row', () => {
  const bar = INPUT.indexOf('flex flex-nowrap items-center gap-1 px-2 py-1.5')

  it('does not wrap, at any width, in any state', () => {
    expect(bar).toBeGreaterThan(-1)
    // Only the image-preview strip above the textarea is still allowed to
    // wrap; the action row itself never is.
    const wrappers = [...INPUT.matchAll(/className="([^"]*\bflex-wrap\b[^"]*)"/g)].map((m) => m[1])
    expect(wrappers).toEqual(['flex gap-1.5 mb-1.5 flex-wrap'])
  })

  it('keeps a fixed row height whether a run is in flight or not', () => {
    expect(INPUT).toMatch(/flex flex-nowrap items-center gap-1 px-2 py-1\.5 min-h-\[38px\]/)
  })

  it('gives way in the middle only, so nothing on either end jumps', () => {
    const row = INPUT.slice(bar)
    expect(row).toMatch(/<div className="flex flex-nowrap items-center gap-1 shrink-0">\{composerActions\}<\/div>/)
    expect(row).toMatch(/<div className="flex-1 min-w-0" \/>/)
    expect(row).toMatch(/<div className="shrink-0">\{composerModel\}<\/div>/)
  })

  it('the Code mode trigger grows sideways when a run starts, never downwards', () => {
    // It gains a dot or a parked "then bypass" mid-run. Inside a no-wrap row
    // that is harmless; a breaking label would still be a second line.
    const mode = read('CodexModeDropdown.tsx')
    expect(mode).toMatch(/flex items-center gap-1 whitespace-nowrap px-2 py-0\.5/)
    expect(mode).toMatch(/<div className="relative shrink-0">/)
  })
})
