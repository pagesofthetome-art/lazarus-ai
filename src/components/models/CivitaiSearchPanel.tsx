/**
 * The CivitAI search, as one panel that is told WHAT it searches for.
 *
 * It used to sit inline in DiscoverModels with `'Checkpoint'` typed into the
 * call, which made a second kind of search (LoRAs, for the Models > LoRAs rail)
 * a copy of ninety lines of markup. The type is a prop instead: one panel, one
 * mirror toggle, one key hint, one download path, and the folder a hit lands in
 * is decided once, in `searchCivitaiModels`, from that same type.
 */
import { useEffect, useState } from 'react'
import { Search, Loader2, ExternalLink, Download, CheckCircle } from 'lucide-react'
import { searchCivitaiModels, searchLoraModels, startModelDownload, type CivitAIModelResult } from '../../api/discover'
import { openExternal } from '../../api/backend'
import { useDownloadStore } from '../../stores/downloadStore'
import { useWorkflowStore } from '../../stores/workflowStore'
import { CivitaiResultsSkeleton } from '../layout/ViewSkeletons'
import { GlassCard } from '../ui/GlassCard'
import { ProgressBar } from '../ui/ProgressBar'
import { formatBytes } from '../../lib/formatters'
import { proxyImageUrl } from '../../lib/privacy'
import { isLoraCompatibleWithInstalledModels } from '../../lib/lora-compatibility'

interface Props {
  /** What CivitAI is asked for, which is also what decides the target folder. */
  modelType: 'Checkpoint' | 'LORA'
  /** The heading on the card. */
  title: string
  /** Placeholder for the query field, so each lane can show its own examples. */
  placeholder: string
  /** What the ModelManager header search holds. It is copied into this card's
   *  own field, so a lane whose Get new IS this card does not drop the words
   *  the user just typed up there. */
  search?: string
  /** Bumped by ModelManager on Enter in the header search. That keypress also
   *  switches to Get new, and on this lane Get new is this card: without the
   *  token the user landed on an empty field, no hits and no message, which is
   *  exactly the silent gap the empty state below exists to close. */
  searchSubmitToken?: number
  /** Known installed checkpoint/diffusion-model architectures for LoRA filtering. */
  compatibleArchitectures?: string[]
  /** Whether the local ComfyUI model inventory is currently reachable. */
  comfyAvailable?: boolean | null
}

export function CivitaiSearchPanel({
  modelType,
  title,
  placeholder,
  search = '',
  searchSubmitToken = 0,
  compatibleArchitectures = [],
  comfyAvailable,
}: Props) {
  const [results, setResults] = useState<CivitAIModelResult[]>([])
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState(search)
  // Track whether the *latest* CivitAI search has been issued at least once,
  // so an empty-state hint can render between "before-first-search" and
  // "search returned 0 hits". Without this we fall through to the silent gap
  // diimmortalis described: empty list, no console output, looks like the
  // button did nothing.
  const [searched, setSearched] = useState(false)
  const [provider, setProvider] = useState<'all' | 'civitai' | 'huggingface'>('all')
  const civitaiHost = useWorkflowStore((s) => s.civitaiHost)
  const setCivitaiHost = useWorkflowStore((s) => s.setCivitaiHost)
  const downloads = useDownloadStore((s) => s.downloads)
  const dlStore = useDownloadStore
  const visibleResults = modelType === 'LORA'
    ? ((comfyAvailable === undefined || comfyAvailable === true) && compatibleArchitectures.length > 0
      ? results
        .filter((model) => provider === 'all' || (model.provider ?? 'civitai') === provider)
        .filter((model) => isLoraCompatibleWithInstalledModels(model.baseModel, compatibleArchitectures))
      : [])
    : results

  const runSearch = async (text: string = query) => {
    if (!text.trim()) return
    setSearching(true)
    setSearched(true)
    // The CivitAI API key the user configured in Settings, AI Backends,
    // CivitAI API key. The search and the download path share that one
    // credential, so there is no second input here.
    const apiKey = useWorkflowStore.getState().civitaiApiKey || undefined
    const host = useWorkflowStore.getState().civitaiHost
    const hits = modelType === 'LORA'
      ? await searchLoraModels(text, apiKey, host)
      : await searchCivitaiModels(text, modelType, apiKey, host)
    setResults(hits)
    setSearching(false)
  }

  // Enter in the header search. Same deal DiscoverModels has with its own
  // catalog search: the live text is only a filter, the token is the submit.
  // The typed text is taken over either way, so the field is never empty
  // after a keypress that just switched the view to this card.
  useEffect(() => {
    if (searchSubmitToken <= 0 || !search.trim()) return
    setQuery(search)
    void runSearch(search)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchSubmitToken])

  const download = async (model: CivitAIModelResult) => {
    if (!model.downloadUrl || !model.filename || !model.subfolder) return
    dlStore.getState().setMeta(model.filename, model.downloadUrl, model.subfolder)
    await startModelDownload(model.downloadUrl, model.subfolder, model.filename)
    dlStore.getState().startPolling()
  }

  return (
    <GlassCard className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
        <div className="flex items-center gap-1 t-micro">
          {modelType === 'LORA' && (['all', 'civitai', 'huggingface'] as const).map((p) => (
            <button key={p} onClick={() => setProvider(p)} className={'px-1.5 py-0.5 rounded transition-colors ' + (provider === p ? 'bg-gray-200 dark:bg-white/15 text-gray-900 dark:text-white' : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200')}>
              {p === 'all' ? 'all catalogs' : p === 'civitai' ? 'CivitAI' : 'Hugging Face'}
            </button>
          ))}
          {modelType !== 'LORA' && <span className="text-gray-400 dark:text-gray-500">CivitAI</span>}
        </div>
      </div>
      {(modelType !== 'LORA' || provider !== 'huggingface') && (
        <div className="flex justify-end items-center gap-1 t-micro -mt-2">
          <span className="text-gray-400 dark:text-gray-500">CivitAI mirror</span>
          {(['civitai.com', 'civitai.red'] as const).map((h) => (
            <button key={h} onClick={() => setCivitaiHost(h)} className={'px-1.5 py-0.5 rounded font-mono transition-colors ' + (civitaiHost === h ? 'bg-gray-200 dark:bg-white/15 text-gray-900 dark:text-white' : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200')}>
              {h.replace('civitai', '')}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2 w-full sm:w-2/3 lg:w-1/2 mx-auto">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void runSearch() }}
          placeholder={modelType === 'LORA' ? 'Search LoRAs: character, story, coding style, defensive security…' : placeholder}
          aria-label={title}
          className="flex-1 px-3 py-2 rounded-lg bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-sm text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:border-gray-400 dark:focus:border-white/20"
        />
        <button
          onClick={() => { void runSearch() }}
          disabled={searching || !query.trim()}
          aria-label={modelType === 'LORA' ? 'Search LoRA catalogs' : 'Search CivitAI'}
          className="px-3 py-2 rounded-lg bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/15 disabled:opacity-50 text-gray-700 dark:text-white transition-colors"
        >
          {searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
        </button>
      </div>

      {visibleResults.length > 0 && (
        <div className="space-y-2 max-h-[50vh] overflow-y-auto">
          {visibleResults.map((model) => {
            const dlState = model.filename ? downloads[model.filename] : null
            const isDl = dlState?.status === 'downloading' || dlState?.status === 'connecting'
            const isDone = dlState?.status === 'complete'

            return (
              <div key={model.id} className="flex gap-3 p-3 rounded-lg bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10">
                {model.thumbnailUrl && (
                  <img src={proxyImageUrl(model.thumbnailUrl)} alt="" className="w-14 h-14 rounded-lg object-cover flex-shrink-0" loading="lazy" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-white truncate">{model.name}</span>
                    {model.sizeGB && <span className="t-micro text-gray-400 flex-shrink-0">{model.sizeGB} GB</span>}
                  </div>
                  {modelType === 'LORA' && model.baseModel && (
                    <p className="t-micro text-gray-400 mt-0.5">
                      {modelType === 'LORA' ? 'Compatible base' : 'Base model'}: {model.baseModel}
                    </p>
                  )}
                  {model.description && <p className="t-micro text-gray-500 line-clamp-1 mt-0.5">{model.description}</p>}
                  {isDl && dlState && dlState.total > 0 && (
                    <div className="mt-1.5">
                      <ProgressBar progress={(dlState.progress / dlState.total) * 100} />
                      <span className="t-micro text-gray-400">{formatBytes(dlState.progress)} / {formatBytes(dlState.total)}</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {isDone ? (
                    <CheckCircle size={16} className="text-green-500" />
                  ) : isDl ? (
                    <Loader2 size={16} className="animate-spin text-gray-400" />
                  ) : model.downloadUrl ? (
                    <button onClick={() => download(model)} className="p-2 rounded-lg bg-green-100 dark:bg-green-500/15 hover:bg-green-200 dark:hover:bg-green-500/25 text-green-700 dark:text-green-400 transition-colors" title="Download" aria-label="Download">
                      <Download size={14} />
                    </button>
                  ) : null}
                  <button onClick={() => openExternal(model.sourceUrl)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500 transition-colors" title={`View on ${model.provider === 'huggingface' ? 'Hugging Face' : 'CivitAI'}`} aria-label={`View on ${model.provider === 'huggingface' ? 'Hugging Face' : 'CivitAI'}`}>
                    <ExternalLink size={14} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Listen-Ladezustand 2 von 4: dieselbe Begruendung eine Karte weiter
          oben, nur mit der Zeilengeometrie der Trefferliste. */}
      {searching && <CivitaiResultsSkeleton />}
      {!searching && searched && visibleResults.length === 0 && results.length > 0 && modelType === 'LORA' && (
        <div className="text-center py-4 t-micro text-gray-500 leading-relaxed">
          {comfyAvailable === null
            ? 'Checking ComfyUI and the installed model inventory…'
            : comfyAvailable === false
            ? 'ComfyUI is not currently available, so LoRAs are hidden until the installed model inventory is reachable.'
            : compatibleArchitectures.length === 0
            ? 'No supported image or video base models are installed, so CivitAI LoRAs cannot be checked for compatibility yet.'
            : `No compatible LoRAs found for the installed model families. ${results.length} incompatible or unclassified result${results.length === 1 ? ' was' : 's were'} hidden.`}
        </div>
      )}
      {!searching && searched && visibleResults.length === 0 && results.length === 0 && (
        <div className="text-center py-4 t-micro text-gray-500 leading-relaxed">
          No matches for "{query}". Try a broader query. The full catalog needs your key,
          which you set under Settings &gt; AI Backends &gt; CivitAI API key.
        </div>
      )}
    </GlassCard>
  )
}
