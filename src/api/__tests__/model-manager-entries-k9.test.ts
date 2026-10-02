/**
 * K9 nachbessert Runde 3 (GH #136, customer-facing follow-up to Runde 1's
 * classification fix): the coordinator's own repro found that after Krea 2
 * checkpoints classify correctly, the resulting error named two companion
 * files ("Download qwen3vl_4b_fp8_scaled / qwen_image_vae from the Model
 * Manager") that the Model Manager could not actually provide: krea2 had no
 * downloadUrl in COMPONENT_REGISTRY and no entry at all in model-bundles.ts.
 * The customer followed the message and hit a dead end at the next step.
 *
 * This is the systematic guard the coordinator asked for: every
 * `findMatching*` error in comfyui.ts that names a concrete file and points
 * the customer at "the Model Manager" must name a file that a Model Manager
 * bundle (getImageBundles() / getVideoBundles(), model-bundles.ts) actually
 * lists, so the get-path is real instead of aspirational.
 *
 * Run: npx vitest run src/api/__tests__/model-manager-entries-k9.test.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getImageBundles, getVideoBundles, getAudioBundles, getLipsyncBundles, getMotionBundles } from '../model-bundles'

/** Every bundle the Model Manager can actually show a customer, across every
 *  category tab (image/video/audio/lipsync/motion). A file that exists in
 *  only ONE category's getter is still real: findMatching* doesn't know or
 *  care which tab a customer opened. */
function allBundles() {
  return [...getImageBundles(), ...getVideoBundles(), ...getAudioBundles(), ...getLipsyncBundles(), ...getMotionBundles()]
}

const HERE = dirname(fileURLToPath(import.meta.url))
const COMFYUI_SRC = readFileSync(join(HERE, '..', 'comfyui.ts'), 'utf8')

/** Every `throw new Error(...)` line that points the customer at the Model
 *  Manager AND names at least one concrete filename to fetch (the generic
 *  "download a VAE for your model type" messages carry none and are not
 *  this guard's business: there is nothing to check them against). */
function modelManagerFileClaims(): { line: number; files: string[] }[] {
  const claims: { line: number; files: string[] }[] = []
  COMFYUI_SRC.split('\n').forEach((line, i) => {
    if (!line.trim().startsWith('throw')) return
    if (!line.includes('from the Model Manager')) return
    const files = [...line.matchAll(/"([^"]+\.safetensors)"/g)].map((m) => m[1])
    if (files.length) claims.push({ line: i + 1, files })
  })
  return claims
}

// Documented, justified exceptions: a filename named in a message that is
// provably unreachable in production, so a missing bundle entry strands no
// real customer. Each entry needs a reason a reader can verify in the code.
const EXCEPTIONS: Record<string, string> = {
  // determineStrategy() (dynamic-workflow.ts) returns 'unavailable' for
  // every 'cogvideo' model BEFORE buildDynamicWorkflow ever reaches VAE
  // resolution (comment there: "the gate deliberately STAYS closed"). The
  // findMatchingVAE 'cogvideo' branch and its cogvideox_vae_bf16.safetensors
  // message are therefore dead code no live request can trigger, unlike
  // krea2's branch, which a customer hit directly.
  'cogvideox_vae_bf16.safetensors': "determineStrategy gates 'cogvideo' to unavailable before VAE resolution runs, see dynamic-workflow.ts",
}

describe('every Model Manager download hint names a file the Model Manager can actually get (K9)', () => {
  it('sanity: the scanner finds claims, and Krea 2s among them', () => {
    const claims = modelManagerFileClaims()
    expect(claims.length).toBeGreaterThan(10)
    expect(claims.some((c) => c.files.includes('qwen_image_vae.safetensors'))).toBe(true)
    expect(claims.some((c) => c.files.includes('qwen3vl_4b_fp8_scaled.safetensors'))).toBe(true)
  })

  it('every named file is listed in a real Model Manager bundle, or is a documented dead-code exception', () => {
    const bundleFiles = new Set(allBundles().flatMap((b) => b.files.map((f) => f.filename)))
    const missing: string[] = []
    for (const { line, files } of modelManagerFileClaims()) {
      for (const file of files) {
        if (bundleFiles.has(file)) continue
        if (file in EXCEPTIONS) continue
        missing.push(`comfyui.ts:${line} "${file}"`)
      }
    }
    expect(
      missing,
      `File(s) named in a "from the Model Manager" error but absent from every Model Manager ` +
      `bundle: ${missing.join(', ')}. Add the file to a bundle in model-bundles.ts with a ` +
      `verified downloadUrl, or add a justified, reasoned EXCEPTIONS entry above.`,
    ).toEqual([])
  })

  it('Krea 2s two companion files are both in the "Krea 2 Companion Files" bundle, with a downloadUrl', () => {
    const bundle = getImageBundles().find((b) => b.workflow === 'krea2')
    expect(bundle).toBeDefined()
    const byName = (n: string) => bundle!.files.find((f) => f.filename === n)
    expect(byName('qwen3vl_4b_fp8_scaled.safetensors')?.downloadUrl).toMatch(/^https:\/\//)
    expect(byName('qwen_image_vae.safetensors')?.downloadUrl).toMatch(/^https:\/\//)
  })
})
