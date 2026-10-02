import type { ToolCategory } from '../api/mcp/types'

/** Tool categories the coding surface may offer, subject to user permissions. */
export const CODEX_CATEGORIES: readonly ToolCategory[] = [
  'filesystem', 'terminal', 'system', 'web', 'image', 'video', 'workflow', 'database',
]
