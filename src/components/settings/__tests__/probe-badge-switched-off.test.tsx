// @vitest-environment jsdom
/**
 * D1 (3.0.1): Troubleshoot showed "Reachable" for Ollama even with the
 * provider switched off in Settings, and (the other direction, T5) "Not
 * running" a moment after a real 200 answer. `health.rs:246` probes a fixed
 * default address and knows nothing about the frontend's on/off switch, the
 * Rust half of the fix (ask the CONFIGURED address, `AppState::ollama_base`)
 * is out of scope for this repo/pass (no Rust here). This is the half TS can
 * fix on its own: the badge now says BOTH facts when they disagree,
 * reachable, but the user turned it off, instead of a plain "Reachable"
 * that reads as "in use".
 *
 * Run: npx vitest run src/components/settings/__tests__/probe-badge-switched-off.test.tsx
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProbeBadge, type BackendProbe } from '../SettingsPage'

const reachable: BackendProbe = { status: 'ok', detail: '', endpoint: 'http://127.0.0.1:11434' }

describe('D1: ProbeBadge names both facts when they disagree', () => {
  it('plain "Reachable" when the backend is on, same as before', () => {
    render(<ProbeBadge probe={reachable} switchedOff={false} />)
    expect(screen.getByText('Reachable')).toBeTruthy()
  })

  it('"Reachable, switched off" when the process answers but the user turned it off', () => {
    render(<ProbeBadge probe={reachable} switchedOff={true} />)
    expect(screen.getByText('Reachable, switched off')).toBeTruthy()
    expect(screen.queryByText('Reachable')).toBeNull()
  })

  it('switchedOff has no effect on a real "Not running": never invents a sentence for a status that already says no', () => {
    const unreachable: BackendProbe = { status: 'unreachable', detail: '', endpoint: 'http://127.0.0.1:11434' }
    render(<ProbeBadge probe={unreachable} switchedOff={true} />)
    expect(screen.getByText('Not running')).toBeTruthy()
  })
})
