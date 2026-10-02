/**
 * B3/F5-Nachbesserung (review-w2rust.md, 2026-09-18): system_health's
 * lm_studio_base command argument only ever gets filled correctly if the
 * frontend both (a) names the key exactly `lmStudioBase` -- Tauri converts
 * this to `lm_studio_base` on the Rust side, see health.rs -- and (b)
 * recognises the openai slot as LM Studio for BOTH spellings the provider
 * presets and the store allow ("LM Studio", "LMStudio"). Neither of those two
 * facts was pinned by a test before this file: the Rust-side test only
 * exercises the pure function, tsc only checks that `invoke(command, args)`
 * accepts a generic record, and the existing SettingsPage tests never touch
 * this argument at all.
 *
 * Run: npx vitest run src/components/settings/__tests__/lm-studio-probe-argument.test.ts
 */
import { describe, it, expect } from 'vitest'
import { lmStudioBaseArg } from '../SettingsPage'

describe('lmStudioBaseArg names the key lmStudioBase and reads both LM Studio spellings', () => {
  it('uses the exact key "lmStudioBase", not a snake_case or misspelled one', () => {
    const args = lmStudioBaseArg({ name: 'LM Studio', baseUrl: 'http://192.168.1.20:1234/v1' })
    expect(Object.keys(args)).toEqual(['lmStudioBase'])
  })

  it('fills lmStudioBase from the openai slot\'s baseUrl when its name is "LM Studio"', () => {
    const args = lmStudioBaseArg({ name: 'LM Studio', baseUrl: 'http://192.168.1.20:1234/v1' })
    expect(args.lmStudioBase).toBe('http://192.168.1.20:1234/v1')
  })

  it('also recognises the no-space spelling "LMStudio"', () => {
    const args = lmStudioBaseArg({ name: 'LMStudio', baseUrl: 'http://10.0.0.5:1234/v1' })
    expect(args.lmStudioBase).toBe('http://10.0.0.5:1234/v1')
  })

  it('is case-insensitive on both spellings', () => {
    expect(lmStudioBaseArg({ name: 'lm studio', baseUrl: 'http://a:1234/v1' }).lmStudioBase).toBe('http://a:1234/v1')
    expect(lmStudioBaseArg({ name: 'lmstudio', baseUrl: 'http://b:1234/v1' }).lmStudioBase).toBe('http://b:1234/v1')
  })

  it('omits the base for any other provider name, never guesses one', () => {
    expect(lmStudioBaseArg({ name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' }).lmStudioBase).toBeUndefined()
    expect(lmStudioBaseArg({ name: 'Lazarus Engine', baseUrl: 'http://127.0.0.1:8127/v1' }).lmStudioBase).toBeUndefined()
  })

  it('omits the base when the openai slot is missing entirely', () => {
    expect(lmStudioBaseArg(undefined).lmStudioBase).toBeUndefined()
  })
})
