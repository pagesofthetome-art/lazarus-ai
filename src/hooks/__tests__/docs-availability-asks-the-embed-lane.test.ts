/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement } from 'react'
import { render, screen, cleanup, waitFor, act } from '@testing-library/react'
import { useDocsAvailability } from '../useDocsAvailability'
import { __resetEmbedLaneForTests, EMBED_LANE_RETRY_MS } from '../useEmbedLane'
import { DOCS_TITLE_LOCAL_INDEX, DOCS_TITLE_NO_EMBEDDINGS } from '../../lib/docs-availability'
import type { EmbedLaneInfo } from '../../api/embed-availability'

const probe = vi.fn<() => Promise<EmbedLaneInfo>>()
vi.mock('../../api/embed-availability', async (orig) => ({
  ...(await orig<typeof import('../../api/embed-availability')>()),
  embeddingLane: () => probe(),
}))

function Probe() {
  const value = useDocsAvailability()
  return createElement('div', {
    'data-testid': 'state',
    'data-needs-setup': String(value.needsSetup),
    'data-enabled': String(value.enabled),
    'data-lane': String(value.lane),
    title: value.title,
  })
}

const state = () => screen.getByTestId('state')

beforeEach(() => {
  probe.mockReset()
  __resetEmbedLaneForTests()
})
afterEach(() => {
  cleanup()
  __resetEmbedLaneForTests()
  vi.useRealTimers()
})

describe('the composer reads the shared embedding lane for every profile', () => {
  it('measures a working local lane and explains that full documents stay here', async () => {
    probe.mockResolvedValue({ lane: 'bundled', endpoint: null })
    render(createElement(Probe))
    await waitFor(() => expect(state().getAttribute('data-lane')).toBe('bundled'))
    expect(probe).toHaveBeenCalledTimes(1)
    expect(state().getAttribute('data-needs-setup')).toBe('false')
    expect(state().getAttribute('title')).toBe(DOCS_TITLE_LOCAL_INDEX)
  })

  it('marks a missing lane as setup-needed while keeping the button pressable', async () => {
    probe.mockResolvedValue({ lane: 'none', endpoint: null })
    render(createElement(Probe))
    await waitFor(() => expect(state().getAttribute('data-needs-setup')).toBe('true'))
    expect(state().getAttribute('data-enabled')).toBe('true')
    expect(state().getAttribute('title')).toBe(DOCS_TITLE_NO_EMBEDDINGS)
  })

  it('names a remote indexing host in the tooltip', async () => {
    probe.mockResolvedValue({ lane: 'ollama-remote', endpoint: 'http://192.168.0.54:11434' })
    render(createElement(Probe))
    await waitFor(() => expect(state().getAttribute('data-lane')).toBe('ollama-remote'))
    expect(state().getAttribute('title')).toContain('192.168.0.54')
    expect(state().getAttribute('title')).toContain('full text of each document is sent there')
  })

  it('rechecks after a model inventory refresh', async () => {
    probe.mockResolvedValue({ lane: 'none', endpoint: null })
    render(createElement(Probe))
    await waitFor(() => expect(probe).toHaveBeenCalledTimes(1))
    probe.mockResolvedValue({ lane: 'bundled', endpoint: null })
    await act(async () => window.dispatchEvent(new CustomEvent('lu-models-refresh')))
    await waitFor(() => expect(probe).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(state().getAttribute('data-lane')).toBe('bundled'))
  })

  it('retries a negative startup probe once and stops after unmount', async () => {
    vi.useFakeTimers()
    probe.mockResolvedValue({ lane: 'none', endpoint: null })
    const view = render(createElement(Probe))
    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(1))
    probe.mockResolvedValue({ lane: 'bundled', endpoint: null })
    await act(async () => vi.advanceTimersByTimeAsync(EMBED_LANE_RETRY_MS))
    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(2))
    view.unmount()
    await act(async () => vi.advanceTimersByTimeAsync(EMBED_LANE_RETRY_MS * 4))
    expect(probe).toHaveBeenCalledTimes(2)
  })
})
