import { test } from 'node:test'
import assert from 'node:assert/strict'
import { access, readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function sourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(path)
    return /\.(?:ts|tsx|js|jsx|mjs)$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name) ? [path] : []
  }))
  return nested.flat()
}

test('retired hosted provider has no network or account-token path', async () => {
  const [provider, registry, auth] = await Promise.all([
    read('src/api/providers/retired-hosted-provider.ts'),
    read('src/api/providers/registry.ts'),
    read('src/api/cloud/supabase.ts'),
  ])

  assert.doesNotMatch(provider, /getAccessToken|CLOUD_BASE|OpenAIProvider|fetch\s*\(/)
  assert.match(provider, /Hosted services are not included in Lazarus/)
  assert.match(registry, /case 'lu-cloud':[\s\S]{0,160}removed from Lazarus/)
  assert.match(auth, /Hosted account services are not included in Lazarus/)
  assert.doesNotMatch(auth, /SUPABASE_URL|SUPABASE_ANON_KEY|createClient|fetch\s*\(/)
})

test('hosted model catalog is empty and cannot rehydrate an old catalog', async () => {
  const [models, catalog, app, backup] = await Promise.all([
    read('src/lib/render/cloud-models.ts'),
    read('src/stores/cloudCatalogStore.ts'),
    read('src/App.tsx'),
    read('src/lib/store-backup.ts'),
  ])

  assert.match(models, /CLOUD_MODEL_SEED: CloudModel\[\]\s*=\s*\[\]/)
  assert.match(catalog, /models:\s*\[\]/)
  assert.match(catalog, /models:\s*\[\],\s*ops:\s*null,\s*voice:\s*null,\s*mediaLive:\s*false/)
  assert.doesNotMatch(catalog, /persist\s*\(|name:\s*['"]lu-cloud-catalog['"]|safeJSONStorage/)
  assert.doesNotMatch(catalog, /models:\s*c\.models/)
  assert.match(app, /'lu-cloud-catalog'/)
  assert.match(app, /'lu-cloud-session-code-verifier'/)
  assert.doesNotMatch(backup, /lu-cloud-catalog|lu_cloud_notice/)
})

test('retired first-party endpoints and bundled hosted generation catalogs are absent', async () => {
  const [config, client, memorySync, models, schemas, endpoints, presets, roleModels, durations] = await Promise.all([
    read('src/api/cloud/config.ts'),
    read('src/api/cloud/client.ts'),
    read('src/api/cloud/memory-sync.ts'),
    read('src/lib/render/studio-models.json'),
    read('src/lib/render/provider-schemas.json'),
    read('src/lib/render/provider-endpoints.json'),
    read('src/lib/render/create-presets.ts'),
    read('src/lib/render/preset-models.ts'),
    read('src/lib/render/video-durations.json'),
  ])

  assert.match(config, /CLOUD_BASE\s*=\s*''/)
  assert.match(config, /SUPABASE_URL\s*=\s*''/)
  assert.match(config, /SUPABASE_ANON_KEY\s*=\s*''/)
  assert.match(client, /Hosted services are not included in Lazarus/)
  assert.doesNotMatch(client, /fetch\s*\(/)
  assert.match(memorySync, /Account memory sync is not included in Lazarus/)
  assert.doesNotMatch(memorySync, /fetch\s*\(|supabaseCloud/)
  assert.deepEqual(JSON.parse(models), {})
  assert.deepEqual(JSON.parse(schemas), {})
  assert.deepEqual(JSON.parse(endpoints), {})
  assert.deepEqual(JSON.parse(durations), {})
  assert.match(presets, /CREATE_PRESETS:\s*CreatePreset\[\]\s*=\s*\[\]/)
  assert.match(roleModels, /function presetModels\([^)]*\): PresetModel\[\]\s*\{\s*return \[\]\s*\}/)
  assert.doesNotMatch(roleModels, /heygen|wavespeed|wan-3\.0|qwen3-tts|flashvsr/i)
})

test('desktop identity and updater metadata do not point to the former supplier', async () => {
  const [packageJson, packageLock, tauri, cargo, supabaseClient] = await Promise.all([
    read('package.json'),
    read('package-lock.json'),
    read('src-tauri/tauri.conf.json'),
    read('src-tauri/Cargo.toml'),
    read('src/api/cloud/supabase.ts'),
  ])
  const parsed = JSON.parse(tauri)
  const lock = JSON.parse(packageLock)

  assert.equal(JSON.parse(packageJson).name, 'lazarus')
  assert.equal(lock.name, 'lazarus')
  assert.equal(parsed.productName, 'Lazarus')
  assert.equal(parsed.identifier, 'app.lazarus.desktop')
  assert.match(cargo, /\[package\][\s\S]*?name\s*=\s*"lazarus"/)
  assert.deepEqual(parsed.bundle.externalBin, ['bin/lazarus-llama-server'])
  assert.equal(JSON.parse(packageJson).dependencies['@supabase/supabase-js'], undefined)
  assert.doesNotMatch(packageLock, /node_modules\/@supabase\//)
  assert.doesNotMatch(supabaseClient, /@supabase\/supabase-js|createClient|fetch\s*\(/)
  assert.deepEqual(parsed.plugins.updater.endpoints, [])
  assert.doesNotMatch(parsed.bundle.externalBin.join(' '), /locally-uncensored|lu-llama/i)
  assert.doesNotMatch(parsed.app.security.csp, /supabase|locallyuncensored|purpledouble/i)
})

test('current source and docs do not point users to the former supplier service', async () => {
  const source = await sourceFiles(resolve(ROOT, 'src'))
  const supplierUrls = []
  for (const file of source) {
    const contents = await readFile(file, 'utf8')
    if (/https?:\/\/[^\s'"<>)]*(?:lu-labs\.ai|locallyuncensored|uselu|purpledoubled)/i.test(contents)) {
      supplierUrls.push(file)
    }
  }
  assert.deepEqual(supplierUrls, [])

  const blogDir = resolve(ROOT, 'docs/blog')
  const blogEntries = await readdir(blogDir, { withFileTypes: true })
  const blogPages = blogEntries.filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
  const pagesWithRetiredOffers = []
  for (const entry of blogPages) {
    const contents = await readFile(resolve(blogDir, entry.name), 'utf8')
    if (/remote provider.{0,260}on every plan|remote provider catalog on every plan|src=lucv/i.test(contents)) {
      pagesWithRetiredOffers.push(entry.name)
    }
  }
  assert.deepEqual(pagesWithRetiredOffers, [])

  const historicalRelease = await read('docs/blog/lazarus-2-5-9.html')
  assert.match(historicalRelease, /Historical release notes:[\s\S]{0,400}hosted render service that has since been retired/)
})

test('user-configured provider clients remain separate from the retired provider', async () => {
  const [types, providerStore, registry, visibility, cloudClient] = await Promise.all([
    read('src/api/providers/types.ts'),
    read('src/stores/providerStore.ts'),
    read('src/api/providers/registry.ts'),
    read('src/lib/provider-visibility.ts'),
    read('src/api/cloud/client.ts'),
  ])

  assert.match(types, /ProviderId\s*=\s*'ollama'\s*\|\s*'openai'\s*\|\s*'anthropic'\s*\|\s*'lu-cloud'/)
  assert.match(providerStore, /const PROVIDER_IDS: ProviderId\[\]\s*=\s*\['ollama', 'openai', 'anthropic'\]/)
  assert.match(providerStore, /'lu-cloud':\s*\{[\s\S]*?enabled:\s*false,[\s\S]*?baseUrl:\s*'',\s*apiKey:\s*''/)
  assert.match(registry, /case 'lu-cloud':[\s\S]*?removed from Lazarus/)
  assert.match(visibility, /RETIRED_PROVIDER_IDS\s*=\s*new Set\(\['lu-cloud'\]\)/)
  assert.match(cloudClient, /throw new CloudJobError\('Hosted services are not included in Lazarus\.'/)
  assert.doesNotMatch(cloudClient, /fetch\s*\(/)
})

test('former hosted account, checkout, and model surfaces are absent', async () => {
  const [settings, createContext, specialControls, createStore] = await Promise.all([
    read('src/components/settings/SettingsPage.tsx'),
    read('src/components/create/experimental/CreateContext.tsx'),
    read('src/components/create/experimental/SpecialIntentControls.tsx'),
    read('src/stores/createStore.ts'),
  ])

  for (const path of [
    'src/components/auth/AccountPanel.tsx',
    'src/components/cloud/CloudGateModal.tsx',
    'src/components/cloud/CloudSwitch.tsx',
    'src/components/cloud/CloudTeaserModal.tsx',
    'src/hooks/useCloudAuth.ts',
    'src/hooks/useCloudSession.ts',
    'src/api/cloud/loras.ts',
    'src/components/create/experimental/CreditsMeter.tsx',
  ]) {
    await assert.rejects(access(new URL(`../${path}`, import.meta.url)))
  }

  assert.doesNotMatch(settings, /AccountPanel|CLOUD_BASE|Cloud API Keys|checkout|subscription/i)
  assert.doesNotMatch(createContext, /makeVoice|enhanceVideo|Hosted voice|Hosted enhancement/)
  assert.doesNotMatch(specialControls, /listLoras|deleteLora|\/api\/loras|TTS_VOICES|WaveSpeed|HeyGen/i)
  assert.match(specialControls, /getLoraModels\(\)/)
  assert.doesNotMatch(createStore, /voiceFromJob|setVoiceFromJob/)
})

test('relative source imports still resolve after removing retired modules', async () => {
  const files = await sourceFiles(resolve(ROOT, 'src'))
  const missing = []
  const candidatesFor = (base) => [
    base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}.mjs`,
    `${base}.json`, `${base}.css`, `${base}.svg`,
    resolve(base, 'index.ts'), resolve(base, 'index.tsx'), resolve(base, 'index.js'),
  ]

  for (const file of files) {
    const source = (await readFile(file, 'utf8'))
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    const imports = [
      ...source.matchAll(/^\s*(?:import|export)\s+(?:type\s+)?(?:[\w*$\s{},.]+?\s+from\s*)?['"](\.[^'"]+)['"]/gm),
      ...source.matchAll(/\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g),
    ]
    for (const match of imports) {
      const specifier = match[1].split('?')[0]
      const base = resolve(dirname(file), specifier)
      if (!candidatesFor(base).some(existsSync)) missing.push(`${file}: ${specifier}`)
    }
  }
  assert.deepEqual(missing, [])
})
