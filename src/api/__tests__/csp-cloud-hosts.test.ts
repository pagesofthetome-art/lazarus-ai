/**
 * Keep explicit user-configured providers available while ensuring the retired
 * first-party account and inference hosts are no longer trusted by the app.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const conf = JSON.parse(readFileSync(resolve(here, '../../../src-tauri/tauri.conf.json'), 'utf8'))
const csp: string = conf.app.security.csp
const connectSrc = (csp.split(';').find((d) => d.trim().startsWith('connect-src')) ?? '').trim()

describe('CSP connect-src cloud provider hosts (GH #71)', () => {
  it.each([
    'https://openrouter.ai',
    'https://api.openai.com',
    'https://api.groq.com',
    'https://api.together.xyz',
    'https://api.deepseek.com',
    'https://api.mistral.ai',
    'https://api.anthropic.com',
  ])('connect-src whitelists %s', (host) => {
    expect(connectSrc).toContain(host)
  })

  it('keeps the existing localhost + model-download hosts', () => {
    expect(connectSrc).toContain("'self'")
    expect(connectSrc).toContain('http://localhost:*')
    expect(connectSrc).toContain('https://civitai.com')
    expect(connectSrc).toContain('https://huggingface.co')
    expect(connectSrc).toContain('https://ollama.com')
  })

  it('does not trust a first-party hosted account or inference service', () => {
    expect(csp).not.toMatch(/supabase\.co|lu-labs\.ai|locallyuncensored\.com/i)
  })
})
