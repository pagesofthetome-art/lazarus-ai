/**
 * aq (3.0.1): `detect_all_comfyui_installs` and the legacy `find_comfyui`
 * both reason from disk paths and can both come back empty even while
 * ComfyUI is genuinely running (a hand-launched venv, a network path,
 * anything the scan heuristics do not look at). `probeRunningComfyPort` is
 * the one further fallback: knock on the configured port's own HTTP
 * endpoint before calling it not found.
 *
 * Run: npx vitest run src/components/onboarding/__tests__/comfy-port-probe.test.ts
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { probeRunningComfyPort } from '../comfyPortProbe'

describe('aq: probeRunningComfyPort', () => {
  it('a responding port reads as found', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true }))
    expect(await probeRunningComfyPort(fetchFn, 'http://127.0.0.1:8188/internal/folder_paths')).toBe(true)
    expect(fetchFn).toHaveBeenCalledWith('http://127.0.0.1:8188/internal/folder_paths', { timeoutMs: 2000 })
  })

  it('NEGATIVE CONTROL: a non-OK response reads as not found', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false }))
    expect(await probeRunningComfyPort(fetchFn, 'http://127.0.0.1:8188/internal/folder_paths')).toBe(false)
  })

  it('NEGATIVE CONTROL: a refused connection (throws) reads as not found, not as an error', async () => {
    const fetchFn = vi.fn(async () => { throw new Error('ECONNREFUSED') })
    await expect(probeRunningComfyPort(fetchFn, 'http://127.0.0.1:8188/internal/folder_paths')).resolves.toBe(false)
  })

  it('NEGATIVE CONTROL: a timeout (the caller aborts) reads as not found', async () => {
    const fetchFn = vi.fn(async () => { throw new DOMException('aborted', 'AbortError') })
    await expect(probeRunningComfyPort(fetchFn, 'http://127.0.0.1:8188/internal/folder_paths')).resolves.toBe(false)
  })
})

describe('aq: ComfyStep.tsx wires the probe into the zero-match branch of both paths', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const src = readFileSync(resolve(here, '../ComfyStep.tsx'), 'utf8')

  it('imports probeRunningComfyPort', () => {
    expect(src).toContain("import { probeRunningComfyPort } from './comfyPortProbe'")
  })

  it('calls it after BOTH detect_all_comfyui_installs and legacy find_comfyui come back empty', () => {
    // Once for the detect_all_comfyui_installs success path, once for the
    // catch() degrade path (older builds without that command).
    const hits = src.split("probeRunningComfyPort(localFetch, comfyuiUrl('/internal/folder_paths'))").length - 1
    expect(hits).toBe(2)
  })

  it('a positive probe sets both found and ready', () => {
    const at = src.indexOf('const running = await probeRunningComfyPort')
    const block = src.slice(at, at + 200)
    expect(block).toContain('setComfyFound({ found: running, complete: running })')
    expect(block).toContain('if (running) setComfyReady(true)')
  })
})
