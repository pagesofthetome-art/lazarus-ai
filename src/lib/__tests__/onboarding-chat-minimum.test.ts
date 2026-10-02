import { expect, it } from 'vitest'
import { ONBOARDING_MODELS } from '../constants'
import { getMainstreamTextModels } from '../../api/discover'

it('uses an existing catalog model meeting the 7B minimum with exact download integrity', () => {
  const starter = ONBOARDING_MODELS.find(m => m.name === 'qwen2.5-7b')
  expect(starter).toBeDefined()
  const catalog = getMainstreamTextModels().find(model => model.filename === starter!.filename)
  expect(catalog).toBeDefined()
  expect(catalog!.tags).toContain('7B')
  expect(starter!.downloadUrl).toBe(catalog!.downloadUrl)
  expect(starter!.expectedBytes).toBe(4683074240)
  expect(starter!.sha256).toBe('65b8fcd92af6b4fefa935c625d1ac27ea29dcb6ee14589c55a8f115ceaaa1423')
  expect(Math.round(starter!.sizeGB * 1_073_741_824)).toBe(starter!.expectedBytes)
  expect(starter!.description).not.toMatch(/runs on anything|instant|30 seconds/i)
})

// Second onboarding pick, added so the wizard offers an agent-capable model
// above the 9B floor getRecommendedAgentModels() names as where tool calls
// start holding together. Repo and filename come from the Discover catalog
// entry (api/discover.ts, getMainstreamTextModels, name 'Qwen 3.5 9B'), not
// typed twice, so the two cannot drift apart.
//
// sizeGB is NOT pinned against the catalog's number here: the catalog writes
// a rounded display figure (5), this entry needs the byte-exact one for
// download integrity (see the next test), the same split the 7B entry
// already has between its catalog row and its own `expectedBytes`.
it('the second onboarding pick matches the Discover catalog entry it is drawn from', () => {
  const nineB = ONBOARDING_MODELS.find(m => m.name === 'qwen3.5-9b')
  expect(nineB).toBeDefined()
  const catalog = getMainstreamTextModels().find(model => model.name === 'Qwen 3.5 9B')
  expect(catalog).toBeDefined()
  expect(nineB!.downloadUrl).toBe(catalog!.downloadUrl)
  expect(nineB!.filename).toBe(catalog!.filename)
  expect(catalog!.tags).toContain('9B')
  expect(catalog!.agent).toBe(true)
  // This IS read now: ModelsStep.tsx renders an "Agent-ready" tag on any
  // model with `agent: true` (the Discover page's ModelTiles.tsx filters on
  // the same field for its catalog rows). Not a dead flag on either side.
  expect(nineB!.agent).toBe(true)
})

// Byte-exact download integrity, measured on lu-box (see
// lu-301/e2e/box-modelle/MODELL-UND-SKRIPT.md) and cross-checked live
// against the HuggingFace LFS metadata for this repo
// (api/models/unsloth/Qwen3.5-9B-GGUF/tree/main) on 2026-09-20: both name
// 5680522464 bytes and the same SHA-256 for Qwen3.5-9B-Q4_K_M.gguf. Mirrors
// the check the 7B starter already has above, so the built-in engine path
// can verify this download the same way it verifies that one
// (ModelsStep.tsx passes `expectedBytes`/`sha256` through to
// `startModelDownloadToPath`).
it('the 9B download is pinned to the byte-exact size and SHA-256 measured on lu-box', () => {
  const nineB = ONBOARDING_MODELS.find(m => m.name === 'qwen3.5-9b')!
  expect(nineB.expectedBytes).toBe(5680522464)
  expect(nineB.sha256).toBe('03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8')
  expect(Math.round(nineB.sizeGB * 1_073_741_824)).toBe(nineB.expectedBytes)
})

// vramGB is measured, not guessed (lu-301/STAND-BAU.md:258: RTX 3060, all 32
// layers offloaded, "6,1 GB VRAM"; corroborated by MODELL-UND-SKRIPT.md's
// nvidia-smi reading). The number is not re-typed here as a second copy to
// compare against, that would just check the field equals itself under a
// different name. Instead this checks the thing that could actually drift:
// that the human-readable `vram` and `description` text are read FROM
// `vramGB`, so a future edit to one cannot silently leave the other behind.
it('vram and description text are derived from vramGB, not a separately hand-typed number', () => {
  const nineB = ONBOARDING_MODELS.find(m => m.name === 'qwen3.5-9b')!
  expect(nineB.vram).toContain(String(nineB.vramGB))
  expect(nineB.description).toContain(String(nineB.vramGB))
})

it('both onboarding entries are present and distinct', () => {
  expect(ONBOARDING_MODELS.length).toBeGreaterThanOrEqual(2)
  const names = ONBOARDING_MODELS.map(m => m.name)
  expect(names).toContain('qwen2.5-7b')
  expect(names).toContain('qwen3.5-9b')
})
