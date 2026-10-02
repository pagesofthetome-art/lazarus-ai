/**
 * G20 leftovers (2026-08-07): an existing user whose openai slot was adopted
 * by LM Studio had no UI way back to the Built-in Engine, because "Reset AI
 * Backends" only reset settings KEYS and never touched the provider store.
 * Retired hosted provider configuration is cleared during reset and hydration.
 *
 * Run: npx vitest run src/lib/__tests__/g20-builtin-return-path.test.ts
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { useProviderStore } from '../../stores/providerStore'
import { PROVIDER_PRESETS } from '../../api/providers/types'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(resolve(here, rel), 'utf8')

describe('resetProvidersToDefaults hands the slot back to the Built-in Engine', () => {
  beforeEach(() => {
    // The G20 shape: LM Studio adopted the openai slot, a key sits on
    // anthropic, plus a stale enablement bit in the retired provider slot.
    useProviderStore.getState().setProviderConfig('openai', {
      enabled: true, name: 'LM Studio', baseUrl: 'http://localhost:1234/v1', managed: false,
    })
    useProviderStore.getState().setProviderConfig('anthropic', { apiKey: 'obfuscated-key' })
    useProviderStore.getState().setProviderConfig('lu-cloud', { enabled: true })
  })

  it('restores the shipped Built-in slot', () => {
    useProviderStore.getState().resetProvidersToDefaults()
    const openai = useProviderStore.getState().providers.openai
    expect(openai.name).toBe('Lazarus Engine')
    expect(openai.managed).toBe(true)
    expect(openai.enabled).toBe(true)
    expect(openai.baseUrl).toBe('http://127.0.0.1:8127/v1')
  })

  it('NEGATIVE CONTROL: stored API keys survive the reset', () => {
    useProviderStore.getState().resetProvidersToDefaults()
    expect(useProviderStore.getState().providers.anthropic.apiKey).toBe('obfuscated-key')
  })

  it('clears retired hosted provider enablement on reset', () => {
    useProviderStore.getState().resetProvidersToDefaults()
    expect(useProviderStore.getState().providers['lu-cloud'].enabled).toBe(false)
    expect(useProviderStore.getState().providers['lu-cloud'].isLocal).toBe(false)
  })
})

describe('wiring and the second G20 leftover', () => {
  it('the backends tab reset actually calls the store reset', () => {
    const page = read('../../components/settings/SettingsPage.tsx')
    expect(page).toContain("if (tab === 'backends') useProviderStore.getState().resetProvidersToDefaults()")
  })

  it('the Add Provider path to the Built-in Engine exists as a preset', () => {
    const builtin = PROVIDER_PRESETS.find((p) => p.id === 'builtin')
    expect(builtin?.managed).toBe(true)
    expect(builtin?.isLocal).toBe(true)
  })

  it('the picker has no retired mode switch or hosted catalog path', () => {
    const sel = read('../../components/models/ModelSelector.tsx')
    expect(sel).not.toContain('appMode')
    expect(sel).not.toContain('Cloud mode shows hosted models')
    expect(read('../../hooks/useModels.ts')).toContain("m.provider !== 'lu-cloud'")
    expect(read('../../hooks/useModels.ts')).not.toContain('appMode')
  })
})
