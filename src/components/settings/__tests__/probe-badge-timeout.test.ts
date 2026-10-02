// @vitest-environment jsdom
/**
 * R8/T5 (2026-09-18): the Rust `system_health` probe now returns a third,
 * non-error outcome -- `timeout` -- for a backend that accepted the
 * connection but did not answer within the probe window (a cold-starting or
 * busy local server), instead of folding it into `unreachable` ("Not
 * running"), which told the owner of a live-but-slow backend to go restart
 * something that was fine.
 *
 * This renders the REAL `ProbeBadge` component (exported from SettingsPage
 * for exactly this) instead of parsing its source text. A source-text test
 * broke the first time an unrelated rename touched the same lines (review
 * 2026-09-18: fix/301-chat renames `labels`/`colors` to `label`/`color` in
 * the same block) even though the rendered behaviour never changed --
 * behaviour is what this file now pins.
 *
 * Run: npx vitest run src/components/settings/__tests__/probe-badge-timeout.test.ts
 */
import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ProbeBadge, type BackendProbe } from '../SettingsPage'

afterEach(() => {
  cleanup()
})

function probe(status: BackendProbe['status']): BackendProbe {
  return { status, detail: '', endpoint: 'http://127.0.0.1:11434/api/tags' }
}

describe('ProbeBadge renders the timeout status distinctly from unreachable/error/ok', () => {
  it('shows "Reachable, slow to answer" for a timeout probe, never "Not running"', () => {
    render(ProbeBadge({ probe: probe('timeout') }))
    expect(screen.getByText('Reachable, slow to answer')).toBeTruthy()
    expect(screen.queryByText('Not running')).toBeNull()
  })

  it('still shows the ordinary labels for the other three statuses', () => {
    render(ProbeBadge({ probe: probe('ok') }))
    expect(screen.getByText('Reachable')).toBeTruthy()
    cleanup()

    render(ProbeBadge({ probe: probe('unreachable') }))
    expect(screen.getByText('Not running')).toBeTruthy()
    cleanup()

    render(ProbeBadge({ probe: probe('error') }))
    expect(screen.getByText('Error')).toBeTruthy()
  })

  it('colors timeout the same calm gray as unreachable, never amber/yellow', () => {
    // lib/hinweis.ts HARTE REGEL (04.09.2026, guarded separately by
    // kein-gelb-in-der-oberflaeche.test.ts): exactly two tones exist, ruhig
    // (gray) and fehler (red) -- no third "in-between" color for a state
    // that is neither an error nor urgent.
    const { container: timeoutBox } = render(ProbeBadge({ probe: probe('timeout') }))
    const timeoutClasses = timeoutBox.querySelector('span')?.className ?? ''
    cleanup()

    const { container: unreachableBox } = render(ProbeBadge({ probe: probe('unreachable') }))
    const unreachableClasses = unreachableBox.querySelector('span')?.className ?? ''
    cleanup()

    const { container: okBox } = render(ProbeBadge({ probe: probe('ok') }))
    const okClasses = okBox.querySelector('span')?.className ?? ''

    expect(timeoutClasses).not.toBe('')
    expect(timeoutClasses).toBe(unreachableClasses)
    expect(timeoutClasses).not.toBe(okClasses)
    expect(timeoutClasses).not.toMatch(/\b(?:amber|yellow)-/)
  })

  it('carries the endpoint/detail as the title, so "why" stays one hover away', () => {
    render(ProbeBadge({ probe: { status: 'timeout', detail: 'timed out after 1500ms', endpoint: 'http://127.0.0.1:11434/api/tags' } }))
    const badge = screen.getByText('Reachable, slow to answer')
    expect(badge.getAttribute('title')).toBe('timed out after 1500ms')
  })
})
