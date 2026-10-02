import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { isRetiredHostedModel } from '../retired-provider-model'

const here = dirname(fileURLToPath(import.meta.url))

describe('legacy hosted model IDs fail closed', () => {
  it('recognizes only model names routed to the retired provider', () => {
    expect(isRetiredHostedModel('lu-cloud::legacy-model')).toBe(true)
    expect(isRetiredHostedModel('openai::gpt-test')).toBe(false)
    expect(isRetiredHostedModel('anthropic::claude-test')).toBe(false)
    expect(isRetiredHostedModel('llama3:8b')).toBe(false)
  })

  it('checks the retired ID before chat routing and clears the stale selection', () => {
    const source = readFileSync(resolve(here, '../../hooks/useChat.ts'), 'utf8')
    const guard = source.indexOf('isRetiredHostedModel(activeModel)')
    const toolRouting = source.indexOf('resolveChatToolRoute(content')
    expect(guard).toBeGreaterThan(-1)
    expect(toolRouting).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(toolRouting)
    expect(source.slice(guard, guard + 260)).toContain('setActiveModel(null)')
  })
})
