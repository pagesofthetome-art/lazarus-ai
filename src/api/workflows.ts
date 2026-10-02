import type { ModelType } from './comfyui'
import type { GenerateParams, VideoParams } from './comfyui'
import { findMatchingVAE, findMatchingCLIP } from './comfyui'
import { log } from '../lib/logger'
import { resolveRunSeed } from '../lib/run-seed'
import type {
  WorkflowTemplate,
  WorkflowSource,
  ParameterMap,
} from '../types/workflows'
import type {
  ComfyApiGraph, ComfyApiNode, ComfyInputValue, ComfyNodeInputs,
} from '../types/comfy-graph'
import {
  apiNodes, isComfyApiGraph,
  inputNumber, linkTarget,
} from '../types/comfy-graph'

// ─── Validation ───
//
// The JSON walked here arrives from a file the user picked or a download, so
// no field is guaranteed. The shapes and the guards live in
// types/comfy-graph.ts; nothing below reads a field it has not narrowed first.

/**
 * Accepts ONLY the ComfyUI API graph format ({ "1": { class_type, inputs }, ... }).
 *
 * R2-32: this used to accept the Web/UI export format too ({ nodes: [...],
 * links: [...] }), but every caller downstream (parameterMap detection,
 * parameter injection, apiNodes) reads `class_type`/`inputs`, fields the
 * Web/UI format does not carry. A Web/UI export therefore passed validation
 * and then failed silently later, with the modal's own advice ("Export it
 * from ComfyUI using Save (API Format)") never shown because validation had
 * already said yes. Narrowed to the one shape every caller actually needs.
 */
export function validateWorkflowJson(json: unknown): json is ComfyApiGraph {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return false
  // API format: { "1": { class_type: "...", inputs: {...} }, ... }
  return isComfyApiGraph(json)
}

// ─── Smart Search Terms ───

export function extractSearchTerms(modelName: string, modelType: ModelType): string {
  // Map model types to good search terms
  const typeTerms: Record<string, string> = {
    flux: 'flux',
    flux2: 'flux 2',
    sdxl: 'sdxl',
    sd15: 'sd 1.5',
    wan: 'wan',
    hunyuan: 'hunyuan',
  }

  if (modelType !== 'unknown' && typeTerms[modelType]) {
    return `${typeTerms[modelType]} comfyui workflow`
  }

  // Strip extension
  let name = modelName.replace(/\.[^.]+$/, '')
  // Strip common noise words
  name = name.replace(/[-_](fp8|fp16|fp32|bf16|4bit|8bit|4b|8b|base|klein|large|medium|small|q4|q5|q8|gguf|safetensors)/gi, ' ')
  // Replace separators with spaces
  name = name.replace(/[-_]+/g, ' ')
  // Collapse whitespace
  name = name.replace(/\s+/g, ' ').trim()
  // Keep only first 3 meaningful words to avoid overly specific queries
  const words = name.split(' ').filter(w => w.length > 1).slice(0, 3)
  return words.length > 0 ? `${words.join(' ')} comfyui workflow` : 'comfyui workflow'
}

// ─── Parameter Auto-Detection ───

export function autoDetectParameterMap(workflow: ComfyApiGraph): ParameterMap {
  const map: ParameterMap = {}

  let ksamplerNode: ComfyApiNode | null = null

  for (const [nodeId, node] of apiNodes(workflow)) {
    const ct = node.class_type
    if (ct === 'KSampler' || ct === 'KSamplerAdvanced') {
      ksamplerNode = node
      map.seed = { nodeId, inputKey: 'seed' }
      map.steps = { nodeId, inputKey: 'steps' }
      map.cfgScale = { nodeId, inputKey: 'cfg' }
      map.sampler = { nodeId, inputKey: 'sampler_name' }
      map.scheduler = { nodeId, inputKey: 'scheduler' }
      break
    }
  }

  if (ksamplerNode?.inputs) {
    const posNodeId = linkTarget(ksamplerNode.inputs.positive)
    const negNodeId = linkTarget(ksamplerNode.inputs.negative)
    if (posNodeId !== undefined) {
      const posNode = workflow[posNodeId]
      if (posNode?.class_type === 'CLIPTextEncode') {
        map.positivePrompt = { nodeId: posNodeId, inputKey: 'text' }
      }
    }
    if (negNodeId !== undefined) {
      const negNode = workflow[negNodeId]
      if (negNode?.class_type === 'CLIPTextEncode') {
        map.negativePrompt = { nodeId: negNodeId, inputKey: 'text' }
      }
    }
  }

  for (const [nodeId, node] of apiNodes(workflow)) {
    const ct = node.class_type

    switch (ct) {
      case 'CheckpointLoaderSimple':
        map.model = { nodeId, inputKey: 'ckpt_name', loaderType: 'checkpoint' }
        break
      case 'UNETLoader':
        map.model = { nodeId, inputKey: 'unet_name', loaderType: 'unet' }
        break
      case 'LoadImage':
        // A custom I2I/I2V workflow may contain more than one image
        // loader. Use the first one as its primary Lazarus source image.
        if (!map.inputImage) {
          map.inputImage = {
            nodeId,
            inputKey: 'image',
          }
        }
        break
      case 'EmptyLatentImage':
      case 'EmptySD3LatentImage':
        map.width = { nodeId, inputKey: 'width' }
        map.height = { nodeId, inputKey: 'height' }
        map.batchSize = { nodeId, inputKey: 'batch_size' }
        break
      case 'EmptyHunyuanLatentVideo':
        map.width = { nodeId, inputKey: 'width' }
        map.height = { nodeId, inputKey: 'height' }
        map.frames = { nodeId, inputKey: 'length' }
        break
      case 'ImageResizeKJv2':
        if (!map.width && inputNumber(node, 'width') !== undefined) {
          map.width = {
            nodeId,
            inputKey: 'width',
          }
        }

        if (!map.height && inputNumber(node, 'height') !== undefined) {
          map.height = {
            nodeId,
            inputKey: 'height',
          }
        }
        break
      case 'SaveAnimatedWEBP':
        map.fps = { nodeId, inputKey: 'fps' }
        break
      case 'VHS_VideoCombine':
        map.fps = { nodeId, inputKey: 'frame_rate' }
        break
    }
  }

  if (!map.positivePrompt) {
    const clipNodes = apiNodes(workflow).filter(
      ([, n]) => n.class_type === 'CLIPTextEncode'
    )
    if (clipNodes.length >= 1) {
      map.positivePrompt = { nodeId: clipNodes[0][0], inputKey: 'text' }
    }
    if (clipNodes.length >= 2 && !map.negativePrompt) {
      map.negativePrompt = { nodeId: clipNodes[1][0], inputKey: 'text' }
    }
  }

  return map
}

// ─── Parameter Injection ───

export async function injectParameters(
  workflow: ComfyApiGraph,
  paramMap: ParameterMap,
  params: GenerateParams | VideoParams,
  modelType: ModelType
): Promise<ComfyApiGraph> {
  // Deep clone: the caller's template must not be mutated. A JSON round-trip
  // of a ComfyApiGraph is a ComfyApiGraph by construction.
  const wf: ComfyApiGraph = JSON.parse(JSON.stringify(workflow))

  const inject = (
    mapping: { nodeId: string; inputKey: string } | undefined,
    value: ComfyInputValue | undefined,
  ) => {
    if (!mapping) return
    const node = wf[mapping.nodeId]
    if (node?.inputs) {
      // Assigning undefined is deliberate and load-bearing: JSON.stringify
      // drops the key, so the node falls back to ComfyUI's own default rather
      // than keeping the template's value.
      const inputs: ComfyNodeInputs = node.inputs
      inputs[mapping.inputKey] = value
    }
  }

  inject(paramMap.model, params.model)
  inject(paramMap.positivePrompt, params.prompt)
  inject(paramMap.negativePrompt, params.negativePrompt || '')
  inject(paramMap.seed, resolveRunSeed(params.seed))
  inject(paramMap.steps, params.steps)
  inject(paramMap.cfgScale, params.cfgScale)
  let widthMapping = paramMap.width
  let heightMapping = paramMap.height

  // Older installed custom I2V workflows may predate resize-node
  // detection. Locate their source resize node at generation time so
  // users do not have to remove and re-import the workflow.
  if (!widthMapping || !heightMapping) {
    const resizeEntry = apiNodes(wf).find(
      ([, node]) =>
        node.class_type === 'ImageResizeKJv2' &&
        inputNumber(node, 'width') !== undefined &&
        inputNumber(node, 'height') !== undefined,
    )

    if (resizeEntry) {
      if (!widthMapping) {
        widthMapping = {
          nodeId: resizeEntry[0],
          inputKey: 'width',
        }
      }

      if (!heightMapping) {
        heightMapping = {
          nodeId: resizeEntry[0],
          inputKey: 'height',
        }
      }
    }
  }

  inject(widthMapping, params.width)
  inject(heightMapping, params.height)
  inject(paramMap.batchSize, params.batchSize)
  inject(paramMap.sampler, params.sampler)
  inject(paramMap.scheduler, params.scheduler)

  const inputImage =
    'inputImage' in params &&
    typeof params.inputImage === 'string'
      ? params.inputImage
      : undefined

  if (inputImage) {
    let inputImageMapping = paramMap.inputImage

    // Workflows installed before inputImage mapping existed have an older
    // persisted parameterMap. Detect their LoadImage node at generation time
    // so users do not have to remove and re-import those workflows.
    if (!inputImageMapping) {
      const loadImageEntry = apiNodes(wf).find(
        ([, node]) => node.class_type === 'LoadImage',
      )

      if (loadImageEntry) {
        inputImageMapping = {
          nodeId: loadImageEntry[0],
          inputKey: 'image',
        }
      }
    }

    inject(inputImageMapping, inputImage)
  }

  if ('frames' in params) {
    inject(paramMap.frames, (params as VideoParams).frames)
    inject(paramMap.fps, (params as VideoParams).fps)

    // A VHS_VideoCombine left on save_output:false writes the clip to
    // ComfyUI's temp folder, where the gallery cannot play it back.
    for (const [, node] of apiNodes(wf)) {
      if (node.class_type === 'VHS_VideoCombine' && node.inputs) {
        node.inputs.save_output = true
      }
    }
  }

  log.info('[workflows] Injected workflow nodes', { nodes: apiNodes(wf).map(([id, n]) =>
    `${id}: ${n.class_type} (${Object.keys(n.inputs || {}).join(', ')})`
  ).join(' | ') })

  // Auto-resolve VAE and CLIP loaders with real model files
  for (const [, node] of apiNodes(wf)) {
    const ct = node.class_type
    try {
      if (ct === 'VAELoader' && node.inputs) {
        const vae = await findMatchingVAE(modelType)
        node.inputs.vae_name = vae
      }
      if (ct === 'CLIPLoader' && node.inputs) {
        const clip = await findMatchingCLIP(modelType)
        node.inputs.clip_name = clip
        // Also set the CLIP type based on model type
        if (modelType === 'flux') node.inputs.type = 'flux'
        else if (modelType === 'flux2') node.inputs.type = 'flux2'
        else if (modelType === 'wan' || modelType === 'hunyuan') node.inputs.type = 'wan'
      }
    } catch (err) {
      log.warn(`[workflows] Failed to resolve ${ct} for ${modelType}`, { err })
    }
  }

  return wf
}

// ─── Detect workflow mode ───

function detectWorkflowMode(workflow: ComfyApiGraph): 'image' | 'video' | 'both' {
  const classTypes = apiNodes(workflow).map(([, n]) => n.class_type)

  const hasVideo = classTypes.some((ct) =>
    ['EmptyHunyuanLatentVideo', 'ADE_LoadAnimateDiffModel', 'VHS_VideoCombine', 'SaveAnimatedWEBP'].includes(ct)
  )
  const hasImage = classTypes.some((ct) =>
    ['EmptyLatentImage', 'EmptySD3LatentImage', 'SaveImage'].includes(ct)
  )

  if (hasVideo && hasImage) return 'both'
  if (hasVideo) return 'video'
  return 'image'
}

// ─── Detect compatible model types from workflow ───

function detectModelTypes(workflow: ComfyApiGraph): ModelType[] {
  const classTypes = apiNodes(workflow).map(([, n]) => n.class_type)

  const types: ModelType[] = []

  if (classTypes.includes('UNETLoader')) {
    if (classTypes.includes('EmptyHunyuanLatentVideo')) {
      types.push('wan', 'hunyuan')
    } else if (classTypes.includes('EmptySD3LatentImage')) {
      types.push('flux', 'flux2')
    } else {
      types.push('flux', 'flux2', 'wan', 'hunyuan')
    }
  }

  if (classTypes.includes('CheckpointLoaderSimple')) {
    types.push('sdxl', 'sd15')
  }

  if (classTypes.includes('ADE_LoadAnimateDiffModel')) {
    types.push('sdxl', 'sd15')
  }

  return types.length > 0 ? types : ['unknown']
}

// ─── Parse imported workflow into a template ───

export function parseImportedWorkflow(
  name: string,
  workflow: ComfyApiGraph,
  source: WorkflowSource = 'manual',
  sourceUrl?: string,
  description?: string,
): Omit<WorkflowTemplate, 'id' | 'installedAt'> {
  const parameterMap = autoDetectParameterMap(workflow)
  const mode = detectWorkflowMode(workflow)
  const modelTypes = detectModelTypes(workflow)

  return {
    name,
    description: description || `Imported from ${source}`,
    source,
    sourceUrl,
    modelTypes,
    mode,
    workflow,
    parameterMap,
  }
}
