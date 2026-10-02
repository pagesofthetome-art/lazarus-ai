import type { ProviderModel } from '../api/providers/types'
import type { CloudModel } from '../types/models'
import { prefixModelName } from '../api/providers/registry'

/** Map a configured provider's catalogue entry to the model-store shape. */
export function providerModelRow(pm: ProviderModel): CloudModel {
  return {
    name: prefixModelName(pm.provider, pm.id),
    model: pm.id,
    unfiltered: pm.unfiltered,
    size: 0,
    type: 'text',
    provider: pm.provider,
    providerName: pm.providerName,
    contextLength: pm.contextLength,
    supportsTools: pm.supportsTools,
    supportsVision: pm.supportsVision,
    thinkMode: pm.thinkMode,
    effortLevels: pm.effortLevels,
    effortDefault: pm.effortDefault,
    displayName: pm.name !== pm.id ? pm.name : undefined,
  }
}
