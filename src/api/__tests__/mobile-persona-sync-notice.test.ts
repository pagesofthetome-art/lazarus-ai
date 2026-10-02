// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { loadFromClient } from './mobile-client-shell'

describe('mobile persona sync notice', () => {
  it('shows the one-way limitation when the actual picker is expanded', () => {
    const state = { caveman: false, persona: true }
    const { pluginsPickerBodyHtml } = loadFromClient<{ pluginsPickerBodyHtml: () => string }>(
      ['pluginsPickerBodyHtml'], {
        getCaveman: () => 'off', getPersonaId: () => 'test', getPersonaEnabled: () => true,
        PERSONAS: [{ id: 'test', name: 'Test persona' }], H: (s: string) => s,
        svgIcon: () => '', pluginsOpen: state,
      },
    )
    const host = document.createElement('div')
    host.innerHTML = pluginsPickerBodyHtml()
    expect(host.querySelector('.persona-sync-note')?.textContent).toBe(
      'Persona changes on this device stay here. They do not sync back to the desktop.',
    )
    expect(host.querySelector('[data-persona="test"]')).not.toBeNull()
    state.persona = false
    host.innerHTML = pluginsPickerBodyHtml()
    expect(host.querySelector('.persona-sync-note')).toBeNull()
  })
})
