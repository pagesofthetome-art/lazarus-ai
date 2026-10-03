import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ModelTile } from '../ModelTiles'
import type { DiscoverModel } from '../../../api/discover'

const model: DiscoverModel = {
  name: 'Catalog Test Model',
  description: 'A coding assistant for programming and software engineering.',
  pulls: '120k',
  tags: ['Q4_K_M'],
  updated: '',
  sizeGB: 5,
  agent: true,
}

function renderCard(agent = true) {
  return renderToStaticMarkup(createElement(ModelTile, {
    variants: [{ ...model, agent }],
    vramGb: 12,
    isInstalled: () => false,
    dlState: () => null,
    onDownload: () => {},
    onInfo: () => {},
    onOpenUrl: () => {},
  }))
}

describe('the Models catalog card', () => {
  it('shows the concise task blurb and a separate file-size label', () => {
    const html = renderCard()
    expect(html).toContain('Best for: coding and software tasks; tool-using agent workflows.')
    expect(html).toContain('5 GB')
  })

  it('keeps details and download as accessible actions', () => {
    const html = renderCard()
    expect(html).toContain('aria-label="Details for Catalog Test Model"')
    expect(html).toContain('title="Download 5 GB"')
    expect(html).toContain(' Get</button>')
  })

  it('shows the Agent badge only for models marked agentic', () => {
    expect(renderCard()).toContain('> Agent</span>')
    expect(renderCard(false)).not.toContain('> Agent</span>')
  })
})
