import { getProviderIdFromModel } from '../api/providers'

/** Fail closed for a model selection left by an older build. */
export function isRetiredHostedModel(modelName: string | null | undefined): boolean {
  return !!modelName && getProviderIdFromModel(modelName) === 'lu-cloud'
}
