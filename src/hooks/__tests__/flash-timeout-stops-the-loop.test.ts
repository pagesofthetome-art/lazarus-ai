/**
 * R5-53: a 504 with code 'flash_timeout' means the free-tier request already
 * sat out its own four-minute server-side deadline; retrying it repeats that
 * same wait. Before this fix `isTerminalModelError` did not recognise the
 * code (a 504 falls outside "status >= 400 && status < 500"), so the
 * connRetries ladder in useAgentChat.ts retried it up to three times,
 * twelve silent minutes before the run gave up with a generic message.
 *
 * Source-level, matching loop-stops-on-terminal.test.ts: what has to hold is
 * a property of the catch block's control flow, not of a rendered component.
 *
 * Run: npx vitest run src/hooks/__tests__/flash-timeout-stops-the-loop.test.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const agent = readFileSync(resolve(here, '../useAgentChat.ts'), 'utf8')

describe('R5-53: the flash_timeout branch in useAgentChat.ts', () => {
  it('sets loopHalt inside the flash_timeout branch', () => {
    const branch = agent.indexOf("code === 'flash_timeout'")
    const halt = agent.indexOf("loopHalt = 'flash timeout'")
    expect(branch).toBeGreaterThan(-1)
    expect(halt).toBeGreaterThan(-1)
    expect(halt - branch).toBeGreaterThan(0)
    expect(halt - branch).toBeLessThan(500)
  })

  it('leaves the server text standing instead of writing new prose', () => {
    const branch = agent.indexOf("code === 'flash_timeout'")
    const block = agent.slice(branch, branch + 900)
    expect(block).toContain('+ errorMsg')
  })

  it('the driver checks loopHalt before scheduling another pass', () => {
    const halt = agent.indexOf('opts?.loop && convId && loopHalt')
    const schedule = agent.indexOf('agentLoopTimers.set(convForLoop, setTimeout(')
    expect(halt).toBeGreaterThan(-1)
    expect(schedule).toBeGreaterThan(-1)
    expect(halt).toBeLessThan(schedule)
  })
})

describe('R5-53: isTerminalModelError treats flash_timeout like credits_exhausted', () => {
  const httpStatus = readFileSync(resolve(here, '../../lib/http-status.ts'), 'utf8')

  it('the terminal guard checks the code, not just the 4xx range', () => {
    expect(httpStatus).toContain("e?.code === 'flash_timeout'")
  })

  it('NEGATIVE CONTROL: a plain 504 (no code) is not named in the terminal guard', () => {
    // The terminal check is code-based, not status-based, for this one, so a
    // bare 504 must keep falling through to the transient path below it.
    const guardLine = httpStatus.slice(
      httpStatus.indexOf('export function isTerminalModelError'),
      httpStatus.indexOf('return status >= 400'),
    )
    expect(guardLine).not.toMatch(/status === 504/)
  })
})
