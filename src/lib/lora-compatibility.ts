/**
 * Map CivitAI's version base-model labels and ComfyUI's installed architecture
 * labels to the same known architecture key. Unknown labels intentionally do
 * not match: the download list should not claim compatibility without evidence.
 */
export function loraArchitectureKey(value: string | null | undefined): string | null {
  if (!value?.trim()) return null

  const key = value.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const aliases: Record<string, string> = {
    // SDXL-derived fine tunes use the SDXL tensor architecture.
    sdxl: 'sdxl',
    sdxl10: 'sdxl',
    sdxlturbo: 'sdxl',
    pony: 'sdxl',
    ponyxl: 'sdxl',
    illustrious: 'sdxl',
    illustriousxl: 'sdxl',
    noobai: 'sdxl',
    noobaixl: 'sdxl',
    animaginexl: 'sdxl',
    // CivitAI names the 1.5 family differently from ComfyUI's `sd15` label.
    sd15: 'sd15',
    sd1: 'sd15',
    // Keep Flux generations distinct.
    flux: 'flux',
    flux1: 'flux',
    flux1d: 'flux',
    flux1s: 'flux',
    flux2: 'flux2',
    // Current image and video families exposed by the installed inventory.
    zimage: 'zimage',
    zimageturbo: 'zimage',
    qwenimage: 'qwenimage',
    ernieimage: 'ernie_image',
    sd3: 'sd3',
    sd35: 'sd3',
    wanvideo: 'wan',
    wan21: 'wan',
    wan22: 'wan22',
    hunyuanvideo: 'hunyuan',
    hunyuan: 'hunyuan',
    ltxvideo: 'ltx',
    ltxv: 'ltx',
  }

  if (aliases[key]) return aliases[key]

  // Exact architecture IDs from the ComfyUI inventory also work directly.
  const architectures = new Set([
    'flux', 'flux2', 'krea2', 'zimage', 'ernie_image', 'qwenimage', 'qwenimage1',
    'chroma', 'hidream', 'sd3', 'lumina2', 'sdxl', 'sd15', 'wan', 'wan22',
    'hunyuan', 'ltx', 'mochi', 'cosmos', 'cogvideo', 'svd', 'framepack',
    'pyramidflow', 'allegro', 'ace', 'wans2v', 'wananimate', 'wanvace',
    'animatediff',
  ])
  const architecture = value.toLowerCase().trim()
  return architectures.has(architecture) ? architecture : null
}

export function isLoraCompatibleWithInstalledModels(
  baseModel: string | null | undefined,
  installedArchitectures: readonly string[],
): boolean {
  const loraArchitecture = loraArchitectureKey(baseModel)
  if (!loraArchitecture) return false
  return installedArchitectures.some((architecture) => loraArchitectureKey(architecture) === loraArchitecture)
}
