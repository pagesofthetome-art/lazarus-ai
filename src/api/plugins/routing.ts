import type { PluginCapability, PluginManifest } from './types'

export interface PluginRoute {
  plugin: PluginManifest
  score: number
  reasons: string[]
}

const capabilityTerms: Record<PluginCapability, string[]> = {
  files: ['file', 'folder', 'directory', 'document', 'attachment', 'upload', 'download', 'drive', 'storage'],
  documents: ['document', 'pdf', 'docx', 'sheet', 'spreadsheet', 'report', 'notes', 'text'],
  code: ['code', 'coding', 'program', 'repository', 'repo', 'bug', 'build', 'deploy', 'script', 'apk'],
  database: ['database', 'sql', 'query', 'table', 'rows', 'data', 'record'],
  web: ['web', 'website', 'internet', 'search', 'url', 'browse', 'research'],
  media: ['image', 'picture', 'photo', 'video', 'audio', 'music', 'lora', 'lora', 'generate'],
  calendar: ['calendar', 'schedule', 'meeting', 'appointment', 'event', 'availability'],
  email: ['email', 'mail', 'message', 'inbox', 'contact', 'send'],
  'project-management': ['task', 'project', 'issue', 'ticket', 'board', 'deadline', 'sprint'],
  analytics: ['analytics', 'metric', 'metrics', 'dashboard', 'report', 'monitor', 'log', 'statistics'],
}

/** Rank connected plugins without requiring the user to toggle them manually. */
export function rankPluginsForTask(task: string, plugins: PluginManifest[], connectedIds: ReadonlySet<string>): PluginRoute[] {
  const words = task.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  return plugins
    .filter((plugin) => connectedIds.has(plugin.id) || plugin.connectionState === 'connected')
    .map((plugin) => {
      let score = 10
      const reasons: string[] = []
      const haystack = `${plugin.name} ${plugin.description}`.toLowerCase()
      for (const capability of plugin.capabilities) {
        const terms = capabilityTerms[capability]
        const hits = words.filter((word) => terms.includes(word)).length
        if (hits) {
          score += hits * 18
          reasons.push(`${capability} matches (${hits})`)
        }
      }
      if (words.some((word) => haystack.includes(word))) {
        score += 8
        reasons.push('name or description match')
      }
      if (plugin.connectionState === 'connected' || connectedIds.has(plugin.id)) {
        score += 20
        reasons.push('connected')
      }
      return { plugin, score, reasons }
    })
    .sort((a, b) => b.score - a.score || a.plugin.name.localeCompare(b.plugin.name))
}
