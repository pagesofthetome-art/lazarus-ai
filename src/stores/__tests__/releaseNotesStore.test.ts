import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { useReleaseNotesStore, shouldShowReleaseNotes } from '../releaseNotesStore'
import { RELEASE_NOTES, releaseNoteFor, itemDetail, itemTitle } from '../../lib/release-notes'

const packageVersion = JSON.parse(readFileSync('package.json', 'utf8')).version as string

beforeEach(() => useReleaseNotesStore.setState({ lastNotesVersion: null }))

describe('Lazarus release notes', () => {
  it('includes a note for the current version with useful content', () => {
    const note = releaseNoteFor(packageVersion)
    expect(note).toBeDefined()
    expect(note!.headline.length).toBeGreaterThan(20)
    expect(note!.lines.length).toBeGreaterThanOrEqual(2)
    for (const item of note!.lines) expect(itemDetail(item).trim().length).toBeGreaterThan(0)
  })

  it('contains no retired hosted service pitch, account or pricing copy', () => {
    const text = RELEASE_NOTES.flatMap((note) => [
      note.headline,
      ...note.lines.map(itemDetail),
      ...(note.details ?? []).flatMap((section) => [section.title, ...section.items.map(itemDetail)]),
    ]).join('\n')
    expect(text).not.toMatch(/\bcloud\b|hosted|credits|checkout|subscription|billing|locally uncensored|lu labs/i)
  })

  it('keeps title and detail rendering compatible with both item shapes', () => {
    expect(itemTitle('Plain item')).toBe('Plain item')
    expect(itemDetail({ title: 'Short', detail: 'Long detail' })).toBe('Long detail')
    expect(itemTitle({ detail: 'No short title' })).toBe('No short title')
  })
})

describe('shouldShowReleaseNotes', () => {
  it('shows once after an upgrade when onboarding is complete', () => {
    expect(shouldShowReleaseNotes(packageVersion, null, true)).toBe(true)
    expect(shouldShowReleaseNotes(packageVersion, 'older-version', true)).toBe(true)
  })

  it('stays closed while onboarding runs, after dismissal, and for unknown versions', () => {
    expect(shouldShowReleaseNotes(packageVersion, null, false)).toBe(false)
    expect(shouldShowReleaseNotes(packageVersion, packageVersion, true)).toBe(false)
    expect(shouldShowReleaseNotes('9.9.9', null, true)).toBe(false)
  })

  it('marking the current note seen prevents it from returning', () => {
    expect(shouldShowReleaseNotes(packageVersion, null, true)).toBe(true)
    useReleaseNotesStore.getState().markNotesSeen(packageVersion)
    expect(useReleaseNotesStore.getState().lastNotesVersion).toBe(packageVersion)
    expect(shouldShowReleaseNotes(packageVersion, useReleaseNotesStore.getState().lastNotesVersion, true)).toBe(false)
  })
})