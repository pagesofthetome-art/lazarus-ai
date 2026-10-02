/**
 * K5 Nachbesserung (Opus review of `4fda5a0a`, Blockers 2 and 3): the
 * caption under the trainer's install-path field used to be one hardcoded
 * sentence that stayed on screen even once `trainer_root` was customized,
 * at which point it was false (Blocker 2), and it never said where base
 * model downloads actually go (Blocker 3, they follow the configured model
 * folder, not this field). `trainerRootHint` reads the real backend state
 * instead of assuming the default.
 */
import { describe, expect, it } from 'vitest'
import { trainerRootHint } from '../trainer-root-hint'

describe('trainerRootHint', () => {
  it('the default case: not customized, field empty', () => {
    const hint = trainerRootHint({ root: '/data/lu/musubi', customized: false }, '')
    expect(hint).toContain('Installs to your app data folder by default')
    expect(hint).toContain('configured model folder')
  })

  it('THE FIX: a customized root is named, not the generic default sentence', () => {
    const hint = trainerRootHint({ root: 'E:\\Lazarus-Trainer', customized: true }, 'E:\\Lazarus-Trainer')
    expect(hint).toContain('E:\\Lazarus-Trainer')
    expect(hint).not.toContain('Installs to your app data folder by default')
  })

  it('GEGENPROBE: the old bug -- claiming the default while a customized root is active -- cannot happen', () => {
    // Blocker 2's exact failure: a broken customized install re-shows this
    // gate, and the caption must not say "app data folder" while `root`
    // still names the customer's own drive.
    const hint = trainerRootHint({ root: 'E:\\Lazarus-Trainer', customized: true }, 'E:\\Lazarus-Trainer')
    expect(hint.includes('app data folder by default')).toBe(false)
  })

  it('point 3, the way back: clearing a customized field explains what pressing Set up trainer will do', () => {
    const hint = trainerRootHint({ root: 'E:\\Lazarus-Trainer', customized: true }, '')
    expect(hint).toContain('installs to your app data folder instead')
  })

  it('point 4, no silent orphan: the old files are named as kept, not deleted', () => {
    const hint = trainerRootHint({ root: 'E:\\Lazarus-Trainer', customized: true }, '')
    expect(hint).toContain('E:\\Lazarus-Trainer')
    expect(hint).toContain('are kept, not deleted')
  })

  it('Blocker 3, every branch names where base models actually go', () => {
    for (const [status, value] of [
      [{ root: '/data/lu/musubi', customized: false }, ''],
      [{ root: 'E:\\Lazarus-Trainer', customized: true }, 'E:\\Lazarus-Trainer'],
      [{ root: 'E:\\Lazarus-Trainer', customized: true }, ''],
    ] as const) {
      expect(trainerRootHint(status, value)).toContain('configured model folder')
    }
  })

  it('N1 THE FIX: typing a DIFFERENT path over a pre-filled customized root names the typed path, not the old one', () => {
    // Teil 9, N1: install broke on E:, the gate reopens with the field
    // pre-filled to E:, and the customer retypes F: before pressing the
    // button. The caption has to name F:, the drive the button will use.
    const hint = trainerRootHint({ root: 'E:\\Lazarus-Trainer', customized: true }, 'F:\\Lazarus-Trainer')
    expect(hint).toContain('Installs to F:\\Lazarus-Trainer')
    expect(hint).not.toContain('Installs to E:\\Lazarus-Trainer')
  })

  it('N1 GEGENPROBE: leaving the pre-filled field untouched still names the customized root', () => {
    const hint = trainerRootHint({ root: 'E:\\Lazarus-Trainer', customized: true }, 'E:\\Lazarus-Trainer')
    expect(hint).toContain('Installs to E:\\Lazarus-Trainer')
  })

  it('point 5 THE FIX: a value that matches the suggested root explains why it is already filled in', () => {
    const hint = trainerRootHint({ root: '/data/lu/musubi', customized: false }, '/mnt/e/Lazarus-Trainer', '/mnt/e/Lazarus-Trainer')
    expect(hint).toContain('Installs to /mnt/e/Lazarus-Trainer')
    expect(hint).toContain('Your model folder is on another drive')
    expect(hint).toContain('Clear this field to use the app data folder instead')
  })

  it('point 5 GEGENPROBE: a typed value that happens to differ from the suggestion gets the plain sentence, not the reason', () => {
    const hint = trainerRootHint({ root: '/data/lu/musubi', customized: false }, '/mnt/f/Other', '/mnt/e/Lazarus-Trainer')
    expect(hint).toContain('Installs to /mnt/f/Other')
    expect(hint).not.toContain('Your model folder is on another drive')
  })

  it('point 5 GEGENPROBE: a customized root that happens to equal the suggestion still gets the customized wording', () => {
    // suggestedRoot only applies to the un-customized state; a customer who
    // already made the suggestion their real, saved root gets the normal
    // customized caption, not the "we suggest this folder" one.
    const hint = trainerRootHint({ root: '/mnt/e/Lazarus-Trainer', customized: true }, '/mnt/e/Lazarus-Trainer', '/mnt/e/Lazarus-Trainer')
    expect(hint).not.toContain('Your model folder is on another drive')
    expect(hint).toContain('Clear this field to go back to the app data folder')
  })
})
