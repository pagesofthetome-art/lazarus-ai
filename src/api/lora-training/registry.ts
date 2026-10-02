import type {
  LoraTrainerAdapter,
  LoraTrainerCandidate,
  LoraTrainerId,
  LoraTrainerSelection,
  LoraTrainingEnvironment,
  LoraTrainingRequest,
} from './types'

const adapters = new Map<LoraTrainerId, LoraTrainerAdapter>()

/** Register once at adapter initialization; conflicting IDs are programming errors. */
export function registerLoraTrainer(adapter: LoraTrainerAdapter): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(adapter.id)) {
    throw new Error(`Invalid LoRA trainer ID: ${adapter.id}`)
  }
  const existing = adapters.get(adapter.id)
  if (existing && existing !== adapter) {
    throw new Error(`LoRA trainer is already registered: ${adapter.id}`)
  }
  adapters.set(adapter.id, adapter)
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/** Return a new list in stable ID order, independent of module import order. */
export function listLoraTrainers(): LoraTrainerAdapter[] {
  return [...adapters.values()].sort((a, b) => compareIds(a.id, b.id))
}

const readinessOrder = { ready: 0, 'missing-input': 1, unsupported: 2 } as const

/** Selection checks capabilities only; it never prepares data or starts training. */
export async function selectLoraTrainer(
  request: LoraTrainingRequest,
  environment: LoraTrainingEnvironment,
): Promise<LoraTrainerSelection> {
  const failures: string[] = []
  const candidates: LoraTrainerCandidate[] = []
  // Stable evaluation order also keeps diagnostic ordering deterministic.
  for (const adapter of listLoraTrainers()) {
    try {
      const compatibility = await adapter.canTrain(request, environment)
      if (!Number.isFinite(compatibility.score)) {
        throw new Error('The compatibility score is not a finite number.')
      }
      candidates.push({ adapter, compatibility })
    } catch {
      // Keep adapter internals (which may include URLs or credentials) out of the UI.
      failures.push(`${adapter.label}: the trainer readiness check failed.`)
    }
  }
  candidates.sort((a, b) =>
    readinessOrder[a.compatibility.status] - readinessOrder[b.compatibility.status]
    || b.compatibility.score - a.compatibility.score
    || compareIds(a.adapter.id, b.adapter.id),
  )

  const best = candidates[0]
  if (best && best.compatibility.status !== 'unsupported') {
    return {
      status: best.compatibility.status,
      adapter: best.adapter,
      candidates,
      reason: best.compatibility.reason,
    }
  }
  if (failures.length) {
    return { status: 'error', adapter: null, candidates, reason: failures[0] }
  }
  if (best) {
    return { status: 'unsupported', adapter: null, candidates, reason: best.compatibility.reason }
  }
  return {
    status: 'unsupported',
    adapter: null,
    candidates,
    reason: 'No LoRA trainers are available on this computer.',
  }
}
