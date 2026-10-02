import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/components/plugins/PluginsPage.tsx'), 'utf8')

describe('plugin connection UI reports actual capability', () => {
  it('shows a configurable Google OAuth client ID instead of hiding the build-time requirement', () => {
    expect(source).toMatch(/Google OAuth client ID/i)
    expect(source).toMatch(/googleClientId/)
  })

  it('does not present metadata-only catalog entries as installable plugins', () => {
    expect(source).toMatch(/Coming soon|Not available yet/)
    expect(source).toMatch(/disabled/)
  })

  it('offers an integration diagnostic in the Plugins screen', () => {
    expect(source).toMatch(/Integration health|Run integration check/)
    expect(source).toMatch(/auditToolIntegrations/)
  })

  it('guides Supabase users to least-privilege publishable keys', () => {
    expect(source).toMatch(/publishable|anon/i)
    expect(source).toMatch(/secret|service.role/i)
  })
})
