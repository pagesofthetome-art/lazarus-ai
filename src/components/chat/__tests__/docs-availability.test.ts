/** @vitest-environment jsdom */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createElement } from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { DocsButton } from '../DocsButton'
import {
  docsAvailability,
  DOCS_TITLE_PLAIN,
  DOCS_TITLE_LOCAL_INDEX,
  DOCS_TITLE_NO_EMBEDDINGS,
} from '../../../lib/docs-availability'
import type { EmbedLaneInfo } from '../../../api/embed-availability'

const BUNDLED: EmbedLaneInfo = { lane: 'bundled', endpoint: null }
const OLLAMA_LOCAL: EmbedLaneInfo = { lane: 'ollama-local', endpoint: null }
const OLLAMA_REMOTE: EmbedLaneInfo = { lane: 'ollama-remote', endpoint: 'http://192.168.0.54:11434' }
const NONE: EmbedLaneInfo = { lane: 'none', endpoint: null }

afterEach(() => cleanup())

function show(info: EmbedLaneInfo | null, onToggle = () => {}) {
  return render(createElement(DocsButton, {
    availability: docsAvailability(info),
    open: false,
    ragEnabled: false,
    docCount: 0,
    onToggle,
  }))
}

const docs = () => screen.queryByTestId('docs-toggle') as HTMLButtonElement | null

describe('the Docs button reflects the measured indexing lane', () => {
  it('stays pressable while the shared lane probe is running', () => {
    expect(docsAvailability(null)).toEqual({
      visible: true,
      enabled: true,
      needsSetup: false,
      lane: null,
      title: DOCS_TITLE_PLAIN,
    })
  })

  it('reports when documents are indexed on this device', () => {
    for (const info of [BUNDLED, OLLAMA_LOCAL]) {
      const available = docsAvailability(info)
      expect(available).toMatchObject({ visible: true, enabled: true, needsSetup: false })
      expect(available.title).toBe(DOCS_TITLE_LOCAL_INDEX)
    }
  })

  it('names a remote host when it receives full documents for indexing', () => {
    const available = docsAvailability(OLLAMA_REMOTE)
    expect(available.title).toContain('http://192.168.0.54:11434')
    expect(available.title).toContain('full text of each document is sent there')
    expect(available.title).not.toContain('stay on this device')
  })

  it('keeps the button pressable and marks missing embeddings as setup-needed', () => {
    expect(docsAvailability(NONE)).toEqual({
      visible: true,
      enabled: true,
      needsSetup: true,
      lane: 'none',
      title: DOCS_TITLE_NO_EMBEDDINGS,
    })
  })
})

describe('the Docs button renders the measured state', () => {
  it('opens the panel on a working lane', () => {
    const onToggle = vi.fn()
    show(BUNDLED, onToggle)
    const button = docs()!
    expect(button.disabled).toBe(false)
    expect(button.getAttribute('title')).toBe(DOCS_TITLE_LOCAL_INDEX)
    fireEvent.click(button)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('opens the install card when there is no embedding lane', () => {
    const onToggle = vi.fn()
    show(NONE, onToggle)
    const button = docs()!
    expect(button.disabled).toBe(false)
    expect(button.getAttribute('data-needs-setup')).toBe('true')
    expect(button.className).toContain('opacity-60')
    fireEvent.click(button)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('keeps the indexed document count visible', () => {
    render(createElement(DocsButton, {
      availability: docsAvailability(NONE),
      open: false,
      ragEnabled: false,
      docCount: 3,
      onToggle: () => {},
    }))
    expect(docs()!.textContent).toContain('3')
  })
})
