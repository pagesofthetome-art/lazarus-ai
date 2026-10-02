import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const config = JSON.parse(readFileSync(resolve(process.cwd(), 'src-tauri/tauri.conf.json'), 'utf8')) as {
  app?: { security?: { csp?: string } }
}
const csp = config.app?.security?.csp ?? ''

describe('desktop plugin network policy', () => {
  it('allows only the remote hosts required by implemented service adapters', () => {
    expect(csp).toContain('https://oauth2.googleapis.com')
    expect(csp).toContain('https://www.googleapis.com')
    expect(csp).toContain('https://api.github.com')
    expect(csp).toContain('https://*.supabase.co')
  })
})
