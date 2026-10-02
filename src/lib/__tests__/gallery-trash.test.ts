import { describe, it, expect, vi, beforeEach } from 'vitest'

const backend = vi.hoisted(() => ({ call: vi.fn(), tauri: vi.fn(() => true) }))
vi.mock('../../api/backend', async (o) => ({ ...(await o<typeof import('../../api/backend')>()), backendCall: backend.call, isTauri: backend.tauri }))

import { isTrashableRender, trashGalleryFile } from '../gallery-trash'
import type { GalleryItem } from '../../stores/createStore'

const item = (over: Partial<GalleryItem> = {}): GalleryItem => ({
  id: 'a', type: 'image', filename: 'locally_uncensored_00001_.png', subfolder: '', prompt: '', negativePrompt: '',
  model: 'm', modelType: 'sdxl', seed: 1, steps: 1, cfgScale: 1, sampler: 'euler', scheduler: 'normal',
  width: 1, height: 1, batchSize: 1, createdAt: 1, ...over,
}) as GalleryItem

beforeEach(() => { backend.call.mockReset().mockResolvedValue({ trashed: true, missing: false }); backend.tauri.mockReturnValue(true) })

describe('gallery delete reaches the file (Discord 2026-09-25)', () => {
  it('a local ComfyUI render goes to the Recycle Bin', async () => {
    expect(await trashGalleryFile(item({ subfolder: 'x' }), [])).toBeNull()
    expect(backend.call).toHaveBeenCalledWith('trash_comfy_output', { filename: 'locally_uncensored_00001_.png', subfolder: 'x' })
  })

  it('cloud, MLX, input files and files another entry still shows are left alone', () => {
    expect(isTrashableRender(item({ jobId: 'j' }), [])).toBe(false)
    expect(isTrashableRender(item({ remoteUrl: 'https://x' }), [])).toBe(false)
    expect(isTrashableRender(item({ localPath: '/x.mp4' }), [])).toBe(false)
    expect(isTrashableRender(item({ comfyType: 'input' }), [])).toBe(false)
    expect(isTrashableRender(item(), [item({ id: 'b' })])).toBe(false)
    expect(isTrashableRender(item(), [item({ id: 'b', filename: 'other.png' })])).toBe(true)
  })

  it('a failed move is reported, the gallery entry is gone anyway', async () => {
    backend.call.mockRejectedValue(new Error('access denied'))
    expect(await trashGalleryFile(item(), [])).toMatch(/stayed in the ComfyUI output folder: access denied/)
  })
})
