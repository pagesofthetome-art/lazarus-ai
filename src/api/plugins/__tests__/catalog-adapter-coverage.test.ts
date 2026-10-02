import { describe, expect, it } from 'vitest'
import { PLUGIN_CATALOG } from '../catalog'
import { providerAdapters } from '../adapters'

describe('plugin catalog adapter coverage', () => {
  it('has a registered adapter for every concrete provider entry', () => {
    const missing = PLUGIN_CATALOG
      .filter((plugin) => plugin.transport !== 'stdio' && plugin.transport !== 'streamable-http')
      .filter((plugin) => !plugin.adapterId || !providerAdapters[plugin.adapterId])
      .map((plugin) => `${plugin.name} (${plugin.adapterId ?? 'no adapter id'})`)
    expect(missing).toEqual([])
  })
})
