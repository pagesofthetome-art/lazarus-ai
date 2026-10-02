import {
  cancelCharacterTraining,
  characterTrainerStatus,
  characterTrainingStatus,
  clearTrainingSet,
  stageTrainingImage,
  startCharacterTraining,
} from '../../trainer'
import type { TrainingRunStatus } from '../../trainer'
import { loraArchitectureKey } from '../../../lib/lora-compatibility'
import { registerLoraTrainer } from '../registry'
import type {
  LoraOutputValidation,
  LoraTrainerAdapter,
  LoraTrainerCompatibility,
  LoraTrainingCallbacks,
  LoraTrainingEnvironment,
  LoraTrainingOutput,
  LoraTrainingPlan,
  LoraTrainingRequest,
  LoraTrainingStatus,
} from '../types'

const ADAPTER_ID = 'zimage-character-local'
const MINIMUM_IMAGES = 4
const POLL_INTERVAL_MS = 1000

export interface ZImageCharacterAdapterOptions {
  readFileBytes(path: string): Promise<number[]>
  fileExistsAndSize?: (path: string, expectedSize: number) => Promise<boolean>
  status?: () => Promise<TrainingRunStatus>
}

function isZImage(family: string | null | undefined): boolean {
  const normalized = (family ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
  return normalized === 'zimage' || loraArchitectureKey(family) === 'zimage'
}

function isLocalSource(source: LoraTrainingRequest['sources'][number]): source is Extract<
  LoraTrainingRequest['sources'][number], { type: 'file' | 'gallery' }
> {
  return (source.type === 'file' || source.type === 'gallery') && source.path.trim().length > 0
}

function localSourceCount(request: LoraTrainingRequest): number {
  return request.sources.filter(isLocalSource).length
}

function safeName(value: string): string {
  return Array.from(value.trim()).map((character) => /[a-z0-9_-]/i.test(character) ? character : '_')
    .join('').replace(/^_+|_+$/g, '').slice(0, 48)
}

export function createZImageCharacterAdapter(options: ZImageCharacterAdapterOptions): LoraTrainerAdapter {
  const readStatus = options.status ?? characterTrainingStatus
  async function canTrain(
    request: LoraTrainingRequest,
    environment: LoraTrainingEnvironment,
  ): Promise<LoraTrainerCompatibility> {
    if ((request.task ?? 'image') !== 'image' || request.intent !== 'character') {
      return { status: 'unsupported', score: 0, reason: 'This adapter supports image character training.' }
    }

    const baseModel = environment.models.find((model) => model.installed
      && model.createSupported && model.task === 'image' && isZImage(model.family)
      && (!request.targetModel?.id || model.id === request.targetModel.id))
    if (!baseModel) {
      return {
        status: 'missing-input', score: 0, missingInputs: ['base-model'],
        reason: 'Install a supported Z-Image model before training.',
      }
    }

    let readiness = environment.trainerStatuses[ADAPTER_ID]
    if (!readiness) {
      try {
        const status = await characterTrainerStatus()
        readiness = { runtimeReady: status.envReady, basesReady: status.basesReady }
      } catch {
        return {
          status: 'missing-input', score: 50, baseModel, missingInputs: ['runtime'],
          reason: 'The local Z-Image trainer readiness could not be checked.',
        }
      }
    }
    if (!readiness.runtimeReady || !readiness.basesReady) {
      return {
        status: 'missing-input', score: 50, baseModel,
        missingInputs: [!readiness.runtimeReady ? 'runtime' : 'base-model'],
        reason: !readiness.runtimeReady ? 'Set up the local Z-Image trainer first.'
          : 'Install the Z-Image training base files first.',
      }
    }
    if (localSourceCount(request) < MINIMUM_IMAGES) {
      return {
        status: 'missing-input', score: 75, baseModel, missingInputs: ['dataset'],
        reason: 'Provide at least 4 file or gallery image sources.',
      }
    }
    return { status: 'ready', score: 100, baseModel, reason: 'Ready to plan local Z-Image character training.' }
  }

  async function validateOutput(
    output: LoraTrainingOutput,
    plan: LoraTrainingPlan,
  ): Promise<LoraOutputValidation> {
    const path = output.path.trim()
    const basename = path.split(/[\\/]/).pop() ?? ''
    const expectedName = safeName(plan.outputName)
    const expected = `char_${expectedName}_zimage.safetensors`.toLowerCase()
    const absolutePath = /^[a-z]:[\\/]/i.test(path) || path.startsWith('\\\\') || path.startsWith('/')
    if (output.family.toLowerCase() !== 'zimage' || output.task !== 'image'
      || !expectedName || !absolutePath || basename.toLowerCase() !== expected
      || !Number.isFinite(output.sizeBytes) || (output.sizeBytes ?? 0) <= 0
      || output.triggerWord !== plan.triggerWord) {
      return { valid: false, reason: 'Expected an absolute Z-Image character LoRA path with the planned name, trigger word, and positive reported size.' }
    }
    if (!options.fileExistsAndSize || !await options.fileExistsAndSize(path, output.sizeBytes!)) {
      return { valid: false, reason: 'The output file could not be confirmed at the reported path and size.' }
    }
    return { valid: true, output: { ...output, path } }
  }

  return {
    id: ADAPTER_ID,
    label: 'Local Z-Image character trainer',
    execution: 'local',
    canTrain,
    async prepare(request, environment) {
      const compatibility = await canTrain(request, environment)
      if (compatibility.status !== 'ready' || !compatibility.baseModel) {
        return {
          status: compatibility.status === 'ready' ? 'error' : compatibility.status,
          reason: compatibility.reason,
          missingInputs: compatibility.missingInputs,
        }
      }
      const sources = request.sources.filter(isLocalSource)
      const outputName = safeName(request.outputName || request.triggerWord || 'character') || 'character'
      const triggerWord = safeName(request.triggerWord || outputName) || outputName
      const plan: LoraTrainingPlan = {
        id: `zimage-character-${Date.now()}`,
        adapterId: ADAPTER_ID,
        task: 'image',
        baseModel: compatibility.baseModel,
        dataset: {
          items: sources.map((source) => {
            const caption = source.caption?.trim() || request.goal.trim() || 'character'
            const hasTriggerPrefix = caption.slice(0, triggerWord.length).toLowerCase() === triggerWord.toLowerCase()
              && (caption.length === triggerWord.length || !/[a-z0-9_]/i.test(caption[triggerWord.length]))
            return { path: source.path.trim(), caption: hasTriggerPrefix ? caption : `${triggerWord}, ${caption}` }
          }),
          manifest: [],
          summary: `${sources.length} local file or gallery sources.`,
          minimumItems: MINIMUM_IMAGES,
        },
        triggerWord,
        outputName,
        estimatedResources: { vramGb: null, ramGb: null, diskGb: null, durationMinutes: null },
        explanation: `Prepare a Z-Image character training plan with ${sources.length} local sources.`,
        advancedSettings: { steps: 1200, rank: 32, learningRate: 0.0001, resolution: 768 },
      }
      return { status: 'ready', plan }
    },
    async run(plan, callbacks: LoraTrainingCallbacks): Promise<LoraTrainingStatus> {
      const setId = `zimage_${crypto.randomUUID()}`
      let stagedAny = false
      let stagingFailed = false
      let preserveStaging = false
      let cancellationRequested = false
      let started = false
      let cancelPromise: Promise<void> | undefined
      let cancelFailed = false
      let logs: string[] = []
      let priorLogs: readonly string[] = []
      const details = () => ({ jobId: setId, adapterId: ADAPTER_ID, logs })
      const publish = (status: LoraTrainingStatus) => {
        callbacks.onStatus?.(status)
        return status
      }
      const requestCancel = () => {
        if (started && !cancelPromise) {
          cancelPromise = cancelCharacterTraining().catch(() => { cancelFailed = true })
        }
      }
      const cancelled = async (): Promise<LoraTrainingStatus> => {
        requestCancel()
        await cancelPromise
        return publish({ ...details(), status: cancelFailed ? 'error' : 'cancelled',
          message: cancelFailed ? 'The trainer could not confirm cancellation. Check the running job.' : 'Training cancelled.' })
      }
      const waitForPoll = () => new Promise<void>((resolve) => {
        if (callbacks.signal?.aborted) { resolve(); return }
        const finish = () => {
          clearTimeout(timer)
          callbacks.signal?.removeEventListener('abort', finish)
          resolve()
        }
        const timer = setTimeout(finish, POLL_INTERVAL_MS)
        callbacks.signal?.addEventListener('abort', finish, { once: true })
      })
      const onAbort = () => {
        cancellationRequested = true
        requestCancel()
      }
      callbacks.signal?.addEventListener('abort', onAbort)
      try {
        if (callbacks.signal?.aborted) return await cancelled()
        if (plan.adapterId !== ADAPTER_ID || plan.task !== 'image' || !isZImage(plan.baseModel.family)) {
          return publish({ ...details(), status: 'unsupported', message: 'This plan requires a Z-Image character trainer.' })
        }
        if (plan.dataset.items.length < MINIMUM_IMAGES) {
          return publish({ ...details(), status: 'missing-input', message: 'At least 4 character images are required.' })
        }
        const outputName = safeName(plan.outputName)
        const triggerWord = safeName(plan.triggerWord)
        if (!outputName || !triggerWord || !setId) {
          return publish({ ...details(), status: 'missing-input', message: 'The plan needs a valid dataset name, output name, and trigger word.' })
        }
        const steps = plan.advancedSettings.steps ?? 1200
        if (!Number.isInteger(steps) || steps < 100 || steps > 4000) {
          return publish({ ...details(), status: 'unsupported', message: 'Training steps must be between 100 and 4000.' })
        }
        publish({ ...details(), status: 'running', phase: 'Preparing images', message: `Preparing ${plan.dataset.items.length} character images.` })
        for (const [index, item] of plan.dataset.items.entries()) {
          if (callbacks.signal?.aborted) return await cancelled()
          const extension = /\.(png|jpe?g|webp)$/i.exec(item.path)?.[1]?.toLowerCase()
          if (!extension) return publish({ ...details(), status: 'missing-input', message: 'Use PNG, JPEG, or WebP character images.' })
          const bytes = await options.readFileBytes(item.path)
          if (callbacks.signal?.aborted) return await cancelled()
          try {
            await stageTrainingImage(setId, `image_${index + 1}.${extension}`, bytes, item.caption)
            stagedAny = true
          } catch (error) {
            stagingFailed = true
            throw error
          }
        }
        if (callbacks.signal?.aborted) return await cancelled()
        const result = await startCharacterTraining(setId, outputName, triggerWord, steps)
        if (result.status !== 'running') {
          if (result.status === 'already_running' || result.status === 'unsupported') preserveStaging = true
          return publish({ ...details(), status: 'error', message: result.status === 'already_running'
            ? 'Another character training job is already running.' : 'The character trainer did not start.' })
        }
        started = true
        for (;;) {
          if (callbacks.signal?.aborted) return await cancelled()
          const run = await readStatus()
          if (callbacks.signal?.aborted) return await cancelled()
          if (run.setId) {
            const returnedSetId = run.setId
            if (returnedSetId !== setId) {
              started = false
              preserveStaging = true
              return publish({ ...details(), status: 'error', message: 'The trainer is reporting a different job.' })
            }
          }
          logs = [...run.logs]
          let overlap = Math.min(priorLogs.length, logs.length)
          while (overlap > 0 && !priorLogs.slice(-overlap).every((line, i) => line === logs[i])) overlap--
          logs.slice(overlap).forEach((line) => callbacks.onLog?.(line))
          priorLogs = logs
          const update = { ...details(), phase: run.phase, step: run.step, totalSteps: run.totalSteps,
            progress: run.totalSteps > 0 ? Math.max(0, Math.min(100, run.step / run.totalSteps * 100)) : undefined }
          if (run.status === 'complete') {
            started = false
            if (!run.output || run.output.triggerWord !== triggerWord) {
              return publish({ ...update, status: 'error', message: 'Training completed without the expected character LoRA output.' })
            }
            const validation = await validateOutput({ ...run.output, task: 'image' }, plan)
            if (!validation.valid) return publish({ ...update, status: 'error', message: validation.reason })
            return publish({ ...update, status: 'complete', output: validation.output, message: run.phase || 'Character LoRA ready.' })
          }
          if (run.status === 'error' || run.status === 'cancelled') {
            started = false
            return publish({ ...update, status: run.status, message: run.phase || (run.status === 'error' ? 'Character training failed.' : 'Training cancelled.') })
          }
          if (run.status !== 'running') return publish({ ...update, status: 'error', message: 'The trainer stopped reporting an active job.' })
          publish({ ...update, status: 'running', message: run.phase || 'Training the character LoRA.' })
          await waitForPoll()
        }
      } catch {
        if (callbacks.signal?.aborted) return await cancelled()
        return publish({ ...details(), status: 'error', message: started
          ? 'The trainer status could not be read. Check the running job.'
          : 'The character images could not be prepared or the trainer could not start.' })
      } finally {
        callbacks.signal?.removeEventListener('abort', onAbort)
        if (stagedAny && !stagingFailed && !cancellationRequested && !started && !preserveStaging) {
          try { await clearTrainingSet(setId) } catch { /* Best-effort staging cleanup. */ }
        }
      }
    },
    validateOutput,
  }
}

export function registerZImageCharacterAdapter(options: ZImageCharacterAdapterOptions): LoraTrainerAdapter {
  const adapter = createZImageCharacterAdapter(options)
  registerLoraTrainer(adapter)
  return adapter
}
