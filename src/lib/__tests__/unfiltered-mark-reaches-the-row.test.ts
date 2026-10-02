/**
 * Die gemessene Marke ueberlebt den Weg vom Server bis in die Modellzeile.
 *
 * Genau dieser Weg hat schon zweimal ein Feld verloren (siehe den Kommentar in
 * lib/provider-model-row.ts). Der Test faehrt die echte Umwandlung, nicht eine
 * nachgebaute.
 */
import { describe, it, expect } from 'vitest'
import { providerModelRow } from '../provider-model-row'
import type { ProviderModel } from '../../api/providers/types'

const base: ProviderModel = {
  id: 'example/reasoning-model',
  name: 'Reasoning model',
  provider: 'openai',
  providerName: 'Test provider',
}

describe('unfiltered auf dem Weg in die Zeile', () => {
  it('reicht den gemessenen Wert durch', () => {
    expect(providerModelRow({ ...base, unfiltered: 'full' }).unfiltered).toBe('full')
    expect(providerModelRow({ ...base, unfiltered: 'partial' }).unfiltered).toBe('partial')
  })

  it('erfindet nichts, wenn der Server nichts sagt', () => {
    expect(providerModelRow(base).unfiltered).toBeUndefined()
  })
})
