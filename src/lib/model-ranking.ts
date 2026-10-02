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
