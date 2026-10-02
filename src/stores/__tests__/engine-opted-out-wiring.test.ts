/**
 * Opus review, first round, Blocker 1: the five call sites that write
 * `managed: false` onto the `openai` slot as a DELIBERATE customer pick must
 * mark `providerStore.engineOptedOut`, or the missing-engine notice
 * (lib/builtin-engine-presence.ts) is a false positive for every one of
 * them. Pinned by reading the source, the same way
 * builtin-card-survives-add-provider.test.ts pins ProviderConfig.tsx's own
 * wiring: this is app wiring across several component files, not pure logic
 * a unit test can exercise without mounting each surface.
 *
 * Run: npx vitest run src/stores/__tests__/engine-opted-out-wiring.test.ts
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p: string) => readFileSync(resolve(here, p), 'utf8')

describe('the five deliberate-pick call sites mark engineOptedOut', () => {
  it('Onboarding.tsx: choosing Ollama at first setup', () => {
    const src = read('../../components/onboarding/Onboarding.tsx')
    const at = src.indexOf("setProviderConfig('openai', { enabled: false, managed: false })")
    expect(at, 'the Ollama branch write').toBeGreaterThan(-1)
    const nextLines = src.slice(at, at + 350)
    expect(nextLines).toContain('setEngineOptedOut(true)')
  })

  it('Onboarding.tsx: choosing a detected OpenAI-compatible backend at first setup', () => {
    const src = read('../../components/onboarding/Onboarding.tsx')
    const at = src.indexOf("isLocal: true, managed: false,\n        })\n        // Same reasoning")
    expect(at, 'the detected-backend branch write').toBeGreaterThan(-1)
    expect(src.slice(at, at + 200)).toContain('setEngineOptedOut(true)')
  })

  it('BackendsStep.tsx: the assistant installs and wires LM Studio', () => {
    const src = read('../../components/onboarding/BackendsStep.tsx')
    const at = src.indexOf("name: 'LM Studio',\n                          baseUrl: 'http://localhost:1234/v1'")
    expect(at, 'the LM Studio install write').toBeGreaterThan(-1)
    expect(src.slice(at, at + 600)).toContain('setEngineOptedOut(true)')
  })

  it('BackendSelector.tsx: the startup dialog, a non-Ollama backend chosen', () => {
    const src = read('../../components/onboarding/BackendSelector.tsx')
    const at = src.indexOf('managed: false,\n      })\n      // Opus review')
    expect(at, 'the selector dialog write').toBeGreaterThan(-1)
    expect(src.slice(at, at + 400)).toContain('setEngineOptedOut(true)')
  })

  it('ModelSelector.tsx: Start LM Studio Server', () => {
    const src = read('../../components/models/ModelSelector.tsx')
    const at = src.indexOf('lmStudioSlotUpdate(useProviderStore.getState().providers.openai)')
    expect(at, 'the Start LM Studio Server click').toBeGreaterThan(-1)
    const body = src.slice(at, at + 700)
    expect(body).toContain("if (update.managed === false) useProviderStore.getState().setEngineOptedOut(true)")
  })

  // NEGATIVE CONTROL: the Add Provider dropdown (ProviderConfig.tsx's
  // selectPreset/applyPreset) is the path the R13D eviction bug actually
  // runs through, and it must NOT mark engineOptedOut, or a customer who
  // adds a second custom provider after already losing Lazarus Engine would have
  // that loss wrongly certified as "on purpose" too.
  it('NEGATIVE CONTROL: ProviderConfig.tsx never calls setEngineOptedOut', () => {
    const src = read('../../components/settings/ProviderConfig.tsx')
    expect(src).not.toContain('setEngineOptedOut')
  })
})
