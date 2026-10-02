/**
 * K9 nachbessert (review-create.md, GH #136), corrected in Runde 3 after
 * Opus review found the previous version of this test asserted a claim the
 * issue does not make: "both author workflows carry ModelSamplingAuraFlow at
 * shift 4". They do not. The issue documents TWO Krea 2 recipes that
 * disagree on this exact node:
 *
 *  - FinePorn v4 NVFP4: the reporter's only PROVEN successful run (Euler,
 *    beta, CFG 1, 8 steps), NO ModelSamplingAuraFlow, ComfyUI's own default
 *    sampling.
 *  - LUSTIFY! v10 Krea2: Euler, simple, CFG 1, 8 steps, PLUS
 *    ModelSamplingAuraFlow shift 4 and ConditioningZeroOut.
 *
 * classifyModel cannot tell a LUSTIFY-style checkpoint from a FinePorn-style
 * one (both classify as 'krea2'), so buildDynamicWorkflow no longer forces
 * shift 4 on every krea2 checkpoint: that applied an unevidenced
 * sigma-schedule change to the one variant the issue actually proves works
 * without it. ConditioningZeroOut at CFG 1 stays (Opus: "unkritisch", it
 * only replaces a no-op CLIPTextEncode pass, same rule as unet_ernie_image).
 * MODEL_TYPE_DEFAULTS.krea2's scheduler moved from 'simple' to 'beta' for
 * the same reason: it now defaults to the one PROVEN recipe.
 *
 * Run: npx vitest run src/api/__tests__/krea2-sampling-k9.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../comfyui-nodes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../comfyui-nodes')>()
  return { ...actual, getAllNodeInfo: vi.fn() }
})
vi.mock('../backend', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../backend')>()
  return { ...actual, localFetch: vi.fn(), comfyuiUrl: (p: string) => `http://test${p}` }
})

import { buildDynamicWorkflow } from '../dynamic-workflow'
import { getAllNodeInfo } from '../comfyui-nodes'
import { localFetch } from '../backend'
import { MODEL_TYPE_DEFAULTS } from '../comfyui'
import { classTypes, nodeOf } from './graph-test-support'

const KREA2_NODES = {
  UNETLoader: { input: { required: { unet_name: [['krea2-lustify-v10.safetensors']] } } },
  CLIPLoader: { input: { required: { clip_name: [['qwen3vl_4b.safetensors']], type: [['krea2']] } } },
  VAELoader: { input: { required: { vae_name: [['krea_vae.safetensors']] } } },
  ModelSamplingAuraFlow: { input: { required: {} } },
  ConditioningZeroOut: { input: { required: {} } },
  EmptyLatentImage: { input: { required: {} } },
  KSampler: { input: { required: {} } },
  CLIPTextEncode: { input: { required: {} } },
  VAEDecode: { input: { required: {} } },
  SaveImage: { input: { required: {} } },
}

const baseParams = {
  model: 'krea2-lustify-v10.safetensors',
  prompt: 'a red jacket', negativePrompt: '',
  sampler: 'euler', scheduler: 'beta',
  width: 1024, height: 1024, steps: 8, cfgScale: 1, seed: 1, batchSize: 1,
} as never

describe('unet_krea2 graph (K9, GH #136), corrected Runde 3', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getAllNodeInfo).mockResolvedValue(KREA2_NODES as never)
    vi.mocked(localFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        VAELoader: { input: { required: { vae_name: [['krea_vae.safetensors']] } } },
        CLIPLoader: { input: { required: { clip_name: [['qwen3vl_4b.safetensors']], type: [['krea2']] } } },
      }),
    } as never)
  })

  it('does NOT force ModelSamplingAuraFlow: only one of the two documented recipes uses it, and classifyModel cannot tell them apart', async () => {
    const wf = await buildDynamicWorkflow(baseParams)
    expect(classTypes(wf)).not.toContain('ModelSamplingAuraFlow')
    // ComfyUI's own default sampling applies: KSampler reads straight off the
    // UNETLoader, the same wiring every other checkpoint-without-a-shift-node
    // strategy uses.
    const [unetId] = nodeOf(wf, 'UNETLoader')!
    const [, sampler] = nodeOf(wf, 'KSampler')!
    expect(sampler.inputs.model).toEqual([unetId, 0])
  })

  it('MODEL_TYPE_DEFAULTS.krea2 defaults to the PROVEN recipe (FinePorn: beta), not the unproven one (LUSTIFY: simple)', () => {
    expect(MODEL_TYPE_DEFAULTS.krea2.scheduler).toBe('beta')
  })

  it('at CFG 1, the negative branch is ConditioningZeroOut, not CLIPTextEncode (unaffected by the shift correction)', async () => {
    const wf = await buildDynamicWorkflow({ ...(baseParams as object), cfgScale: 1 } as never)
    expect(classTypes(wf)).toContain('ConditioningZeroOut')
    const [, zeroOut] = nodeOf(wf, 'ConditioningZeroOut')!
    const [posId] = nodeOf(wf, 'CLIPTextEncode')!
    expect(zeroOut.inputs.conditioning).toEqual([posId, 0])
    // Exactly one CLIPTextEncode (positive only); the negative never got one.
    expect(Object.values(wf).filter((n) => n.class_type === 'CLIPTextEncode')).toHaveLength(1)
  })

  it('above CFG 1, the negative branch stays a real CLIPTextEncode (the prompt is not a no-op there)', async () => {
    const wf = await buildDynamicWorkflow({ ...(baseParams as object), cfgScale: 4, negativePrompt: 'blurry' } as never)
    expect(classTypes(wf)).not.toContain('ConditioningZeroOut')
    expect(Object.values(wf).filter((n) => n.class_type === 'CLIPTextEncode')).toHaveLength(2)
  })
})
