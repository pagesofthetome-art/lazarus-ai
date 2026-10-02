/**
 * Ein LoRA-Treffer aus der CivitAI-Suche gehoert in `loras` und nirgendwo
 * sonst.
 *
 * `searchCivitaiModels` bestimmt den Zielordner zweimal: einmal aus dem
 * gesuchten Typ, danach noch einmal aus dem NAMEN des Treffers ("flux", "wan",
 * "hunyuan" heissen `diffusion_models`). Die zweite Regel ist fuer
 * Checkpoints richtig und fuer alles andere falsch: der Name eines LoRA sagt,
 * gegen welches Basismodell es trainiert wurde, nicht welche Art Datei es ist.
 * "Flux Realism LoRA" waere damit nach `diffusion_models` geschrieben worden,
 * wo der LoraLoader nicht hinsieht. Der LoRA-Reiter in Models haette also
 * heruntergeladen, was der LoRA-Stapel in Create nie anbieten kann.
 *
 * Run: npx vitest run src/api/__tests__/ein-lora-landet-im-lora-ordner.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fetchExternal = vi.fn()

vi.mock('../backend', () => ({
  backendCall: vi.fn(),
  fetchExternal: (...args: unknown[]) => fetchExternal(...args),
}))

import { searchCivitaiModels } from '../discover'

/** Eine CivitAI-Antwort mit genau einem Treffer des gegebenen Namens. */
function antwortMit(name: string): string {
  return JSON.stringify({
    items: [{
      id: 1,
      name,
      stats: { downloadCount: 10 },
      creator: { username: 'someone' },
      modelVersions: [{
        downloadUrl: 'https://civitai.com/api/download/models/1',
        files: [{ name: 'x.safetensors', sizeKB: 1024 }],
        images: [],
      }],
    }],
  })
}

beforeEach(() => { fetchExternal.mockReset() })

describe('der Zielordner eines CivitAI-Treffers', () => {
  it('THE FIX: ein LoRA geht nach loras, auch wenn "Flux" im Namen steht', async () => {
    fetchExternal.mockResolvedValue(antwortMit('Flux Realism LoRA'))
    const hits = await searchCivitaiModels('realism', 'LORA')
    expect(hits).toHaveLength(1)
    expect(hits[0].subfolder).toBe('loras')
  })

  it('und ein LoRA ohne solchen Namen genauso', async () => {
    fetchExternal.mockResolvedValue(antwortMit('Detail Enhancer'))
    const hits = await searchCivitaiModels('detail', 'LORA')
    expect(hits[0].subfolder).toBe('loras')
  })

  it('die Typfrage geht auch so an CivitAI', async () => {
    fetchExternal.mockResolvedValue(antwortMit('Detail Enhancer'))
    await searchCivitaiModels('detail', 'LORA')
    expect(fetchExternal).toHaveBeenCalledTimes(1)
    expect(String(fetchExternal.mock.calls[0][0])).toContain('types=LORA')
  })

  // GEGENPROBE: die Namensregel lebt weiter, sie gilt nur fuer Checkpoints.
  // Faellt sie ganz weg, faellt dieser Fall auf.
  it('GEGENPROBE: ein Checkpoint mit "Flux" im Namen geht weiter nach diffusion_models', async () => {
    fetchExternal.mockResolvedValue(antwortMit('Flux Dev'))
    const hits = await searchCivitaiModels('flux', 'Checkpoint')
    expect(hits[0].subfolder).toBe('diffusion_models')
  })

  it('GEGENPROBE: ein Checkpoint ohne solchen Namen bleibt bei checkpoints', async () => {
    fetchExternal.mockResolvedValue(antwortMit('Some SDXL Mix'))
    const hits = await searchCivitaiModels('sdxl', 'Checkpoint')
    expect(hits[0].subfolder).toBe('checkpoints')
  })
})
