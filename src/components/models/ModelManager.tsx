import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import {
  Download, ArrowLeft, RefreshCw, Search, MessagesSquare, Images, Clapperboard,
  X as XIcon, HardDrive, Sparkles, PackageOpen, Video as VideoIcon, Image as ImageIcon,
  Settings as SettingsIcon, Layers,
} from 'lucide-react'
import { useModels } from '../../hooks/useModels'
import { useModelStore } from '../../stores/modelStore'
import { useUIStore } from '../../stores/uiStore'
import { useProviderStore } from '../../stores/providerStore'
import { ModelCard } from './ModelCard'
import { PullModelDialog } from './PullModelDialog'
import { DiscoverModels } from './DiscoverModels'
import { CivitaiSearchPanel } from './CivitaiSearchPanel'
import { LoraManager, LORA_USE_HINT, type LoraRow } from './LoraManager'
import { Modal } from '../ui/Modal'
import { GlowButton } from '../ui/GlowButton'
import { showModel } from '../../api/ollama'
import { checkComfyConnection, refreshComfyModels } from '../../api/comfyui'
import { isMlxImageHost } from '../../api/mlx-image'
import { MlxMediaSettings } from '../settings/MlxMediaSettings'
import { backendCall } from '../../api/backend'
import { customModelDirs, deleteBundledModel, stopBundledEngine } from '../../api/engine'
import { counterView } from '../../lib/inventory-counter'
import { groupInstalledByProvider, needsBackendSwitchHeading, foldedRowsSentence, LAZARUS_ENGINE_GROUP } from '../../lib/lazarus-engine-rows'
import { isBuiltinEngineEntry } from '../../lib/lmstudio-match'
import { installedRowMatchesSearch } from '../../lib/model-search'
import { isLoraRow } from '../../lib/lora-rows'
import { useBuiltinEngineStatus, engineIsIdle } from '../../hooks/useBuiltinEngineStatus'
import { LazarusEngineSwitchBar } from '../chat/LazarusEngineSwitchBar'
import type { InstalledModelLike } from '../../lib/lmstudio-match'
import type { ModelCategory, AIModel } from '../../types/models'

// One category drives BOTH views (Discover + Installed) — the old split
// discoverMode/categoryFilter pair collapsed into the persisted store value.
type Mode = Extract<ModelCategory, 'text' | 'image' | 'video'>

/** The rail has one entry the store's `categoryFilter` cannot hold: LoRAs are
 *  not a fourth model category, they are the add-on files that sit beside the
 *  image models. So the rail selection is Mode PLUS that one lane, and only
 *  the three real categories are written back into the store. */
type Rail = Mode | 'lora'

// Monochrome on purpose — the active state is carried by the pill background,
// not by per-category accent colors (David 2026-07-17 design pass).
const RAIL_ITEMS: { key: Mode; label: string; icon: typeof MessagesSquare }[] = [
  { key: 'text',  label: 'Chat',  icon: MessagesSquare },
  { key: 'image', label: 'Image', icon: Images },
  { key: 'video', label: 'Video', icon: Clapperboard },
]

/** The mark a counter wears while it has nothing counted to show. Not a 0:
 *  a 0 next to a card that reads Installed is a wrong answer, and this one
 *  stood for five seconds on the real box (Befund 2, 2026-08-29). */
function CountingDots({ label }: { label: string }) {
  return (
    <span
      className="text-[0.55rem] font-normal opacity-50 animate-pulse"
      role="status"
      aria-label={label}
      title={label}
    >
      &middot;&middot;&middot;
    </span>
  )
}

export function ModelManager() {
  const {
    models, activeModel, setActiveModel, fetchModels, removeModel,
    categoryFilter, setCategoryFilter, inventoryLoaded, inventoryRefreshing,
  } = useModels()
  const { setView, openSettingsAt } = useUIStore()
  const ollamaEnabled = useProviderStore(s => s.providers.ollama.enabled)
  // A14: whether the Lazarus Engine itself is serving the chat. Decides whether its
  // group needs a heading even when it is the only group (review 7).
  const lazarusEngineHoldsChat = useProviderStore(s => s.providers.openai.enabled && s.providers.openai.managed === true)
  const foldedRows = useModelStore((s) => s.foldedRows)
  // A16 (A14-4a): which row's Use button is mid swap. The engine has to stop,
  // reload a GGUF that can be several gigabytes and come back healthy, and a
  // button that looks idle through all of that gets pressed again.
  const [usingModel, setUsingModel] = useState<string | null>(null)
  // Dieselbe Frage, die das Einstellungsfenster stellt, und dieselbe Antwort.
  const engineRuht = engineIsIdle(useBuiltinEngineStatus())
  const [pullOpen, setPullOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  // Gesetzt wird das aus `{ name, ...await showModel(name) }` (unten in
  // `handleInfo`), und `showModel` gibt `Record<string, unknown>` zurueck
  // (api/ollama.ts:61) — es reicht die Antwort von Ollamas /api/show
  // unveraendert durch, deren Felder je nach Modell wechseln. Genau dafuer ist
  // der Typ hier gebaut: `name` kennen wir, weil wir es selbst danebenschreiben,
  // der Rest ist `unknown`. Gelesen wird ohnehin nur `name` (Modal-Titel) und
  // das Ganze als JSON.stringify.
  const [modelInfo, setModelInfo] = useState<({ name: string } & Record<string, unknown>) | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  // Open on Discover by default — most opens are to find and install
  // something new. Installed is one click away in the segment control.
  const [tab, setTab] = useState<'installed' | 'discover'>('discover')

  // Header search: always visible (no hidden magnifier), live filter +
  // Enter submits the HuggingFace catalog search in Discover.
  const [searchQuery, setSearchQuery] = useState('')
  const [searchSubmitToken, setSearchSubmitToken] = useState(0)
  const [bestFor, setBestFor] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  // The store still defaults categoryFilter to 'all' for legacy reasons, but
  // there is no All rail item — coerce to 'text' on mount so the user never
  // lands on an unselected state.
  useEffect(() => {
    if (categoryFilter === 'all') setCategoryFilter('text')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // On the Mac, image/video models are ComfyUI-only here (MLX has no manager
  // surface yet), so the whole media lane is dead — Discover → Install rejects
  // with "ComfyUI path not set" and Installed shows a "Start ComfyUI" state that
  // can never resolve. Pin the mode to text so a persisted image/video filter
  // never lands on it, and drop the two rail items below.
  // macOS: the ComfyUI-backed media grid below is dead there (Discover → Install
  // rejects with "ComfyUI path not set"). It used to be hidden outright, which
  // left a Mac user with no model surface for media at all. The rails are back —
  // they render the MLX catalogue instead, the same one Settings drives.
  const macMlxMedia = isMlxImageHost()
  const mode: Mode =
    (categoryFilter === 'text' || categoryFilter === 'image' || categoryFilter === 'video')
      ? categoryFilter
      : 'text'
  // The LoRA lane is ComfyUI's loras folder and nothing else. On the Mac local
  // media is MLX, which has no LoRA folder to list and no CivitAI target to
  // download into, so the rail is not offered there at all rather than offered
  // and dead. Windows and Linux both get it.
  const loraRailOffered = !macMlxMedia
  const [loraRail, setLoraRail] = useState(false)
  const rail: Rail = loraRail && loraRailOffered ? 'lora' : mode
  // No `rail !== 'lora'` here: the LoRA rail is not offered while macMlxMedia
  // holds, so the two can never be true together.
  const showMlxPanel = macMlxMedia && (mode === 'image' || mode === 'video')

  useEffect(() => {
    fetchModels()
  }, [fetchModels])

  // a Lazarus Engine row is a file on disk, and the file is what the two buttons
  // on the right act on. .dan_48 (help chat, 2026-09-05, 2.6.7): the row had
  // no bin and Details asked Ollama, which knows nothing about it, so a
  // downloaded model could neither be deleted nor found.
  const lazarusEngineFile = (m: AIModel): m is AIModel & { path: string } =>
    m.type === 'text' && isBuiltinEngineEntry(m) && 'path' in m && typeof m.path === 'string' && m.path.length > 0

  const handleInfo = async (name: string) => {
    const model = models.find((m: AIModel) => m.name === name)
    if (model && lazarusEngineFile(model)) {
      setModelInfo({ name, file: model.path, size: model.size, engine: model.providerName ?? LAZARUS_ENGINE_GROUP })
      setInfoOpen(true)
      return
    }
    try {
      const info = await showModel(name)
      setModelInfo({ name, ...info })
      setInfoOpen(true)
    } catch {
      // ignore
    }
  }

  const [deleteError, setDeleteError] = useState<string | null>(null)
  const handleDelete = async (name: string) => {
    try {
      const model = models.find((m: AIModel) => m.name === name)
      if (model && (model.type === 'image' || model.type === 'video')) {
        // ComfyUI file model (cpl.sardinas7489, Discord): delete the file from
        // the models tree, then rescan so the enum and the list drop it.
        // The folder the user named under Model Storage goes along: ComfyUI
        // lists files from it now (GH #122) and Lazarus does not delete out of it,
        // so the backend needs it to say that instead of "was not found".
        await backendCall('delete_comfy_model', { filename: name, extraDirs: customModelDirs() })
        // Nebenbefund 2 of the R8 re-measure: the rescan below is the slow
        // part (ComfyUI re-reads its model tree, then a reachability probe,
        // two /object_info reads and a stat over every remaining file), and
        // until it landed the dialog, the row and the counter all still showed
        // a file that was already off the disk. The command above returned Ok,
        // so they can say so now. The rescan still runs and still has the last
        // word.
        setConfirmDelete(null)
        useModelStore.getState().removeInventoryModel(name)
        await refreshComfyModels().catch(() => { /* rescan is best-effort */ })
        await fetchModels()
        return
      }
      if (model && lazarusEngineFile(model)) {
        // The loaded file is locked on Windows, so the engine is stopped first
        // when the row is the active one; the backend refuses otherwise.
        if (model.name === activeModel) await stopBundledEngine()
        await deleteBundledModel(model.path)
        setConfirmDelete(null)
        await fetchModels()
        return
      }
      await removeModel(name)
      setConfirmDelete(null)
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e))
      setConfirmDelete(null)
    }
  }

  // LoRAs are ComfyUI files of type 'image' and used to sit in this list
  // between the checkpoints, with no word saying what they were and a click
  // that made one the ACTIVE image model. They have their own rail now, so
  // they leave this one. Only the LoRA lane is taken out: the VAEs, text
  // encoders and the rest of the addon folders stay exactly where they were,
  // since nothing else has a place to go to.
  const loraModels = models.filter((m: AIModel) => isLoraRow(m))
  const loraRows: LoraRow[] = loraModels.map((m) => ({ name: m.name, size: m.size ?? 0 }))
  const filteredModels = models.filter((m: AIModel) => m.type === mode && !isLoraRow(m))
  const modeMeta = RAIL_ITEMS.find(r => r.key === mode)!
  /** What the Installed counter and the Installed view are about right now. */
  const installedCount = rail === 'lora' ? loraRows.length : filteredModels.length
  // One rule for the rail badges and the Installed badge, so the two can
  // never again disagree about what an uncounted lane looks like.
  const inventoryState = { loaded: inventoryLoaded, refreshing: inventoryRefreshing }

  // d37d7bf5 + neejuh (2.5.5): "models show installed in Discover but the
  // Installed tab is empty and I can't select them." Image/video models are
  // enumerated live from ComfyUI's /object_info — when ComfyUI isn't running,
  // fetchModels gets zero of them, so the Installed section looks empty even
  // though the files are on disk (the Discover "installed" badge comes from the
  // download record, a different source — hence the mismatch). Detect that case
  // with a ONE-SHOT reachability check (never a poll — keep the app light, #70)
  // so we can show the real reason instead of a misleading "no models installed".
  const [comfyReachable, setComfyReachable] = useState<boolean | null>(null)
  const imageOrVideo = mode === 'image' || mode === 'video'
  // The LoRA lane is served by the same engine and empties for the same
  // reason, so it asks the same question and shows the same answer.
  const comfyBackedLane = rail === 'lora' || imageOrVideo
  useEffect(() => {
    const needsComfyProbe = (tab === 'installed' && comfyBackedLane && installedCount === 0)
      || (tab === 'discover' && rail === 'lora')
    if (!needsComfyProbe) return
    let alive = true
    // Reset to "probing" on every (re)check — e.g. switching image<->video, or
    // re-entering an empty mode after ComfyUI went down. Without this the prior
    // resolved value lingers and briefly shows the wrong empty state before the
    // fresh probe resolves; null makes it show "Checking ComfyUI..." each time.
    setComfyReachable(null)
    checkComfyConnection()
      .then((ok) => { if (alive) setComfyReachable(ok) })
      .catch(() => { if (alive) setComfyReachable(false) })
    return () => { alive = false }
  }, [tab, rail, comfyBackedLane, installedCount])

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className="h-full flex overflow-hidden">
      {/* Content */}
      <div className="w-full min-w-0 overflow-y-auto scrollbar-thin">
        {/* Full pane width like the chat area — no centered max-w cap, so wide
            windows get more grid columns instead of side gutters. */}
        <div className="p-4 space-y-4">
          {/* Top bar */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setView('chat')}
              className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
              title="Back to chat"
            >
              <ArrowLeft size={16} />
            </button>
            <h1 className="text-[0.85rem] font-semibold text-gray-900 dark:text-white">Models</h1>

            <label className="relative flex items-center gap-1.5 t-micro text-gray-500 dark:text-gray-400">
              <span className="sr-only">Best for</span>
              <span className="absolute -inset-1 rounded-lg bg-purple-500/20 blur-md pointer-events-none" />
              <select
                value={bestFor}
                onChange={(event) => {
                  const value = event.target.value
                  setBestFor(value)
                  if (value === 'image' || value === 'video' || value === 'chat' || value === 'coding' || value === 'vision' || value === 'uncensored') {
                    setLoraRail(false)
                    setCategoryFilter(value === 'image' || value === 'video' ? value : 'text')
                  }
                  if (value) {
                    setSearchQuery(value)
                    setTab('discover')
                    setSearchSubmitToken((token) => token + 1)
                  }
                }}
                aria-label="Best for"
                className="relative rounded-lg bg-gray-100 dark:bg-[#21152d] border border-purple-300/30 px-2 py-1.5 t-micro text-gray-700 dark:text-gray-300 shadow-[0_0_18px_rgba(168,85,247,0.22)] focus:outline-none focus:border-purple-400/60"
              >
                <option value="">Best for…</option>
                <option value="coding">Coding agents</option>
                <option value="chat">Chat and general use</option>
                <option value="vision">Vision and documents</option>
                <option value="image">Image generation</option>
                <option value="video">Video generation</option>
                <option value="uncensored">Uncensored models</option>
              </select>
            </label>

            {/* Installed remains available as a compact status control; the
                discovery catalog is the default Models view. */}
            <div className={`ml-2 flex items-center p-0.5 rounded-lg bg-gray-100 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.06] ${showMlxPanel ? 'hidden' : ''}`}>
              <button
                onClick={() => setTab('installed')}
                aria-pressed={tab === 'installed'}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md t-micro font-semibold transition-colors ${
                  tab === 'installed'
                    ? 'bg-white dark:bg-white/10 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                <HardDrive size={11} /> Installed
                {(() => {
                  const badge = counterView(installedCount, inventoryState)
                  return badge.kind === 'loading' ? (
                    <CountingDots label="Counting installed models" />
                  ) : (
                    <span className="text-[0.55rem] font-normal opacity-70 tabular-nums">{badge.value}</span>
                  )
                })()}
              </button>
            </div>

            <div className="flex-1" />

            {/* Always-visible search */}
            <div className="relative w-40 sm:w-56">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { setTab('discover'); setSearchSubmitToken((t) => t + 1) }
                  else if (e.key === 'Escape') setSearchQuery('')
                }}
                placeholder="Search models…"
                className="w-full pl-7 pr-6 py-1.5 rounded-lg bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 t-micro text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:border-gray-400 dark:focus:border-white/20"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  title="Clear search"
                  aria-label="Clear search"
                >
                  <XIcon size={11} />
                </button>
              )}
            </div>

            <button onClick={fetchModels} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors" title="Refresh">
              <RefreshCw size={13} />
            </button>
            {ollamaEnabled && (
              <button
                onClick={() => setPullOpen(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 t-micro text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
                title="Pull any Ollama model by name"
              >
                <Download size={11} /> Pull
              </button>
            )}
          </div>

          {/* Views */}
          {showMlxPanel && (
            <div className="pt-1">
              <MlxMediaSettings only={mode === 'image' ? 'image' : 'video'} />
            </div>
          )}

          {!showMlxPanel && tab === 'installed' && (
            <>
              {counterView(installedCount, inventoryState).kind === 'loading' ? (
                // The empty state is the same claim the counter makes, in
                // words: you own none of these. It waits for the count for
                // the same reason (Befund 2, abnahme counter-check).
                <div className="text-center py-16 px-6">
                  <p className="text-[0.7rem] text-gray-500">Reading your installed models…</p>
                </div>
              ) : comfyBackedLane && installedCount === 0 && comfyReachable !== true ? (
                // comfyReachable: null = still probing, false = confirmed down.
                // Never show the misleading "no models installed" here while the
                // probe is pending — on desktop checkComfyConnection has to time
                // out when ComfyUI is down (a few seconds), and that flashed the
                // wrong message before the hint appeared (caught in desktop E2E).
                comfyReachable === null ? (
                  <div className="text-center py-16 px-6">
                    <p className="text-[0.7rem] text-gray-500">Checking ComfyUI…</p>
                  </div>
                ) : (
                <div className="flex flex-col items-center justify-center text-center py-16 px-6 gap-3">
                  <div className="w-14 h-14 rounded-full bg-gray-100 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.06] flex items-center justify-center">
                    {rail === 'lora'
                      ? <Layers size={28} className="text-gray-400 dark:text-gray-500" />
                      : mode === 'video' ? <VideoIcon size={28} className="text-gray-400 dark:text-gray-500" /> : <ImageIcon size={28} className="text-gray-400 dark:text-gray-500" />}
                  </div>
                  <div className="space-y-1">
                    {/* The LoRA lane hangs off the same engine, so it gets the
                        same state and the same sentence, with its own noun. */}
                    <p className="t-control text-gray-800 dark:text-gray-200">Start ComfyUI to see your {rail === 'lora' ? 'LoRA' : mode} models</p>
                    <p className="t-micro text-gray-500 max-w-[300px] leading-relaxed">
                      {rail === 'lora' ? 'LoRA' : mode === 'image' ? 'Image' : 'Video'} models are served by ComfyUI, which isn't running right now, so the ones you've downloaded can't be listed yet. Open Settings, go to AI Backends, and press Start under ComfyUI (Image &amp; Video), then come back.
                    </p>
                  </div>
                  {/* Nebenbefund 3, R8 re-measure: the sentence above names a
                      Start button that sits inside a collapsed section, and
                      said nothing about unfolding it. The button knows the
                      whole route, so it walks all of it: Settings, the AI
                      Backends tab, the ComfyUI section open. */}
                  <button
                    onClick={() => openSettingsAt({ tab: 'backends', section: 'comfyui' })}
                    className="flex items-center gap-1.5 mt-1 px-3 py-1.5 rounded-md bg-gray-900 dark:bg-white/10 hover:bg-gray-800 dark:hover:bg-white/15 text-white t-micro font-medium transition-colors"
                  >
                    <SettingsIcon size={11} /> Open Settings
                  </button>
                </div>
                )
              ) : rail === 'lora' ? (
                <LoraManager
                  rows={searchQuery ? loraRows.filter((r) => installedRowMatchesSearch(r.name, searchQuery)) : loraRows}
                  total={loraRows.length}
                  searchQuery={searchQuery}
                  onDelete={(name) => setConfirmDelete(name)}
                  onGetNew={() => setTab('discover')}
                />
              ) : models.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center py-16 px-6 gap-3">
                  <div className="w-14 h-14 rounded-full bg-gray-100 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.06] flex items-center justify-center">
                    <PackageOpen size={28} className="text-gray-400 dark:text-gray-500" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[12px] font-medium text-gray-800 dark:text-gray-200">No models installed yet</p>
                    <p className="t-micro text-gray-500 max-w-[280px] leading-relaxed">
                      Browse curated chat, image and video models and install them with one click.
                    </p>
                  </div>
                  <button
                    onClick={() => setTab('discover')}
                    className="flex items-center gap-1.5 mt-1 px-3 py-1.5 rounded-md bg-gray-900 dark:bg-white/10 hover:bg-gray-800 dark:hover:bg-white/15 text-white t-micro font-medium transition-colors"
                  >
                    <Sparkles size={11} /> Get new models
                  </button>
                </div>
              ) : filteredModels.length === 0 ? (
                <div className="text-center py-10 space-y-2">
                  <p className="text-[0.7rem] text-gray-500">
                    No {modeMeta.label.toLowerCase()} models installed
                  </p>
                  <button
                    onClick={() => setTab('discover')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 t-micro text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
                  >
                    <Sparkles size={11} /> Get new {modeMeta.label.toLowerCase()} models
                  </button>
                </div>
              ) : (
                (() => {
                  const SectionIcon = modeMeta.icon
                  const shown = searchQuery
                    ? filteredModels.filter(m => installedRowMatchesSearch(m.name, searchQuery))
                    : filteredModels
                  return (
                    <section className="space-y-1.5">
                      <div className="flex items-center gap-2 px-1">
                        <SectionIcon size={11} />
                        <h2 className="t-micro font-semibold uppercase tracking-[0.12em] text-gray-700 dark:text-gray-300">
                          {modeMeta.label}
                        </h2>
                        <span className="text-[0.55rem] text-gray-400 dark:text-gray-500 tabular-nums">{shown.length}</span>
                        <div className="flex-1 h-px bg-gray-200 dark:bg-white/[0.06]" />
                      </div>
                      <div className="space-y-1.5">
                        {/* A14: a click on a Lazarus Engine card can move the chat
                            backend, so the same line the composer shows stands
                            here too, from the same store. */}
                        <LazarusEngineSwitchBar />
                        {/* Gegenprobe G1, 04.09.2026: sobald LM Studio den
                            Steckplatz haelt, faellt `Qwen3-4B-Q4_K_M`, eine
                            echte installierte Datei des Kunden von 2,3 GB,
                            aus dieser Liste weg. Die Seite zeigte "Installed
                            11" und unter Lazarus ENGINE vier statt fuenf Dateien,
                            ohne ein Wort. Der Waehler hatte den Satz laengst,
                            hier fehlte er, und genau hier hat der Kunde
                            gesucht. Ein Satz, zwei Leser. */}
                        {foldedRows && (
                          <p
                            data-testid="installed-folded-rows"
                            className="px-1 pt-0.5 text-[0.55rem] text-gray-500 dark:text-gray-500"
                          >
                            {foldedRowsSentence(foldedRows)}
                          </p>
                        )}
                        {/* A14: grouped by the backend that serves the row, Lazarus
                            Engine first. Its rows are listed here even while
                            Ollama or LM Studio holds the chat, and using one
                            of them moves the chat backend, so the heading says
                            whose row it is before the click. One group draws
                            no heading: there is nothing to tell apart then. */}
                        {(() => {
                          const providerGroups = groupInstalledByProvider(shown as unknown as InstalledModelLike[])
                          // One group normally draws no heading. The exception
                          // is a Lazarus Engine group while another backend holds
                          // the chat: then the heading is not decoration, it is
                          // the warning that a click here moves the backend.
                          const showHeadings = needsBackendSwitchHeading(providerGroups.map((g) => g.label), lazarusEngineHoldsChat ? null : LAZARUS_ENGINE_GROUP)
                          let drawn = 0
                          return providerGroups.map(({ label, models: rows }) => (
                            <div key={label} className="space-y-1.5">
                              {showHeadings && (
                                <p className="px-1 pt-1 t-label font-medium text-gray-500 dark:text-gray-500">
                                  {label}
                                </p>
                              )}
                              {(rows as unknown as AIModel[]).map((model) => {
                                const i = drawn++
                                return (
                          <motion.div
                            key={model.name}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.015 }}
                          >
                            <ModelCard
                              model={model}
                              isActive={model.name === activeModel}
                              onSelect={() => { void setActiveModel(model.name) }}
                              // The Use button the 2.6.8 notes promise on this
                              // tile. Only where the word means anything: an
                              // Lazarus Engine row that is not already active. It
                              // fires the same call the tile click does.
                              onUse={
                                isBuiltinEngineEntry(model as unknown as InstalledModelLike)
                                  ? async () => {
                                      setUsingModel(model.name)
                                      try { await setActiveModel(model.name) } finally { setUsingModel(null) }
                                    }
                                  : undefined
                              }
                              useBusy={usingModel === model.name}
                              // Steht die Engine, darf auch die aktive Zeile
                              // wieder gestartet werden (Persona P2). Die
                              // Antwort gilt fuer die Engine, nicht fuer jede
                              // Zeile: welche davon sie bedient, entscheidet
                              // die Karte selbst.
                              engineStopped={engineRuht}
                              onDelete={() => setConfirmDelete(model.name)}
                              onInfo={() => handleInfo(model.name)}
                              canDelete={
                                // Ollama text models via the Ollama API; image/video
                                // models are ComfyUI files we can delete from disk;
                                // a Lazarus Engine row is a GGUF Lazarus can delete itself.
                                (ollamaEnabled && model.type === 'text' && (!('provider' in model) || model.provider === 'ollama'))
                                || model.type === 'image' || model.type === 'video'
                                || lazarusEngineFile(model)
                              }
                            />
                          </motion.div>
                                )
                              })}
                            </div>
                          ))
                        })()}
                        {shown.length === 0 && (
                          <p className="text-center t-micro text-gray-500 py-6">No installed {modeMeta.label.toLowerCase()} models match "{searchQuery}"</p>
                        )}
                      </div>
                    </section>
                  )
                })()
              )}
            </>
          )}

          {!showMlxPanel && tab === 'discover' && (
            rail === 'lora' ? (
              // Same panel as the checkpoint search one rail up, asked for a
              // different type. The folder a hit lands in follows from that
              // type inside searchCivitaiModels, so there is no second place
              // that decides where a LoRA is written.
              <div className="space-y-2">
                <p className="px-1 t-micro text-gray-500 dark:text-gray-500">
                  Downloads land in ComfyUI&apos;s models/loras folder. {LORA_USE_HINT}
                </p>
                <CivitaiSearchPanel
                  modelType="LORA"
                  title="Search LoRA catalogs"
                  placeholder="e.g. character, story, coding style, defensive security..."
                  search={searchQuery}
                  searchSubmitToken={searchSubmitToken}
                  compatibleArchitectures={models
                    .filter((model): model is Extract<AIModel, { type: 'image' | 'video' }> =>
                      (model.type === 'image' || model.type === 'video')
                      && 'source' in model
                      && (model.source === 'checkpoint' || model.source === 'diffusion_model'))
                    .map((model) => model.architecture)}
                  comfyAvailable={comfyReachable}
                />
              </div>
            ) : (
              <DiscoverModels
                category={mode}
                search={searchQuery}
                searchSubmitToken={searchSubmitToken}
              />
            )
          )}
        </div>
      </div>

      <PullModelDialog open={pullOpen} onClose={() => setPullOpen(false)} />

      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete Model">
        <p className="text-[0.7rem] text-gray-600 dark:text-gray-300 mb-3">
          Are you sure you want to delete <span className="text-gray-900 dark:text-white font-mono">{confirmDelete}</span>?
          This removes the model file from your disk and frees the space.
        </p>
        {(() => {
          const row = models.find((m: AIModel) => m.name === confirmDelete)
          return row && lazarusEngineFile(row) ? (
            <p className="t-micro font-mono text-gray-500 dark:text-gray-400 mb-3 break-all" data-testid="delete-file-path">{row.path}</p>
          ) : null
        })()}
        <div className="flex gap-2">
          <GlowButton variant="secondary" onClick={() => setConfirmDelete(null)} className="flex-1">
            Cancel
          </GlowButton>
          <GlowButton variant="danger" onClick={() => confirmDelete && handleDelete(confirmDelete)} className="flex-1">
            Delete
          </GlowButton>
        </div>
      </Modal>

      <Modal open={!!deleteError} onClose={() => setDeleteError(null)} title="Delete failed">
        <p className="text-[0.7rem] text-red-500 dark:text-red-400 mb-3">{deleteError}</p>
        <GlowButton variant="secondary" onClick={() => setDeleteError(null)} className="w-full">
          Close
        </GlowButton>
      </Modal>

      <Modal open={infoOpen} onClose={() => setInfoOpen(false)} title={modelInfo?.name || 'Model Info'}>
        {modelInfo && (
          <pre className="t-micro text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-black/30 rounded-lg p-3 overflow-auto max-h-80 scrollbar-thin font-mono">
            {JSON.stringify(modelInfo, null, 2)}
          </pre>
        )}
      </Modal>
    </div>
  )
}
