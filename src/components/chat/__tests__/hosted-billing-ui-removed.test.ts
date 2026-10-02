import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')

describe('retired hosted billing UI', () => {
  it('is not bundled into Chat or Code and its notice component is gone', () => {
    expect(read('components/chat/ChatView.tsx')).not.toContain('FlashChatNotice')
    expect(read('components/chat/CodexView.tsx')).not.toContain('FlashChatNotice')
    expect(existsSync(new URL('../../../components/chat/FlashChatNotice.tsx', import.meta.url))).toBe(false)
  })
})
