import { describe, it, expect } from 'vitest'
import { intentToJob, galleryItemFromJob } from '../cloud-jobs'
import type { CreateIntent } from '../../../stores/createStore'

describe('intentToJob', () => {
  it('maps every Create intent onto its queue kind + op', () => {
    const cases: Record<CreateIntent, { kind: string; op: string }> = {
      image: { kind: 'image', op: 'generate' },
      edit: { kind: 'image', op: 'edit' },
      removebg: { kind: 'image', op: 'removebg' },
      upscale: { kind: 'image', op: 'upscale' },
      eraser: { kind: 'image', op: 'eraser' },
      video: { kind: 'video', op: 'generate' },
      animate: { kind: 'video', op: 'animate' },
      // Specialized Create intents from existing local drafts retain their
      // operation mapping even though hosted generation is retired.
      character: { kind: 'image', op: 'lora-train' },
      lipsync: { kind: 'video', op: 'lipsync' },
      music: { kind: 'audio', op: 'music' },
      extend: { kind: 'video', op: 'extend' },
      motion: { kind: 'video', op: 'motion' },
    }
    for (const [intent, expected] of Object.entries(cases)) {
      expect(intentToJob(intent as CreateIntent)).toEqual(expected)
    }
  })
})

// Retained for reading archived job records from older local profiles.
describe('galleryItemFromJob', () => {
  it('carries the job identity through, with every local render field neutral', () => {
    const item = galleryItemFromJob({
      id: 'job-1',
      kind: 'video',
      model: 'example-model',
      result_url: 'https://media.example.invalid/e2e/result.mp4',
      attestation: { quote: 'q', verify_url: 'https://media.example.invalid/verify' },
    })
    expect(item.id).toBe('job-1')
    expect(item.jobId).toBe('job-1')
    expect(item.type).toBe('video')
    expect(item.model).toBe('example-model')
    expect(item.remoteUrl).toBe('https://media.example.invalid/e2e/result.mp4')
    expect(item.attestation).toEqual({ quote: 'q', verify_url: 'https://media.example.invalid/verify' })
    // Neutral: a Studio/preset job never carries ComfyUI sampler state.
    expect(item.sampler).toBe('')
    expect(item.scheduler).toBe('')
    expect(item.seed).toBe(0)
    expect(item.steps).toBe(0)
    expect(item.cfgScale).toBe(0)
    expect(item.width).toBe(0)
    expect(item.height).toBe(0)
    expect(item.filename).toBe('')
    expect(item.subfolder).toBe('')
    expect(item.negativePrompt).toBe('')
    expect(item.batchSize).toBe(1)
    expect(item.modelType).toBe('unknown')
  })

  it('turns a missing result_url into an undefined remoteUrl, not a null one', () => {
    const item = galleryItemFromJob({ id: 'job-2', kind: 'audio', model: 'example-model', result_url: null, attestation: null })
    expect(item.remoteUrl).toBeUndefined()
    expect(item.attestation).toBeNull()
  })

  it('leaves prompt and label out entirely, the caller supplies both', () => {
    const item = galleryItemFromJob({ id: 'job-3', kind: 'image', model: 'example-model', result_url: null, attestation: null })
    expect('prompt' in item).toBe(false)
    expect('label' in item).toBe(false)
  })
})
