import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const PAGE = readFileSync(resolve(__dirname, '..', 'ModelManager.tsx'), 'utf8')

describe('Models navigation follows the current task-first catalog', () => {
  it('opens directly into Discover and keeps Installed as the explicit alternate view', () => {
    expect(PAGE).toMatch(/useState<'installed' \| 'discover'>\('discover'\)/)
    expect(PAGE).toMatch(/onClick=\{\(\) => setTab\('installed'\)\}/)
    expect(PAGE).toMatch(/aria-pressed=\{tab === 'installed'\}/)
  })

  it('empty Installed states send users back to Get new models', () => {
    expect(PAGE).toContain('Get new models')
    expect(PAGE).toContain('Get new {modeMeta.label.toLowerCase()} models')
    expect(PAGE).not.toContain('Discover text models')
  })

  it('offers a clear All reset after a task recommendation is selected', () => {
    expect(PAGE).toContain("{bestFor && <button")
    expect(PAGE).toContain('title="Show all models"')
    expect(PAGE).toMatch(/setBestFor\(''\)[\s\S]{0,220}setTab\('discover'\)/)
  })
})
