/**
 * Automatic memory extraction defaults to enabled for supported local models.
 *
 * Drei Tore standen davor, und im Desktop war das dritte still zu. Die zwei
 * Schalter in den Erinnerungseinstellungen standen auf an, das Kostentor
 * The retired hosted provider must remain unavailable even for profiles that
 * still carry its old opt-in field.
 *
 * The migration removes the retired hosted-service consent flag from both
 * existing and new profiles; local extraction defaults remain independent.
 *
 * Run: npx vitest run src/stores/__tests__/die-extraktion-steht-ab-werk-an.test.ts
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../lib/constants'
import { silentCallAllowed } from '../../lib/silent-model-calls'
import { useMemoryStore } from '../memoryStore'
import { useSettingsStore } from '../settingsStore'

describe('die automatische Erinnerungs-Extraktion', () => {
  it('is enabled locally and does not retain a retired hosted-service consent flag', () => {
    const settings = useMemoryStore.getState().settings
    expect(settings.autoExtractEnabled, 'der Hauptschalter').toBe(true)
    expect(settings.autoExtractInAllModes, 'ausserhalb des Agentenmodus').toBe(true)
    expect('memoryCloudOptIn' in DEFAULT_SETTINGS).toBe(false)
    expect(silentCallAllowed('lu-cloud', true)).toBe(false)
    expect(silentCallAllowed('ollama', false)).toBe(true)
  })

  it('entfernt das alte Cloud-Zustimmungsfeld aus bestehenden Profilen', () => {
    const migrate = useSettingsStore.persist.getOptions().migrate
    expect(migrate, 'die Migration ist weg').toBeTypeOf('function')
    const alt = migrate!(
      { settings: { ...DEFAULT_SETTINGS, memoryCloudOptIn: false }, personas: [] },
      21,
    ) as { settings: Record<string, unknown> }
    expect(alt.settings).not.toHaveProperty('memoryCloudOptIn')
  })
})
