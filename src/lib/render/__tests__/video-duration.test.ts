import { describe, expect, it } from 'vitest'
import { bookedVideoSeconds, effectiveVideoDurations, videoDurations } from '../video-duration'

describe('retired hosted video catalog', () => {
  it('has no bundled model durations or supported model durations', () => {
    expect(videoDurations('example-model')).toEqual([])
    expect(effectiveVideoDurations('example-model')).toEqual([])
  })

  it('does not guess a billable duration when model metadata is unavailable', () => {
    expect(() => bookedVideoSeconds('example-model', {})).toThrow(/supported lengths are not available/i)
    expect(() => bookedVideoSeconds('example-model', { duration: 5 })).toThrow()
  })
})
