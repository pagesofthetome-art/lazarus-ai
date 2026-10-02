/**
 * E5: the `cargo-check` matrix in `.github/workflows/ci.yml` must show every
 * platform's failure, not just the first one GitHub Actions happens to
 * cancel the others over.
 *
 * Without `fail-fast: false`, a run broken on BOTH `ubuntu-22.04` and
 * `windows-latest` shows only whichever platform failed first, the other
 * lane gets cancelled before it reports anything. That cost the 3.0.0
 * release night five rounds: fix the Ubuntu failure, push, wait for CI,
 * discover the Windows failure that was there the whole time. `tauri-build`
 * (same file) already carries the fix; this brings `cargo-check` in line
 * with it.
 *
 * Run: npx vitest run src/lib/__tests__/ci-cargo-check-fail-fast.test.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../..')
const CI_YML = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8')

/**
 * The lines belonging to one job, by indentation. Copied from
 * release-build-gate.test.ts rather than imported: that file's helper is
 * module-local, and duplicating four lines here is cheaper than exporting a
 * function whose only other job is proving a different gate.
 */
function jobBlock(yaml: string, job: string): string {
  const lines = yaml.split(/\r?\n/)
  const start = lines.findIndex((l) => l === `  ${job}:`)
  if (start < 0) return ''
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]
    if (/^ {2}[^\s#]/.test(l)) { end = i; break }
    if (/^\S/.test(l) && l.trim() !== '') { end = i; break }
  }
  return lines.slice(start, end).join('\n')
}

describe('ci.yml, cargo-check does not hide the second platform', () => {
  it('has a cargo-check job with both CI platforms', () => {
    const block = jobBlock(CI_YML, 'cargo-check')
    expect(block, 'cargo-check job is gone from ci.yml').not.toBe('')
    expect(block).toContain('ubuntu-22.04')
    expect(block).toContain('windows-latest')
  })

  it('sets fail-fast: false on the cargo-check matrix', () => {
    const block = jobBlock(CI_YML, 'cargo-check')
    // Must sit inside the `strategy:` block, not merely appear as a comment
    //, the negative control below proves the difference matters.
    const strategyStart = block.indexOf('strategy:')
    expect(strategyStart, 'cargo-check has no strategy block at all').toBeGreaterThanOrEqual(0)
    const strategyBlock = block.slice(strategyStart)
    expect(strategyBlock).toMatch(/^\s*fail-fast:\s*false\s*$/m)
  })

  it('negative control: a strategy block with no fail-fast line fails this check', () => {
    // Proves the assertion above is not vacuous (e.g. matching on an empty
    // string). Same shape as the pre-fix job, with fail-fast removed.
    const withoutFix = `  cargo-check:\n    strategy:\n      matrix:\n        platform: [ubuntu-22.04, windows-latest]\n  next-job:\n`
    const strategyStart = withoutFix.indexOf('strategy:')
    const strategyBlock = withoutFix.slice(strategyStart)
    expect(strategyBlock).not.toMatch(/^\s*fail-fast:\s*false\s*$/m)
  })
})
