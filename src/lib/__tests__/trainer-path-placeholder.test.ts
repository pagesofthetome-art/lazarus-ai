/**
 * K5 Blocker 1 (Opus review of `4fda5a0a`): the trainer's install-path
 * placeholder used to suggest `~/Lazarus-Trainer` on Mac and Linux, a path Rust
 * never expands (`PathBuf::from` takes it literally). Absolute examples
 * only, mirrored on the Rust side by `example_trainer_path` in
 * `commands/trainer.rs`.
 */
import { describe, expect, it } from 'vitest'
import { trainerPathPlaceholder } from '../trainer-path-placeholder'

describe('trainerPathPlaceholder', () => {
  it('Windows keeps the drive-letter example', () => {
    expect(trainerPathPlaceholder(true, false)).toBe('D:\\Lazarus-Trainer')
  })

  it('THE FIX: Mac gets an absolute example, not a tilde', () => {
    const mac = trainerPathPlaceholder(false, true)
    expect(mac.startsWith('~')).toBe(false)
    expect(mac.startsWith('/')).toBe(true)
  })

  it('THE FIX: Linux gets an absolute example, not a tilde', () => {
    const linux = trainerPathPlaceholder(false, false)
    expect(linux.startsWith('~')).toBe(false)
    expect(linux.startsWith('/')).toBe(true)
  })

  it('DIE ROTE ZAHL: the historic bug, reproduced -- a tilde example on a non-Windows box', () => {
    // What the field showed before this fix. Kept as a literal, negative
    // assertion so a regression back to it fails loudly.
    const oldPlaceholder = (onWindows: boolean) => (onWindows ? 'D:\\Lazarus-Trainer' : '~/Lazarus-Trainer')
    expect(oldPlaceholder(false)).not.toBe(trainerPathPlaceholder(false, false))
    expect(oldPlaceholder(false)).not.toBe(trainerPathPlaceholder(false, true))
  })
})
