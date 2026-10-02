import { describe, it, expect } from 'vitest'
import { migratePersistedChat } from '../chatStore'
import { groupAgentBlocks } from '../../lib/tool-call-groups'
import { markStaleWorkflowProgressStoppedOnBlock } from '../../lib/workflow-progress-view'
import type { AgentBlock, AgentToolCall } from '../../types/agent-mode'

const legacyCall: AgentToolCall = {
  id: 't1',
  toolName: 'web_search',
  args: { query: 'x' },
  status: 'completed',
  timestamp: 1,
}

/**
 * The migration mutates in place and hands back the SAME object, so the
 * assertions below need a typed view of it. `migratePersistedChat` itself
 * reports `unknown`, which is honest: it takes whatever a previous build of
 * the app persisted.
 */
interface PersistedBlock {
  id: string
  toolCall?: AgentToolCall
  toolCalls?: AgentToolCall[]
}
interface PersistedChat {
  conversations: { messages: { content?: string; agentBlocks?: PersistedBlock[] }[] }[]
}
const migrated = (state: unknown): PersistedChat => migratePersistedChat(state) as PersistedChat

describe('chatStore — migratePersistedChat', () => {
  it('returns null/undefined/non-object shapes unchanged', () => {
    expect(migratePersistedChat(null)).toBe(null)
    expect(migratePersistedChat(undefined)).toBe(undefined)
    expect(migratePersistedChat({})).toEqual({})
  })

  it('leaves conversations without agentBlocks untouched', () => {
    const state = {
      conversations: [
        {
          id: 'c1',
          messages: [{ id: 'm1', role: 'user', content: 'hi' }],
        },
      ],
    }
    const result = migrated(state)
    expect(result.conversations[0].messages[0].content).toBe('hi')
  })

  it('wraps legacy singular toolCall into toolCalls array across nested messages', () => {
    const block: AgentBlock = {
      id: 'b1',
      phase: 'tool_call',
      content: '',
      timestamp: 1,
      toolCall: legacyCall,
    }
    const state = {
      conversations: [
        {
          id: 'c1',
          messages: [
            {
              id: 'm1',
              role: 'assistant',
              content: 'ok',
              agentBlocks: [block],
            },
          ],
        },
      ],
    }
    const result = migrated(state)
    const migratedBlock = result.conversations[0].messages[0].agentBlocks![0]
    expect(migratedBlock.toolCalls).toEqual([legacyCall])
    expect(migratedBlock.toolCall).toBe(legacyCall) // preserved for transition
  })

  it('migrates multiple blocks in multiple conversations', () => {
    const state = {
      conversations: [
        {
          id: 'c1',
          messages: [
            {
              id: 'm1',
              agentBlocks: [
                { id: 'b1', phase: 'tool_call', content: '', timestamp: 1, toolCall: legacyCall },
                { id: 'b2', phase: 'thinking', content: 'hmm', timestamp: 2 },
              ],
            },
          ],
        },
        {
          id: 'c2',
          messages: [
            {
              id: 'm2',
              agentBlocks: [
                { id: 'b3', phase: 'tool_call', content: '', timestamp: 3, toolCall: { ...legacyCall, id: 't2' } },
              ],
            },
          ],
        },
      ],
    }
    const result = migrated(state)
    expect(result.conversations[0].messages[0].agentBlocks![0].toolCalls).toHaveLength(1)
    // Non-tool block untouched.
    expect(result.conversations[0].messages[0].agentBlocks![1].toolCalls).toBeUndefined()
    expect(result.conversations[1].messages[0].agentBlocks![0].toolCalls?.[0].id).toBe('t2')
  })

  it('is idempotent — re-running migration does not double-wrap', () => {
    const state = {
      conversations: [
        {
          id: 'c1',
          messages: [
            {
              id: 'm1',
              agentBlocks: [
                {
                  id: 'b1',
                  phase: 'tool_call',
                  content: '',
                  timestamp: 1,
                  toolCall: legacyCall,
                  toolCalls: [legacyCall],
                },
              ],
            },
          ],
        },
      ],
    }
    const once = migratePersistedChat(state)
    const twice = migrated(once)
    expect(twice.conversations[0].messages[0].agentBlocks![0].toolCalls).toEqual([legacyCall])
  })

  it('handles malformed agentBlocks array without crashing', () => {
    const state = {
      conversations: [
        {
          id: 'c1',
          messages: [
            {
              id: 'm1',
              agentBlocks: [null, undefined, { id: 'b1', phase: 'tool_call', content: '', timestamp: 1 }],
            },
          ],
        },
      ],
    }
    expect(() => migratePersistedChat(state)).not.toThrow()
  })

  it('tolerates non-array conversations gracefully', () => {
    expect(migratePersistedChat({ conversations: 'not-an-array' })).toEqual({ conversations: 'not-an-array' })
  })

  // The per-answer "Memory sources" chip (and the field feeding it) was
  // removed 2026-09-19: the purple brain icon in the session strip below
  // the transcript still opens Memory, so repeating it under every reply
  // was dropped.
  // A conversation saved by an older build can still carry `memorySources`
  // on its messages. There is no migration for it, it is simply ignored.
  it('loads an old message carrying the retired memorySources field without breaking', () => {
    const state = {
      conversations: [
        {
          id: 'c1',
          messages: [
            {
              id: 'm1',
              role: 'assistant',
              content: 'hi',
              memorySources: { ids: ['old-1'], scope: 'legacy', owner: 'A' },
            },
          ],
        },
      ],
    }
    expect(() => migratePersistedChat(state)).not.toThrow()
    const result = migrated(state)
    expect(result.conversations[0].messages[0].content).toBe('hi')
  })

  // review-wfprogress.md, BLOCKER (Runde 2 -> B2 in Runde 3), app-restart
  // case: the app can be closed mid-workflow-run, which persists a progress
  // block whose `status` is still 'running': no process survives a restart
  // to ever move it out of that state, so on the NEXT load (this migration,
  // which runs on every load) it must be rewritten as honestly 'stopped'
  // instead of showing a spinner for a run that provably is not happening.
  //
  // B2 (Runde 3): `MessageBubble.tsx` -> `groupAgentBlocks`
  // (tool-call-groups.ts) reads ONLY the legacy singular `block.toolCall`,
  // never `toolCalls`. A live progress block writes both fields to the SAME
  // object, but a JSON persist round-trip (save, then a later load) turns
  // them into two SEPARATE objects with equal starting content, so a fix
  // that only rewrote `toolCalls` (Runde 2) never reached the screen. Every
  // test below therefore constructs `toolCall` and `toolCalls[0]` as two
  // DISTINCT objects, exactly what `coalescedJSONStorage` produces, and
  // asserts through `groupAgentBlocks` itself, the same function
  // `MessageBubble` calls to decide what to render, not through either raw
  // field directly.
  describe('markiert einen ueber den Neustart hinweg "running" gebliebenen Workflow-Block als "stopped" (B2: auch am Renderpfad)', () => {
    /** Builds the block the way a JSON persist round-trip actually leaves
     *  it: `toolCall` and `toolCalls[0]` carry the same content but are two
     *  separate object instances, never the same reference. */
    function persistedProgressBlock(toolName: string, status: string) {
      const toolCall = { id: 'p1', toolName, args: {}, status, timestamp: 1 }
      const toolCalls = [{ id: 'p1', toolName, args: {}, status, timestamp: 1 }]
      return { id: 'b1', phase: 'tool_call', content: toolName, timestamp: 1, toolCall, toolCalls }
    }

    it('bei einem einzelnen Fortschrittsblock, GEPRUEFT ueber groupAgentBlocks (den echten Renderpfad)', () => {
      const state = {
        conversations: [
          {
            id: 'c1',
            messages: [
              {
                id: 'm1',
                content: 'Running workflow: **Research Topic**',
                agentBlocks: [persistedProgressBlock('Step 2 of 3: Summarize', 'running')],
              },
            ],
          },
        ],
      }
      const result = migrated(state)
      const block = result.conversations[0].messages[0].agentBlocks![0] as unknown as AgentBlock
      // Both raw fields are fixed...
      expect(block.toolCalls![0].status).toBe('stopped')
      expect(block.toolCall!.status).toBe('stopped')
      // ...and, decisively, so is what the chat surface would actually show.
      const groups = groupAgentBlocks([block])
      expect(groups).toHaveLength(1)
      expect(groups[0].kind).toBe('tools')
      const rendered = groups[0].kind === 'tools' ? groups[0].calls[0] : undefined
      expect(rendered!.status).not.toBe('running')
      expect(rendered!.status).toBe('stopped')
      // klein 2 (Runde 3): the workflow's own name survives, pulled from the
      // trigger message, instead of a fully generic label.
      expect(rendered!.toolName).toContain('Research Topic')
    })

    it('NEGATIVKONTROLLE: eine Migration, die nur toolCalls fixt (der Runde-2-Stand), bleibt am Renderpfad "running"', () => {
      // Reproduces the exact shape Opus measured against the pre-B2-fix
      // migration: `toolCalls[0]` gets rewritten, `toolCall` does not, so
      // groupAgentBlocks (which reads only `toolCall`) still shows 'running'.
      // This is what proves the assertion above is not vacuous.
      const block = persistedProgressBlock('Step 2 of 3: Summarize', 'running')
      block.toolCalls[0].status = 'stopped'
      block.toolCalls[0].toolName = 'Workflow stopped before finishing'
      // block.toolCall left untouched on purpose, matching the Runde-2 bug.
      const groups = groupAgentBlocks([block as unknown as AgentBlock])
      const rendered = groups[0].kind === 'tools' ? groups[0].calls[0] : undefined
      expect(rendered!.status).toBe('running')
    })

    it('NEGATIVKONTROLLE: ein echter, noch laufender Werkzeug-Aufruf bleibt "running"', () => {
      // Without the isWorkflowProgressToolName() guard, this would also get
      // rewritten to 'stopped', which would be wrong the moment a tool
      // call is shown mid-flight in the SAME session (no restart happened).
      const state = {
        conversations: [
          { id: 'c1', messages: [{ id: 'm1', agentBlocks: [persistedProgressBlock('shell_execute', 'running')] }] },
        ],
      }
      const result = migrated(state)
      const block = result.conversations[0].messages[0].agentBlocks![0] as unknown as AgentBlock
      expect(block.toolCall!.status).toBe('running')
      const groups = groupAgentBlocks([block])
      const rendered = groups[0].kind === 'tools' ? groups[0].calls[0] : undefined
      expect(rendered!.status).toBe('running')
    })

    it('bereits abgeschlossene Workflow-Bloecke bleiben unangetastet', () => {
      const state = {
        conversations: [
          { id: 'c1', messages: [{ id: 'm1', agentBlocks: [persistedProgressBlock('Workflow: Research Topic (3/3 steps)', 'completed')] }] },
        ],
      }
      const result = migrated(state)
      const block = result.conversations[0].messages[0].agentBlocks![0] as unknown as AgentBlock
      expect(block.toolCall!.status).toBe('completed')
      expect(block.toolCalls![0].status).toBe('completed')
    })

    it('ist idempotent ueber die legacy toolCall/toolCalls-Migration hinweg (nur toolCall, kein toolCalls)', () => {
      const staleLegacyCall: AgentToolCall = {
        id: 'p1', toolName: 'Workflow: Research Topic (1/3 steps)', args: {}, status: 'running', timestamp: 1,
      }
      const state = {
        conversations: [
          { id: 'c1', messages: [{ id: 'm1', agentBlocks: [{ id: 'b1', phase: 'tool_call', content: '', timestamp: 1, toolCall: staleLegacyCall }] }] },
        ],
      }
      const once = migratePersistedChat(state)
      const twice = migrated(once)
      const tc = twice.conversations[0].messages[0].agentBlocks![0].toolCalls![0]
      expect(tc.status).toBe('stopped')
      // migrateBlockInPlace synced `toolCalls` from `toolCall` as the SAME
      // object BEFORE the stale-check ran (only `toolCall` existed at that
      // point), so this stays true here; the two-object case above is what
      // covers the "already both present, already diverged" shape.
      expect(twice.conversations[0].messages[0].agentBlocks![0].toolCall!.status).toBe('stopped')
    })

    it('erhaelt den Workflow-Namen ueber markStaleWorkflowProgressStoppedOnBlock, faellt sonst auf das generische Label zurueck', () => {
      // Direct unit coverage of the two helpers B2's fix is built from, one
      // level below the full migration.
      const named = { toolCall: { toolName: 'Step 1 of 1: Go', status: 'running' } }
      markStaleWorkflowProgressStoppedOnBlock(named, 'Summarize URL')
      expect(named.toolCall.toolName).toBe('Workflow: Summarize URL (stopped before finishing)')

      const anonymous = { toolCall: { toolName: 'Step 1 of 1: Go', status: 'running' } }
      markStaleWorkflowProgressStoppedOnBlock(anonymous)
      expect(anonymous.toolCall.toolName).toBe('Workflow stopped before finishing')
    })
  })
})
