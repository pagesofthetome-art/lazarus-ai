/**
 * Policy for background model calls such as memory extraction.
 *
 * A retired provider id is kept only as a guard for old persisted model picks:
 * no background call may use it, even if an older profile still has the
 * previous opt-in setting enabled. All supported providers use the active
 * model selected by the user.
 */

/**
 * Whether a silent model call may use this provider. The optional second
 * argument is accepted for older callers but cannot enable retired providers.
 */
export function silentCallAllowed(providerId: string, _legacyOptIn?: boolean): boolean {
  return providerId !== 'lu-cloud'
}

/** Parse parameter count in billions out of a model id (for example `8B`). */
export function paramSizeB(modelId: string): number | null {
  const match = /(\d+(?:\.\d+)?)\s*b(?![a-z0-9])/i.exec(modelId)
  if (!match) return null
  const size = Number(match[1])
  return Number.isFinite(size) && size > 0 ? size : null
}

export interface SilentCallCandidate {
  name: string
  type?: string
  provider?: string
}

/** Background work uses the user's selected model; the candidate list is kept
 * in the signature for call-site compatibility with saved integrations. */
export function pickSilentCallModel(
  activeModel: string,
  _providerId: string,
  _models: readonly SilentCallCandidate[],
): string {
  return activeModel
}
