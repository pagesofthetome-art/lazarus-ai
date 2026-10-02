import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }))
vi.mock('../../api/backend', () => ({
  isTauri: vi.fn(() => false),
  backendCall: vi.fn(async () => undefined),
}))
vi.mock('../../api/ollama', () => ({ unloadModel: vi.fn(async () => undefined) }))
vi.mock('../../api/lmstudio', () => ({ unloadLmStudioModel: vi.fn(async () => undefined) }))
vi.mock('../../api/engine', () => ({ activateBuiltinModel: vi.fn(async () => undefined) }))

import { useModelStore } from '../modelStore'

const here = dirname(fileURLToPath(import.meta.url))
const storeSrc = readFileSync(resolve(here, '../modelStore.ts'), 'utf8')

const QWEN = 'openai::Qwen3-4B-Q4_K_M'
const HERMES = 'openai::Hermes-3-Llama-3.2-3B.Q4_K_M'
const chat = (name: string) => ({
  name, model: name, size: 0, type: 'text' as const,
  provider: 'openai' as const, providerName: 'Lazarus Engine',
})

beforeEach(() => {
  useModelStore.setState({ models: [], activeModel: QWEN })
})

describe('the saved model selection follows the installed inventory', () => {
  it('holds the persisted pick while the first inventory request is empty', () => {
    useModelStore.getState().setModels([])
    expect(useModelStore.getState().activeModel).toBe(QWEN)
  })

  it('keeps the selected model when it is present in the inventory', () => {
    useModelStore.getState().setModels([chat(HERMES), chat(QWEN)])
    expect(useModelStore.getState().activeModel).toBe(QWEN)
  })

  it('clears a deleted pick instead of selecting an unqualified model', () => {
    useModelStore.setState({ activeModel: 'openai::deleted-model' })
    useModelStore.getState().setModels([chat(HERMES), chat(QWEN)])
    expect(useModelStore.getState().activeModel).toBeNull()
  })

  it('never exposes rows from the retired hosted provider', () => {
    useModelStore.setState({ activeModel: null })
    useModelStore.getState().setModels([
      chat(QWEN),
      { ...chat('lu-cloud::legacy-model'), provider: 'lu-cloud' as const },
    ])
    expect(useModelStore.getState().models.map((model) => model.name)).toEqual([QWEN])
  })

  it('persists the active selection and fails closed for retired provider picks', () => {
    expect(storeSrc).toMatch(/partialize:[\s\S]*?activeModel: state\.activeModel/)
    expect(storeSrc).toContain("state?.activeModel?.startsWith('lu-cloud::')")
  })
})
