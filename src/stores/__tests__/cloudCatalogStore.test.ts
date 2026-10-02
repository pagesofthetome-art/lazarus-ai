import { beforeEach, describe, expect, it } from 'vitest'
import { CLOUD_MODEL_SEED } from '../../lib/render/cloud-models'
import {
  cloudModelsFor,
  opPickerModels,
  refreshCatalog,
  useCloudCatalogStore,
} from '../cloudCatalogStore'

const EMPTY = {
  fetchedAt: null,
  models: [],
  ops: null,
  voice: null,
  mediaLive: false,
}

describe('retired hosted model catalog', () => {
  beforeEach(() => useCloudCatalogStore.setState(EMPTY))

  it('ships no model seeds and never persists the retired catalog', () => {
    expect(CLOUD_MODEL_SEED).toEqual([])
    expect('persist' in useCloudCatalogStore).toBe(false)
    expect(useCloudCatalogStore.getState()).toMatchObject(EMPTY)
  })

  it('keeps the hosted model and operation pickers empty', () => {
    expect(cloudModelsFor('image')).toEqual([])
    expect(cloudModelsFor('video')).toEqual([])
    expect(opPickerModels('lora-train')).toEqual([])
    expect(opPickerModels('upscale')).toEqual([])
  })

  it('does not refresh or accept a previously stored server catalog', async () => {
    useCloudCatalogStore.getState().setCatalog({
      models: [{ id: 'retired-model', name: 'Retired model', kind: 'image' } as never],
      ops: {} as never,
      voice: { stt: 1, tts_per_1k_chars: 1 },
      media_live: true,
      tier: 'legacy',
      monthly_credits: 100,
    })

    await refreshCatalog()

    expect(useCloudCatalogStore.getState()).toMatchObject(EMPTY)
    expect(cloudModelsFor('image')).toEqual([])
  })
})
