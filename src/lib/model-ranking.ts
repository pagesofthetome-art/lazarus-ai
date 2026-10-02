import type { DiscoverModel } from '../api/model-bundles'

const TASK_TERMS: Record<string, string[]> = {
  coding: ['code', 'coder', 'coding', 'programming', 'developer', 'instruct'],
  chat: ['chat', 'instruct', 'assistant', 'roleplay', 'conversation'],
  vision: ['vision', 'vl', 'image', 'multimodal', 'omni'],
  image: ['image', 'diffusion', 'sdxl', 'flux', 'checkpoint'],
  video: ['video', 'wan', 'animatediff', 'hunyuan', 'framepack', 'ltx'],
  uncensored: ['uncensored', 'ablated', 'abliteration', 'unfiltered', 'roleplay'],
}

/** A transparent, deterministic score used to order model search results. */
export function modelTaskScore(model: DiscoverModel, query: string): number {
  const text = `${model.name} ${model.description} ${model.tags.join(' ')}`.toLowerCase()
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  let score = model.hot ? 8 : 0
  if (model.agent) score += 4
  if (model.lightweight) score += 2
  if (/uncensored|ablated|abliteration|unfiltered/i.test(text)) score += 3
  for (const word of words) {
    if (text.includes(word)) score += 12
    for (const terms of Object.values(TASK_TERMS)) if (terms.includes(word) && terms.some((term) => text.includes(term))) score += 8
  }
  return score
}

export function rankModelsForTask(models: DiscoverModel[], query: string): DiscoverModel[] {
  return models
    .map((model, index) => ({ model, index, score: modelTaskScore(model, query) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ model }) => model)
}

/**
 * Rank curated catalog families from structured capability metadata only.
 * These weights intentionally do not inspect names or descriptions: `agent`
 * is the catalog's explicit tool-use capability, and provider tags are
 * metadata rather than free-text search terms.
 */
export type CatalogPurpose = 'coding' | 'developer' | 'chat' | 'vision'

export function catalogPurposeScore(model: DiscoverModel, purpose: CatalogPurpose): number {
  const tags = new Set(model.tags.map(tag => tag.trim().toLowerCase()))
  const hasTag = (...values: string[]) => values.some(value => tags.has(value))

  if (purpose === 'vision') {
    return hasTag('vision', 'image-text-to-text', 'multimodal') ? 100 : 0
  }
  if (purpose === 'coding') {
    if (hasTag('coding', 'code', 'coder', 'programming')) return 100
    // Tool use is useful for a coding agent, but does not by itself mean a
    // model was trained as a coding specialist.
    return model.agent ? 35 : 0
  }
  if (purpose === 'developer') {
    return model.agent || hasTag('agent', 'tool-use', 'tools', 'function-calling', 'function calling') ? 100 : 0
  }

  let score = 50 // all curated chat models remain eligible
  if (hasTag('chat', 'conversational', 'instruct', 'instruction-tuned')) score += 25
  if (hasTag('roleplay', 'rp')) score += 10
  if (model.agent) score += 5
  return score
}

export function rankCatalogGroupsForPurpose(
  groups: DiscoverModel[][],
  purpose: CatalogPurpose,
): DiscoverModel[][] {
  return groups
    .map((group, index) => ({ group, index, score: Math.max(...group.map(model => catalogPurposeScore(model, purpose))) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ group }) => group)
}
