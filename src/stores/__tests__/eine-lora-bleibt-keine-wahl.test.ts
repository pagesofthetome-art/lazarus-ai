/**
 * Ein LoRA ist keine Modellwahl, auch nicht als Rest aus einer alten Version.
 *
 * Bis zum LoRA-Reiter standen die Dateien aus `ComfyUI/models/loras` zwischen
 * den Checkpoints im Bild-Reiter und waren dort anklickbar. Wer einmal
 * geklickt hat, traegt den Namen bis heute in `activeModel`. Die Pruefung in
 * `setModels` fragt nur, ob der Name in der frischen Liste STEHT, und die
 * LoRA steht dort weiter (die volle Inventur enthaelt sie, nur die Ansicht
 * filtert sie heraus). Also blieb die Wahl stehen, und abwaehlen liess sie
 * sich in Models nicht mehr, weil es die Zeile dort nicht mehr gibt.
 *
 * Run: npx vitest run src/stores/__tests__/eine-lora-bleibt-keine-wahl.test.ts
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { AIModel } from '../../types/models'

vi.mock('../../api/ollama', () => ({ unloadModel: vi.fn() }))
vi.mock('../../api/lmstudio', () => ({ unloadLmStudioModel: vi.fn() }))
vi.mock('../../api/engine', () => ({ activateBuiltinModel: vi.fn() }))
vi.mock('../../api/backend', () => ({ isTauri: () => false, backendCall: vi.fn() }))
vi.mock('../../api/builtin-ensure', () => ({
  ensureBuiltinEngineAlive: vi.fn(),
  builtinSlotSwitchedOff: vi.fn(),
}))

import { useModelStore } from '../modelStore'

const LORA: AIModel = {
  name: 'pixel_art_xl.safetensors', model: 'pixel_art_xl.safetensors', size: 170_917_888,
  format: 'safetensors', architecture: 'sdxl', type: 'image', providerName: 'ComfyUI',
  source: 'lora',
}
const CHECKPOINT: AIModel = {
  name: 'sdxl_base.safetensors', model: 'sdxl_base.safetensors', size: 6_000_000_000,
  format: 'safetensors', architecture: 'sdxl', type: 'image', providerName: 'ComfyUI',
  source: 'checkpoint',
}

beforeEach(() => {
  useModelStore.setState({ models: [], activeModel: null })
})

describe('setModels raeumt eine verwaiste LoRA-Wahl auf', () => {
  it('THE FIX: eine Wahl, die auf eine LoRA zeigt, faellt beim naechsten Laden', () => {
    useModelStore.setState({ activeModel: LORA.name })
    useModelStore.getState().setModels([CHECKPOINT, LORA])
    expect(useModelStore.getState().activeModel).not.toBe(LORA.name)
    // Kein Chatmodell in der Liste, also bleibt nichts uebrig: das ist
    // dieselbe Antwort, die ein geloeschter Name bekommt.
    expect(useModelStore.getState().activeModel).toBeNull()
  })

  // GEGENPROBE: die Regel trifft nur die LoRAs. Alles andere, was hier stand,
  // steht weiter da.
  it('GEGENPROBE: ein Checkpoint als Wahl bleibt unangetastet', () => {
    useModelStore.setState({ activeModel: CHECKPOINT.name })
    useModelStore.getState().setModels([CHECKPOINT, LORA])
    expect(useModelStore.getState().activeModel).toBe(CHECKPOINT.name)
  })

  it('GEGENPROBE: eine leere Liste entscheidet weiter gar nichts', () => {
    // Eine Inventur, die nichts geliefert hat, ist keine Aussage ueber die
    // Wahl. Diese Regel stand vor dem LoRA-Reiter hier und bleibt.
    useModelStore.setState({ activeModel: LORA.name })
    useModelStore.getState().setModels([])
    expect(useModelStore.getState().activeModel).toBe(LORA.name)
  })
})
