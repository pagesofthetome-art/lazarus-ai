/**
 * @vitest-environment jsdom
 *
 * B1 Runde 2, Punkt 1 und 4: the visible half of `lib/background-shutdown.ts`.
 * Stopping work without saying so is the same complaint that opened this
 * whole Nachbesserung: a stop the user cannot see is not a stop they can
 * act on.
 *
 * Run: npx vitest run src/components/layout/__tests__/background-shutdown-banner.test.tsx
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { BackgroundShutdownBanner } from '../BackgroundShutdownBanner'
import { useBackgroundShutdownStore } from '../../../stores/backgroundShutdownStore'

beforeEach(() => useBackgroundShutdownStore.setState({ notice: null }))
afterEach(() => cleanup())

describe('BackgroundShutdownBanner', () => {
  it('shows nothing when there is no notice', () => {
    render(<BackgroundShutdownBanner />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('says the connection is down, in English, without claiming work stopped', () => {
    useBackgroundShutdownStore.setState({ notice: { kind: 'offline' } })
    render(<BackgroundShutdownBanner />)
    const line = screen.getByRole('status')
    expect(line.textContent).toContain('Connection lost')
    expect(line.textContent).not.toContain('stopped')
  })

  it('says background work was actually stopped, after the window was closed', () => {
    useBackgroundShutdownStore.setState({ notice: { kind: 'hidden-stopped', at: Date.now() } })
    render(<BackgroundShutdownBanner />)
    const line = screen.getByRole('status')
    expect(line.textContent).toContain('Closing the window stopped background agent work')
    expect(line.textContent).toContain('Send a new message')
  })

  it('dismiss clears the notice', () => {
    useBackgroundShutdownStore.setState({ notice: { kind: 'offline' } })
    render(<BackgroundShutdownBanner />)
    fireEvent.click(screen.getByLabelText('Dismiss'))
    expect(useBackgroundShutdownStore.getState().notice).toBeNull()
  })
})
