import { describe, expect, it } from 'vitest'
import { RepetitionStop } from '../repetition-stop'

describe('local decoder repetition stop', () => {
  it('stops a run split across individual token deltas', () => {
    const guard = new RepetitionStop()
    for (let i = 0; i < 255; i++) expect(guard.push('?')).toBe(false)
    expect(guard.push('?')).toBe(true)
  })

  it('detects a run inside a large mixed chunk', () => {
    expect(new RepetitionStop().push(`prefix${'?'.repeat(256)}suffix`)).toBe(true)
  })

  it('leaves multilingual text, code and separated questions alone', () => {
    const guard = new RepetitionStop()
    for (let i = 0; i < 1000; i++) {
      expect(guard.push('Hello? 你好? Привет? const x = y ?? 0;\n')).toBe(false)
    }
    expect(guard.push(' '.repeat(4096))).toBe(false)
    expect(guard.push('-'.repeat(4096))).toBe(false)
  })
})
