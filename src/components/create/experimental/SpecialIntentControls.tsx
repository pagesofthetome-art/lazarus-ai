// Composer surfaces for the 2.5.8 specialized Create categories
// (Character-Studio, talking character, music, extend, motion). Each intent
// owns exactly the inputs its lane consumes; everything stages into
// createStore slots. On the cloud backend useCloudCreate submits them; since
// 2.5.8 music / lipsync / extend / motion also run locally (useCreate's
// specialized lanes), and the surfaces below fork only where the two lanes
// genuinely differ (extend's source pick, the cloud voice maker).

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Download, Film, ImagePlus, Info, Mic, Music2, Upload, X,
} from 'lucide-react'
import { useCreateStore, type CreateIntent, type GalleryItem } from '../../../stores/createStore'
import { useCloudCatalogStore, cloudModelById, modelForOp } from '../../../stores/cloudCatalogStore'
import {
  characterTrainerStatus, installCharacterTrainer, parseLocalCharacterLora,
  TRAINER_BASE_FILES, baseDownloadRunning, baseDownloadPercent, type TrainerStatus,
} from '../../../api/trainer'
import { startModelDownload, getDownloadProgress } from '../../../api/discover'
import { useDownloadStore } from '../../../stores/downloadStore'
import { getLoraModels } from '../../../api/comfyui'
import { isWindows, isMacOS } from '../../../api/backend'
import { musicTakesLyrics, musicHowtoLines } from '../../../lib/render/music-ui'
import { galleryLabelShort } from '../../../lib/render/gallery-label'
import { TRAIN_PRESETS, trainStepsNote } from '../../../lib/trainer-presets'
import { trainerPathPlaceholder } from '../../../lib/trainer-path-placeholder'
import { trainerRootHint } from '../../../lib/trainer-root-hint'
import { loadImageRef } from './loadImage'
import { mediaRefFrom } from './mediaRef'
import { fetchGalleryItemBlob } from './galleryUrl'
import { Button } from '../ui/Button'
import { Segmented } from '../ui/Segmented'
import { Slider } from '../ui/Slider'
import { cn } from '../ui/cn'
import { useClickAway } from '../ui/useClickAway'
import { Modal } from '../../ui/Modal'

export function SpecialControls({ intent }: { intent: CreateIntent }) {
  switch (intent) {
    case 'character': return <CharacterPanel />
    case 'lipsync': return <LipsyncControls />
    case 'music': return <MusicControls />
    case 'extend': return <ExtendControls />
    case 'motion': return <MotionControls />
    default: return null
  }
}

// ── shared chip: a small labeled file slot (audio/video/image) ──────────────
//
// `mediaRefFrom` used to be defined right here, and the training board in
// Stage.tsx had its own inline copy of the same two lines. Two mints, one
// release — and it was the copy without a release. Both now come from
// `./mediaRef`, whose counterpart in createStore is
// `releaseDroppedMediaRefs`. Do NOT revoke in this file: the ref outlives the
// component, it lives in the store.

function FileChip({
  icon: Icon,
  empty,
  value,
  accept,
  onFile,
  onClear,
}: {
  icon: typeof Upload
  empty: string
  value: string | null
  accept: string
  onFile: (f: File) => void
  onClear: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="flex items-center">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ''
        }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        className={cn(
          't-control flex items-center gap-1.5 px-2.5 h-[var(--control-h-sm)] rounded-md border transition-colors',
          value
            ? 'bg-white/[0.06] border-white/10 text-gray-200'
            : 'bg-white/[0.03] border-white/[0.06] text-gray-400 hover:text-gray-200 hover:border-white/15',
        )}
      >
        <Icon size={12} />
        <span className="max-w-[140px] truncate">{value ?? empty}</span>
      </button>
      {value && (
        <button onClick={onClear} className="p-1 text-gray-500 hover:text-gray-300" title="Remove" aria-label="Remove">
          <X size={11} />
        </button>
      )}
    </div>
  )
}

// The character-image slot writes the shared Stage source (an ImageRef with a
// data-URL preview — the cloud upload path re-encodes from it).
function PortraitChip({ empty }: { empty: string }) {
  const source = useCreateStore((s) => s.source)
  const setSource = useCreateStore((s) => s.setSource)
  return (
    <FileChip
      icon={ImagePlus}
      empty={empty}
      value={source ? 'Image ready' : null}
      accept="image/*"
      onFile={(f) => { void loadImageRef(f).then(setSource) }}
      onClear={() => setSource(null)}
    />
  )
}

function DrivingVideoChip({ empty }: { empty: string }) {
  const videoInput = useCreateStore((s) => s.videoInput)
  const setVideoInput = useCreateStore((s) => s.setVideoInput)
  return (
    <FileChip
      icon={Film}
      empty={empty}
      value={videoInput?.name ?? null}
      accept="video/mp4,video/webm,video/quicktime"
      onFile={(f) => setVideoInput(mediaRefFrom(f))}
      onClear={() => setVideoInput(null)}
    />
  )
}

// ── Character-Studio ────────────────────────────────────────────────────────

function CharacterPanel() {
  const characterTab = useCreateStore((s) => s.characterTab)
  const setCharacterTab = useCreateStore((s) => s.setCharacterTab)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-center">
        <Segmented
          size="sm"
          layoutId="character-tab"
          value={characterTab}
          onChange={(v) => setCharacterTab(v as 'train' | 'use')}
          options={[
            { value: 'train', label: 'Train new' },
            { value: 'use', label: 'Use character' },
          ]}
        />
      </div>
      {characterTab === 'train' ? (
        <LocalTrainControls />
      ) : (
        <LocalCharacterShelf />
      )}
    </div>
  )
}

// Das Trainer-Installationspfad-Feld des Erstsetup-Gates. `status` speist nur
// `trainerRootHint`; Wert und Aenderungs-Handler gehoeren dem Aufrufer.
//
// A1-Korrektur (Final Review, 19.09.2026): dieses Feld war bis eben auch im
// Reinstall-Dialog, mit demselben Ordner vorbelegt. Das war der Blocker: ein
// Kunde, der bloss bestaetigt, schickte seinen bestehenden Standardordner als
// nicht-leeren Pfad an install_character_trainer, und trainer_root_is_customized()
// kippte auf true, obwohl sich nichts geaendert hatte -- die Cache-Migration
// (apply_trainer_cache_env, trainer.rs:363) griff dann fuer einen Kunden, der
// sie nie ausgeloest hatte, und liess pip/Torch mehrere GB neu laden, die
// schon auf der Platte lagen. Der Reinstall-Dialog zeigt den Ordner jetzt nur
// noch als Text (siehe TrainerReinstallModal) und schickt denselben leeren
// bzw. vorbelegten Pfad wie vor dem Z5-Umbau.
function TrainerPathField({
  value,
  onChange,
  status,
}: {
  value: string
  onChange: (v: string) => void
  status: Pick<TrainerStatus, 'root' | 'customized' | 'suggestedRoot'>
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`e.g. ${trainerPathPlaceholder(isWindows(), isMacOS())}`}
        className="t-control w-64 px-2.5 h-[var(--control-h-sm)] rounded-md bg-white/[0.03] border border-white/[0.06] text-gray-200 placeholder-gray-600 focus:outline-none focus:border-white/15"
      />
      <span className="t-label text-gray-600">{trainerRootHint(status, value, status.suggestedRoot)}</span>
    </div>
  )
}

// Z5 (box-gruen/b, e2e Windows, 18.09.2026): "Reinstall trainer" hat bisher
// install_character_trainer im selben Moment ausgeloest, in dem der Knopf
// geklickt wurde, ohne Bestaetigung, ohne Chance, vorher zu sehen, was
// passiert. Die Rust-Seite loescht `<root>` dabei NICHT (siehe Doc-Kommentar
// von provision_trainer_env: `<root>/train` und `<root>/models` werden nie
// angefasst), ersetzt aber die venv (Rebuild oder Torch/musubi neu
// installieren, siehe `venv_action`), und genau das hat den Tester auf
// box-gruen mitten im Klick ueberrascht. Dieser Dialog sagt das ehrlich und
// ruft den Install-Befehl erst auf, wenn der Kunde "Reinstall" drueckt.
//
// A1/Blocker-Korrektur (Final Review, 19.09.2026): der Ordner ist hier nur
// noch Text, nicht editierbar. Ein editierbares Feld, vorbelegt mit dem
// bestehenden Ordner, hat jeden gewoehnlichen Reinstall (Kunde bestaetigt
// ohne etwas zu aendern) zu einem "customized" Pfad gemacht und damit den
// Cache-Migrationsschutz ausgeloest, den es hier nicht geben soll. Einen
// anderen Ordner fuer den Trainer waehlen geht weiterhin nur ueber das
// Erstsetup-Gate (TrainerPathField oben, bevor envReady zum ersten Mal wahr
// wird); ein Weg, das nach der Erstinstallation zu aendern, existiert in der
// App bisher nicht.
function TrainerReinstallModal({
  open,
  onClose,
  status,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  status: TrainerStatus
  onConfirm: () => void
}) {
  return (
    <Modal open={open} onClose={onClose} title="Reinstall the trainer?">
      <div className="space-y-4 text-sm text-gray-200">
        <p className="t-body leading-relaxed text-gray-300">
          This sets up the trainer's Python environment again: PyTorch and musubi-tuner get reinstalled. Your training photos and downloaded base models are not touched. Setup needs about 3 GB of downloads, same as the first install.
        </p>
        <p className="t-label text-gray-500 text-center">Trainer folder: {status.root}</p>
        <div className="flex flex-col gap-2 pt-1">
          <button
            onClick={onConfirm}
            data-destructive
            className="w-full px-4 py-2 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 text-blue-200 text-sm font-medium transition-colors"
          >
            Reinstall
          </button>
          <button
            onClick={onClose}
            data-autofocus
            className="w-full px-4 py-1.5 rounded-lg hover:bg-white/5 text-gray-500 hover:text-gray-300 text-xs transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  )
}

// Local training readiness + inputs (2.5.8 A5). Three gates render in order:
// trainer env (one-time musubi setup) -> Z-Image base files -> the actual
// trigger/steps inputs. The Rust side is the source of truth for readiness.
function LocalTrainControls() {
  const triggerWord = useCreateStore((s) => s.triggerWord)
  const setTriggerWord = useCreateStore((s) => s.setTriggerWord)
  const trainImages = useCreateStore((s) => s.trainImages)
  const trainSteps = useCreateStore((s) => s.trainSteps)
  const setTrainSteps = useCreateStore((s) => s.setTrainSteps)
  const isGenerating = useCreateStore((s) => s.isGenerating)
  const [status, setStatus] = useState<TrainerStatus | null>(null)
  const [busy, setBusy] = useState<'install' | 'bases' | null>(null)
  const [note, setNote] = useState<string | null>(null)
  // K5 (DIE-301-LISTE, Discord "Storage", x_guestieco_x): the trainer's
  // venv, torch and its pip/HF/torch caches all follow `trainer_root`
  // (see apply_trainer_cache_env in commands/trainer.rs), but nothing ever
  // let a customer set `trainer_root` in the first place, so the redirect
  // never fired for anyone. This is the smallest honest fix: the same
  // "type a path, it becomes the install target" control Settings > ComfyUI
  // already uses for install_comfyui, reused here for the one other local
  // installer that downloads multiple GB. Left empty, install_character_trainer
  // keeps its existing default (the app data folder), so this changes
  // nothing for a customer who never touches it.
  //
  // `typedPath` holds only what the customer actually typed. Lint-Fix
  // (react-hooks/set-state-in-effect, 19.09.2026): this used to be a second
  // piece of state (`installPath`) kept in sync with `status` through a
  // `useEffect` that called `setInstallPath` on every status/pathTouched
  // change. That is exactly the anti-pattern the rule flags -- state derived
  // from other state belongs in render, not in an effect that races the
  // render it is meant to feed. `installPath` below is now computed directly
  // from `typedPath`, `pathTouched` and `status` on every render; see
  // bau/lintfix.md for the truth table proving this is not a behavior change.
  const [typedPath, setTypedPath] = useState('')
  // K5 Nachbesserung, point 3: once the customer has typed anything (or the
  // field was pre-filled and they clear it on purpose), stop overwriting
  // their edit with the backend's current root on every poll.
  const [pathTouched, setPathTouched] = useState(false)
  // Z5 (box-gruen/b): der Bestaetigungsdialog vor "Reinstall trainer".
  const [reinstallOpen, setReinstallOpen] = useState(false)

  const refresh = useCallback(() => {
    characterTrainerStatus().then(setStatus).catch(() => setStatus(null))
  }, [])
  useEffect(() => { refresh() }, [refresh])

  // K5 Nachbesserung, point 3: the field must always show the actually
  // valid path, not stay blank while a customized root is already active
  // (the old bug behind Blocker 2 -- a broken customized install re-showed
  // this gate with an empty field and a caption that still claimed the app
  // data default).
  //
  // Teil 10, point 3 (Opus review of `3ef38668`): a customer who never opens
  // this gate never learns that `suggestedRoot` exists at all -- it used to
  // sit only in the grayed-out placeholder, invisible the moment the field
  // has focus and gone the instant anything is typed. Nothing here moves an
  // EXISTING install: this only pre-fills the field, with a real, editable,
  // clearable value, and only while there is no trainer yet (this whole
  // gate only renders before `envReady`) and no customized root of the
  // customer's own to preserve.
  const installPath = pathTouched ? typedPath : status?.customized ? status.root : (status?.suggestedRoot ?? '')

  // A base-file download outlives this panel. Leave the tab and come back and
  // the button read "Download base files" again with no note, while the 19 GB
  // kept flowing in the tray (Phase G, Windows box, 06.09.2026). On mount the
  // meter picks a running download back up, and the poll below carries on.
  useEffect(() => {
    let live = true
    getDownloadProgress()
      .then((prog) => { if (live && baseDownloadRunning(prog)) setBusy('bases') })
      .catch(() => {})
    return () => { live = false }
  }, [])

  // While an install or a bases download runs, poll its progress into `note`.
  useEffect(() => {
    if (!busy) return
    const t = setInterval(async () => {
      if (busy === 'install') {
        const s = await characterTrainerStatus().catch(() => null)
        if (!s) return
        setStatus(s)
        const last = s.install.logs[s.install.logs.length - 1]
        if (last) setNote(last)
        if (s.install.status !== 'installing') {
          setBusy(null)
          if (s.install.status === 'complete') setNote(null)
        }
      } else {
        const prog = await getDownloadProgress().catch(() => ({} as Record<string, { progress: number; total: number; status: string; filename: string; error?: string }>))
        const pct = baseDownloadPercent(prog)
        if (pct !== null) {
          setNote(`Downloading base files (${pct}% of about 19 GB)...`)
          return
        }
        const failed = TRAINER_BASE_FILES.map((f) => prog[f.filename]).find((r) => r?.status === 'error')
        const s = await characterTrainerStatus().catch(() => null)
        if (s) setStatus(s)
        if (failed) {
          setNote(failed.error ?? 'Download failed. Check your connection and retry.')
          setBusy(null)
        } else if (s?.basesReady) {
          setNote(null)
          setBusy(null)
        }
      }
    }, 2000)
    return () => clearInterval(t)
  }, [busy])

  const runInstall = async (path: string) => {
    setBusy('install')
    setNote('Setting up the trainer...')
    try { await installCharacterTrainer(path.trim() || undefined) } catch (e) {
      setNote(e instanceof Error ? e.message : 'Install could not start.')
      setBusy(null)
    }
  }
  // The setup-gate button keeps using whatever the customer typed there
  // (or the pre-filled suggestion, or their own customized root).
  const startInstall = () => runInstall(installPath)
  // B1-Korrektur (Final Review Teil 17, review-teil17-lintfix.md): a
  // reinstall must NEVER move the trainer folder. `installPath` above also
  // carries `suggestedRoot` once no customized root exists (so the
  // erstsetup gate can show it), but that suggestion is for the FIRST
  // installation only. Sending it here on a bare "confirm the reinstall"
  // click wrote it into `trainer_root`, flipped
  // `trainer_root_is_customized()` to true for a customer who never
  // touched this setting, and moved the pip/HF/torch caches away from an
  // existing installation -- exactly the migration this dialog's text
  // ("training photos and downloaded base models are not touched")
  // promises will not happen. A reinstall therefore sends the customer's
  // own root only if the trainer is already customized, and `undefined`
  // (the default, i.e. today's location) in every other case.
  const confirmReinstall = async () => {
    setReinstallOpen(false)
    await runInstall(status?.customized ? status.root : '')
  }
  const startBases = async () => {
    if (!status) return
    setBusy('bases')
    setNote('Starting the downloads...')
    const missing = TRAINER_BASE_FILES.filter((f) =>
      (f.subfolder === 'diffusion_models' && !status.dit) ||
      (f.subfolder === 'text_encoders' && !status.textEncoder) ||
      (f.subfolder === 'vae' && !status.vae))
    // Same tray registration the Create install cards do: without it the header
    // Downloads tray reads "No active downloads" through a multi GB transfer and
    // its cancel + retry buttons never appear.
    const dl = useDownloadStore.getState()
    if (missing.length > 1) dl.setBundleGroup('Character Studio base models', missing.map((f) => f.filename))
    for (const f of missing) {
      dl.setMeta(f.filename, f.url, f.subfolder)
      try { await startModelDownload(f.url, f.subfolder, f.filename) } catch (e) {
        setNote(e instanceof Error ? e.message : `Could not start ${f.filename}.`)
      }
      dl.startPolling()
    }
  }

  if (!status) {
    return <div className="t-label text-gray-600 text-center">Checking the local trainer…</div>
  }
  if (!status.envReady || (busy === 'install' && status.install.status === 'installing')) {
    return (
      <div className="flex flex-col items-center gap-1.5">
        <div className="flex items-center gap-2 flex-wrap justify-center">
          <span className="t-label text-gray-500">Trains fully on your GPU. One time setup, about 3 GB.</span>
          <Button size="sm" variant="secondary" icon={Download} loading={busy === 'install'} disabled={busy === 'install'} onClick={startInstall}>
            {busy === 'install' ? 'Setting up…' : 'Set up trainer'}
          </Button>
        </div>
        {busy !== 'install' && (
          <TrainerPathField
            value={installPath}
            onChange={(v) => { setTypedPath(v); setPathTouched(true) }}
            status={status}
          />
        )}
        {note && <div role="status" tabIndex={0} className="text-xs leading-relaxed text-gray-600 max-w-[520px] max-h-40 overflow-y-auto select-text whitespace-pre-wrap text-center break-words">{note}</div>}
      </div>
    )
  }
  if (!status.basesReady) {
    return (
      <div className="flex flex-col items-center gap-1.5">
        <div className="flex items-center gap-2">
          <span className="t-label text-gray-500">Z Image training base files are missing (about 19 GB, one time).</span>
          <Button size="sm" variant="secondary" icon={Download} loading={busy === 'bases'} disabled={busy === 'bases'} onClick={startBases}>
            {busy === 'bases' ? 'Downloading…' : 'Download base files'}
          </Button>
        </div>
        {/* K5 Blocker 3 (Opus review of `4fda5a0a`): these bytes go through
            download_model, which follows your configured model folder
            (Settings, ComfyUI), not the trainer folder set on the previous
            screen. Said here so the setup does not read as one place for
            everything the trainer downloads. */}
        <span className="t-label text-gray-600">Goes to your configured model folder (Settings, ComfyUI).</span>
        {note && <div role="status" tabIndex={0} className="text-xs leading-relaxed text-gray-600 max-w-[520px] max-h-40 overflow-y-auto select-text whitespace-pre-wrap text-center break-words">{note}</div>}
      </div>
    )
  }
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex items-center justify-center gap-2 flex-wrap">
        <input
          value={triggerWord}
          onChange={(e) => setTriggerWord(e.target.value)}
          placeholder="Trigger word, e.g. davechar"
          className="t-control w-44 px-2.5 h-[var(--control-h-sm)] rounded-md bg-white/[0.03] border border-white/[0.06] text-gray-200 placeholder-gray-600 focus:outline-none focus:border-white/15"
        />
        <Segmented
          size="sm"
          layoutId="train-steps"
          value={String(trainSteps)}
          onChange={(v) => setTrainSteps(Number(v))}
          options={TRAIN_PRESETS.map((p) => ({ value: String(p.steps), label: p.label }))}
        />
        <span className="t-label text-gray-600">
          {trainImages.length}/30 photos{trainImages.length < 4 ? ', need at least 4' : ''}
        </span>
      </div>
      {!isGenerating && (
        <div className="t-label text-gray-600 flex items-center gap-1.5">
          {/* Die Klammer nennt die Stufe UND die Zahl. Fund 2 der Kampagne
              3.0.0: `(400 STEPS)` allein sagt nicht, welche der drei Stufen
              gerade gilt, und ein Tester hielt Quick deshalb fuer wirkungslos,
              obwohl Quick genau diese 400 sind. */}
          <span>Runs on your GPU and takes a while ({trainStepsNote(trainSteps)}). The local chat model pauses for the run. The character lands in your local LoRAs.</span>
          {/* The run repairs its own environment now (A2), so this is no
              longer the only way out of a broken install. It stays because
              the button used to render ONLY while the environment counted as
              not ready, which is exactly when a customer with a stale torch
              build could not reach it (bob80817, D#102). */}
          <button
            type="button"
            onClick={() => setReinstallOpen(true)}
            disabled={busy === 'install'}
            className="underline underline-offset-2 text-gray-500 hover:text-gray-300 disabled:opacity-50 transition-colors"
          >
            {busy === 'install' ? 'Reinstalling…' : 'Reinstall trainer'}
          </button>
        </div>
      )}
      {note && <div role="status" tabIndex={0} className="text-xs leading-relaxed text-gray-600 max-w-[520px] max-h-40 overflow-y-auto select-text whitespace-pre-wrap text-center break-words">{note}</div>}
      <TrainerReinstallModal
        open={reinstallOpen}
        onClose={() => setReinstallOpen(false)}
        status={status}
        onConfirm={confirmReinstall}
      />
    </div>
  )
}

// Local Use shelf: characters are the trainer's own `char_<name>_zimage`
// LoRA files. Picking one activates the LoRA on the normal image chain and
// surfaces the trigger word; generation itself is the plain local image path.
function LocalCharacterShelf() {
  const selectedCharacter = useCreateStore((s) => s.selectedCharacter)
  const setSelectedCharacter = useCreateStore((s) => s.setSelectedCharacter)
  const selectedLoras = useCreateStore((s) => s.selectedLoras)
  const toggleLora = useCreateStore((s) => s.toggleLora)
  const charactersVersion = useCreateStore((s) => s.charactersVersion)
  const [files, setFiles] = useState<string[] | null>(null)

  useEffect(() => {
    let live = true
    getLoraModels()
      .then((l) => { if (live) setFiles(l) })
      .catch(() => { if (live) setFiles([]) })
    return () => { live = false }
  }, [charactersVersion])

  const chars = (files ?? []).map(parseLocalCharacterLora)
    .filter((c): c is NonNullable<ReturnType<typeof parseLocalCharacterLora>> => c !== null)

  return (
    <div className="flex items-center justify-center gap-1.5 flex-wrap">
      {files === null && <span className="t-label text-gray-600">Loading your characters…</span>}
      {files !== null && chars.length === 0 && (
        <span className="t-label text-gray-600">No local characters yet. Train one first.</span>
      )}
      {chars.map((c) => {
        const active = selectedCharacter?.id === `local:${c.file}`
        return (
          <button
            key={c.file}
            onClick={() => {
              if (active) {
                setSelectedCharacter(null)
                if (selectedLoras.some((l) => l.name === c.file)) toggleLora(c.file)
                return
              }
              // One character at a time: drop other char LoRAs from the chain.
              for (const l of selectedLoras) {
                if (l.name !== c.file && parseLocalCharacterLora(l.name)) toggleLora(l.name)
              }
              if (!selectedLoras.some((l) => l.name === c.file)) toggleLora(c.file)
              setSelectedCharacter({ id: `local:${c.file}`, name: c.trigger, triggerWord: c.trigger, family: 'z-image' })
            }}
            className={cn(
              't-control flex items-center gap-1.5 px-2.5 h-[var(--control-h-sm)] rounded-md border transition-colors',
              active
                ? 'bg-white/10 border-white/20 text-white'
                : 'bg-white/[0.03] border-white/[0.06] text-gray-400 hover:text-gray-200',
            )}
            title={`Trigger word: ${c.trigger}`}
          >
            <span className="max-w-[110px] truncate">{c.trigger}</span>
            <span className="t-label text-gray-500">Z-Image</span>
          </button>
        )
      })}
      {selectedCharacter && (
        <span className="t-label text-gray-500 w-full text-center">
          Put “{selectedCharacter.triggerWord}” in your prompt. Works best with a Z Image base model.
        </span>
      )}
    </div>
  )
}

// ── Talking character (lipsync) ─────────────────────────────────────────────

export function LipsyncControls() {
  const cloudOpModel = useCreateStore((s) => s.cloudOpModel)
  const audioInput = useCreateStore((s) => s.audioInput)
  const setAudioInput = useCreateStore((s) => s.setAudioInput)
  // Catalog subscription so the chip row re-renders when the live catalog
  // arrives and flips the picked model's source type.
  useCloudCatalogStore((s) => s.fetchedAt)
  const model = cloudModelById(modelForOp('video', 'lipsync', cloudOpModel))
  const needsClip = model?.lipsync_source === 'video'

  return (
    <div className="flex items-center justify-start gap-2 flex-wrap">
      {needsClip ? (
        <DrivingVideoChip empty="Add video to resync" />
      ) : (
        <PortraitChip empty="Add character" />
      )}
      <VoiceChip
        audioName={audioInput?.name ?? null}
        onAudioFile={(f) => setAudioInput(mediaRefFrom(f))}
        onClear={() => setAudioInput(null)}
      />
    </div>
  )
}

function VoiceChip({
  audioName,
  onAudioFile,
  onClear,
}: {
  audioName: string | null
  onAudioFile: (f: File) => void
  onClear: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const value = audioName
  return (
    <div className="relative flex items-center">
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onAudioFile(f)
          e.target.value = ''
        }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        className={cn(
          't-control flex items-center gap-1.5 px-2.5 h-[var(--control-h-sm)] rounded-md border transition-colors',
          value
            ? 'bg-white/[0.06] border-white/10 text-gray-200'
            : 'bg-white/[0.03] border-white/[0.06] text-gray-400 hover:text-gray-200 hover:border-white/15',
        )}
      >
        <Mic size={12} />
        <span className="max-w-[150px] truncate">{value ?? 'Add voice'}</span>
      </button>
      {value && (
        <button onClick={onClear} className="p-1 text-gray-500 hover:text-gray-300" title="Remove voice" aria-label="Remove voice">
          <X size={11} />
        </button>
      )}
    </div>
  )
}

// ── Music ───────────────────────────────────────────────────────────────────

function MusicControls() {
  const musicDuration = useCreateStore((s) => s.musicDuration)
  const setMusicDuration = useCreateStore((s) => s.setMusicDuration)
  const musicLyrics = useCreateStore((s) => s.musicLyrics)
  const setMusicLyrics = useCreateStore((s) => s.setMusicLyrics)
  const cloudOpModel = useCreateStore((s) => s.cloudOpModel)
  const isCloud = useCreateStore((s) => s.backend) === 'cloud'
  // Cloud: only ace-step-1.5 has a lyrics input on the wire (catalog `lyrics`
  // flag); the other music endpoints write their own lyrics from the prompt,
  // so offering the box there would be a lie.
  // Local: every music checkpoint runs through buildMusicWorkflow, which feeds
  // `lyrics` straight into the ACE-Step encoder. Asking the CLOUD catalog about
  // a local checkpoint returns undefined, which is how the local tab ended up
  // hiding the lyrics box and claiming the model writes its own, while sitting
  // on the one model that sings yours (#108, ElBiggus).
  const canLyrics = musicTakesLyrics(
    isCloud ? 'cloud' : 'local',
    cloudModelById(modelForOp('audio', 'music', cloudOpModel))?.lyrics === true,
  )
  const howtoLines = musicHowtoLines(isCloud ? 'cloud' : 'local')
  const musicHowtoSeen = useCreateStore((s) => s.musicHowtoSeen)
  const setMusicHowtoSeen = useCreateStore((s) => s.setMusicHowtoSeen)
  const [lyricsOpen, setLyricsOpen] = useState(musicLyrics.length > 0)
  const [howtoOpen, setHowtoOpen] = useState(false)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-center gap-3">
        <div className="w-56">
          <Slider
            label="Length"
            min={5}
            max={240}
            step={5}
            value={musicDuration}
            onChange={setMusicDuration}
            format={(v) => `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`}
          />
        </div>
        {canLyrics ? (
          <button
            onClick={() => setLyricsOpen((o) => !o)}
            className={cn(
              't-control flex items-center gap-1.5 px-2.5 h-[var(--control-h-sm)] rounded-md border transition-colors',
              lyricsOpen
                ? 'bg-white/[0.06] border-white/10 text-gray-200'
                : 'bg-white/[0.03] border-white/[0.06] text-gray-400 hover:text-gray-200',
            )}
          >
            <Music2 size={12} /> Lyrics
          </button>
        ) : (
          <span className="t-control text-gray-500">
            This model writes its own lyrics from the prompt. Pick ACE-Step 1.5 to sing yours.
          </span>
        )}
        <div className="relative">
          <button
            onClick={() => {
              setHowtoOpen((o) => !o)
              if (!musicHowtoSeen) setMusicHowtoSeen(true)
            }}
            className={cn(
              't-control flex items-center gap-1.5 px-2.5 h-[var(--control-h-sm)] rounded-md border transition-colors',
              howtoOpen
                ? 'bg-white/[0.06] border-white/10 text-gray-200'
                : 'bg-white/[0.03] border-white/[0.06] text-gray-400 hover:text-gray-200',
            )}
          >
            <Info size={12} /> How to
          </button>
          {!musicHowtoSeen && (
            <span aria-hidden className="absolute top-0 right-0 w-1.5 h-1.5 rounded-full bg-lazarus-accent pointer-events-none" />
          )}
        </div>
      </div>
      <AnimatePresence>
        {howtoOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="t-control px-3 py-2 rounded-md bg-white/[0.03] border border-white/[0.06] text-gray-400 space-y-1 text-left">
              {/* Copy lives in music-ui.ts so the claims are asserted, not
                  eyeballed. The local panel used to promise other downloadable
                  models and per-second billing (#108). */}
              {howtoLines.map((line, i) => (
                <p key={i} className={i === 0 ? 'text-gray-200' : undefined}>{line}</p>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {canLyrics && lyricsOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <textarea
              value={musicLyrics}
              onChange={(e) => setMusicLyrics(e.target.value)}
              placeholder="Your lyrics. [Verse] and [Chorus] markers make them sing best…"
              rows={3}
              className="w-full t-control px-2.5 py-1.5 rounded-md bg-white/[0.03] border border-white/[0.06] text-gray-200 placeholder-gray-600 focus:outline-none focus:border-white/15 resize-none"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Extend ──────────────────────────────────────────────────────────────────

/** Grab the LAST frame of a video (blob URL or object URL) as a PNG File —
 *  the local extend lane feeds it to the regular I2V graph as the start
 *  image. Uses a same-origin blob URL so the canvas never taints. */
async function lastFrameFile(videoUrl: string, name: string): Promise<File> {
  const video = document.createElement('video')
  video.muted = true
  video.preload = 'auto'
  video.src = videoUrl
  await new Promise<void>((res, rej) => {
    video.onloadedmetadata = () => res()
    video.onerror = () => rej(new Error('could not read the video'))
  })
  // Seek close to the end; some containers refuse duration exactly.
  video.currentTime = Math.max(0, (video.duration || 1) - 0.05)
  await new Promise<void>((res, rej) => {
    video.onseeked = () => res()
    video.onerror = () => rej(new Error('could not seek the video'))
  })
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth || 832
  canvas.height = video.videoHeight || 480
  canvas.getContext('2d')!.drawImage(video, 0, 0)
  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('could not capture the frame'))), 'image/png'))
  return new File([blob], `${name.replace(/\.[^.]+$/, '')}_lastframe.png`, { type: 'image/png' })
}

function ExtendControls() {
  const backend = useCreateStore((s) => s.backend)
  return backend === 'local' ? <LocalExtendControls /> : <CloudExtendControls />
}

/** Local lane: pick one of your local gallery videos (or upload a clip) —
 *  its last frame becomes the Stage source, and the regular I2V flow
 *  continues from there. */
function LocalExtendControls() {
  const source = useCreateStore((s) => s.source)
  const setSource = useCreateStore((s) => s.setSource)
  const setError = useCreateStore((s) => s.setError)
  const clips = useCreateStore((s) => s.gallery).filter((g) => g.type === 'video' && !g.jobId)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pickedLabel, setPickedLabel] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const ref = useRef<HTMLDivElement>(null)
  useClickAway(ref, () => setOpen(false), open)

  const adopt = async (getUrl: () => Promise<{ url: string; revoke?: () => void }>, label: string) => {
    setBusy(true)
    setError(null)
    try {
      const { url, revoke } = await getUrl()
      try {
        const frame = await lastFrameFile(url, label)
        setSource(await loadImageRef(frame))
        setPickedLabel(label)
      } finally {
        revoke?.()
      }
    } catch (e) {
      setError(`Could not read the clip: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
      setOpen(false)
    }
  }

  const fromGallery = (g: GalleryItem) =>
    adopt(async () => {
      const blob = await fetchGalleryItemBlob(g)
      const url = URL.createObjectURL(blob)
      return { url, revoke: () => URL.revokeObjectURL(url) }
    }, g.prompt.slice(0, 40) || 'Local video')

  const fromFile = (f: File) =>
    adopt(async () => {
      const url = URL.createObjectURL(f)
      return { url, revoke: () => URL.revokeObjectURL(url) }
    }, f.name)

  const value = source && pickedLabel ? pickedLabel : null
  return (
    <div className="flex items-center justify-center">
      <div ref={ref} className="relative flex items-center">
        <input
          ref={inputRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void fromFile(f)
            e.target.value = ''
          }}
        />
        <button
          onClick={() => setOpen((o) => !o)}
          disabled={busy}
          className={cn(
            't-control flex items-center gap-1.5 px-2.5 h-[var(--control-h-sm)] rounded-md border transition-colors',
            value
              ? 'bg-white/[0.06] border-white/10 text-gray-200'
              : 'bg-white/[0.03] border-white/[0.06] text-gray-400 hover:text-gray-200 hover:border-white/15',
          )}
        >
          <Film size={12} />
          <span className="max-w-[220px] truncate">
            {busy ? 'Reading last frame…' : value ? `Continues: ${value}` : 'Pick the clip to extend'}
          </span>
        </button>
        {value && (
          <button
            onClick={() => { setSource(null); setPickedLabel(null) }}
            className="p-1 text-gray-500 hover:text-gray-300" title="Clear" aria-label="Clear"
          >
            <X size={11} />
          </button>
        )}
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.12 }}
              className="lu-elevated absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 z-50 w-72 rounded-lg p-1 max-h-64 overflow-y-auto scrollbar-thin"
            >
              <button
                onClick={() => inputRef.current?.click()}
                className="w-full flex items-center gap-2 t-control text-gray-300 px-2.5 py-1.5 rounded-md hover:bg-white/[0.06]"
              >
                <Upload size={12} /> Upload a video file
              </button>
              {clips.length > 0 && <div className="t-label text-gray-600 px-2.5 py-1 border-t border-white/[0.06] mt-1">Your local videos</div>}
              {clips.map((g) => (
                <button
                  key={g.id}
                  onClick={() => { void fromGallery(g) }}
                  className="w-full flex items-center gap-2 t-control text-gray-300 px-2.5 py-1.5 rounded-md hover:bg-white/[0.06]"
                >
                  <Film size={12} />
                  <span className="truncate">{g.prompt || 'Local video'}</span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

function CloudExtendControls() {
  const extendSource = useCreateStore((s) => s.extendSource)
  const setExtendSource = useCreateStore((s) => s.setExtendSource)
  const clips = useCreateStore((s) => s.gallery).filter((g) => g.type === 'video' && g.jobId)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickAway(ref, () => setOpen(false), open)

  return (
    <div className="flex items-center justify-center">
      <div ref={ref} className="relative flex items-center">
        <button
          onClick={() => setOpen((o) => !o)}
          className={cn(
            't-control flex items-center gap-1.5 px-2.5 h-[var(--control-h-sm)] rounded-md border transition-colors',
            extendSource
              ? 'bg-white/[0.06] border-white/10 text-gray-200'
              : 'bg-white/[0.03] border-white/[0.06] text-gray-400 hover:text-gray-200 hover:border-white/15',
          )}
        >
          <Film size={12} />
          <span className="max-w-[200px] truncate">
            {extendSource ? extendSource.label : 'Pick one of your cloud videos'}
          </span>
        </button>
        {extendSource && (
          <button onClick={() => setExtendSource(null)} className="p-1 text-gray-500 hover:text-gray-300" title="Clear" aria-label="Clear">
            <X size={11} />
          </button>
        )}
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.12 }}
              className="lu-elevated absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 z-50 w-72 rounded-lg p-1 max-h-64 overflow-y-auto scrollbar-thin"
            >
              {clips.length === 0 && (
                <div className="t-control text-gray-500 px-2.5 py-2">
                  No cloud videos yet. Render one on the Video tab first.
                </div>
              )}
              {clips.map((g) => (
                <button
                  key={g.id}
                  onClick={() => {
                    setExtendSource({
                      jobId: g.jobId as string,
                      url: g.remoteUrl ?? '',
                      // P9: 'Cloud video' was the old blanket notname
                      // gallery-label.ts's own header comment names as the
                      // problem it fixes (David, 19.09.2026: "everything
                      // after that is just Cloud videos"). A prompt-less
                      // entry here is routinely a Studio step (sharpen,
                      // extend, a preset step), galleryLabelShort names
                      // those from their model/label instead of a blank
                      // notname.
                      label: galleryLabelShort(g, 40),
                    })
                    setOpen(false)
                  }}
                  className="w-full flex items-center gap-2 t-control text-gray-300 px-2.5 py-1.5 rounded-md hover:bg-white/[0.06]"
                >
                  <Film size={12} />
                  <span className="truncate">{galleryLabelShort(g, 60)}</span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

// ── Motion control ──────────────────────────────────────────────────────────

function MotionControls() {
  return (
    <div className="flex items-center justify-center gap-2 flex-wrap">
      <PortraitChip empty="Add character image" />
      <DrivingVideoChip empty="Add driving video (dance/pose)" />
    </div>
  )
}
