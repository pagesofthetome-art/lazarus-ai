import { describe, expect, it } from 'vitest'
import { effectiveVideoDurations, snapToVideoDuration } from '../Composer'
import { useCloudCatalogStore } from '../../../../stores/cloudCatalogStore'

describe('hosted video duration catalog retirement', () => {
  it('does not ship a static provider model duration list', () => {
    expect(effectiveVideoDurations('example-model')).toEqual([])
  })

  it('does not accept a hydrated hosted catalog', () => {
    useCloudCatalogStore.getState().setCatalog({
      models: [{ id: 'example-model', label: 'Example', kind: 'video' }],
      ops: { removebg: 0, eraser: 0, upscale_image: 0, upscale_video_per_s: 0, upscale_video_min: 0 },
      voice: { stt: 0, tts_per_1k_chars: 0 }, media_live: true, tier: '', monthly_credits: 0,
    })
    expect(useCloudCatalogStore.getState().models).toEqual([])
    expect(effectiveVideoDurations('example-model')).toEqual([])
  })
})

describe('local duration selection helper', () => {
  it('keeps exact valid durations and resets stale choices to the shortest available option', () => {
    expect(snapToVideoDuration([5, 10, 15], 10 * 16, 16)).toBe(10)
    expect(snapToVideoDuration([5, 15], 14 * 16, 16)).toBe(5)
  })
})
