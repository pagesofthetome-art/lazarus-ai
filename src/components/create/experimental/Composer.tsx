import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, X, SlidersHorizontal, Square, Workflow, Paperclip } from 'lucide-react'
import { useCreateStore, MODEL_TYPE_DEFAULTS, EDIT_MAX_DENOISE } from '../../../stores/createStore'
import { classifyModel } from '../../../api/comfyui'
import { useCreateExp } from './CreateContext'
import { intentToJob } from '../../../lib/render/cloud-jobs'
import { meterState } from '../../../lib/render/credits-meter'
import {
  cloudModelById,
  defaultCloudModel,
  defaultEditModel,
  isEditCapable,
  modelForOp,
  runCredits,
} from '../../../stores/cloudCatalogStore'
import { intentRequiredInputs, intentRoles, isStudioModel, resolveIntentPick } from '../../../lib/render/create-studio'
import { STUDIO_MODELS } from '../../../lib/render/studio-contract'
import { effectiveVideoDurations, snapToVideoDuration } from '../../../lib/render/video-duration'
import { mediaSeconds, useStudioPrice } from './useStudioPrice'
import { INTENT_MAP } from './intents'
import { subscribeInstallRuns, getInstallRun } from '../../../lib/model-install-runs'
import { useWorkflowStore, shouldShowManagerNotice } from '../../../stores/workflowStore'
import { noPromptHint, shouldShowLaneHint } from './laneHint'
import { needsMaskFor } from './maskGate'
import { ModelChip } from './ModelChip'
import { PromptHistory } from './PromptHistory'
import { LipsyncControls, SpecialControls } from './SpecialIntentControls'
import { mediaRefFrom } from './mediaRef'
import { loadImageRef } from './loadImage'
import { Button } from '../ui/Button'
import { PromptField } from '../ui/PromptField'
import { Segmented } from '../ui/Segmented'
import { Slider } from '../ui/Slider'
import { Tooltip } from '../ui/Tooltip'
import { cn } from '../ui/cn'

interface Props {
  onOpenAdvanced: () => void
  onOpenWorkflows: () => void
}

export function Composer({ onOpenAdvanced, onOpenWorkflows }: Props) {
  const intent = useCreateStore((s) => s.intent())
  const meta = INTENT_MAP[intent]
  const prompt = useCreateStore((s) => s.prompt)
  const setPrompt = useCreateStore((s) => s.setPrompt)
  const setSource = useCreateStore((s) => s.setSource)
  const setAudioInput = useCreateStore((s) => s.setAudioInput)
  const setVideoInput = useCreateStore((s) => s.setVideoInput)
  const setError = useCreateStore((s) => s.setError)
  const negativePrompt = useCreateStore((s) => s.negativePrompt)
  const setNegativePrompt = useCreateStore((s) => s.setNegativePrompt)
  const showNegative = useCreateStore((s) => s.showNegative)
  const toggleNegative = useCreateStore((s) => s.toggleNegative)
  const source = useCreateStore((s) => s.source)
  const mask = useCreateStore((s) => s.mask)
  const isGenerating = useCreateStore((s) => s.isGenerating)
  const backend = useCreateStore((s) => s.backend)
  const targetResolution = useCreateStore((s) => s.targetResolution)
  const setTargetResolution = useCreateStore((s) => s.setTargetResolution)
  const cloudImageModel = useCreateStore((s) => s.cloudImageModel)
  const cloudVideoModel = useCreateStore((s) => s.cloudVideoModel)
  const cloudOpModel = useCreateStore((s) => s.cloudOpModel)
  const cloudStudioOptions = useCreateStore((s) => s.cloudStudioOptions)
  const frames = useCreateStore((s) => s.frames)
  const fps = useCreateStore((s) => s.fps)
  // 2.5.8 specialized-intent inputs (readiness for the Create button).
  const characterTab = useCreateStore((s) => s.characterTab)
  const trainImages = useCreateStore((s) => s.trainImages)
  const selectedCharacter = useCreateStore((s) => s.selectedCharacter)
  const audioInput = useCreateStore((s) => s.audioInput)
  const videoInput = useCreateStore((s) => s.videoInput)
  const extendSource = useCreateStore((s) => s.extendSource)
  const musicDuration = useCreateStore((s) => s.musicDuration)
  const managerNoticeSeen = useWorkflowStore((s) => s.managerNoticeSeen)
  const { generate, cancel, quota } = useCreateExp()

  // The Create button turns into Cancel in place — a double-click's second
  // press would instantly cancel the run it just started. Ignore cancel
  // presses in the first 400ms after starting.
  const startedAt = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const guardedGenerate = useCallback(() => {
    startedAt.current = Date.now()
    generate()
  }, [generate])
  const attachFile = useCallback(async (file: File) => {
    try {
      if (file.type.startsWith('image/')) {
        setSource(await loadImageRef(file))
      } else if (file.type.startsWith('audio/')) {
        setAudioInput(mediaRefFrom(file))
      } else if (file.type.startsWith('video/')) {
        setVideoInput(mediaRefFrom(file))
      } else {
        setError('This file type is not supported here. Add an image, audio, or video file.')
      }
    } catch (error) {
      setError(`Could not attach that file: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [setAudioInput, setError, setSource, setVideoInput])
  const guardedCancel = useCallback(() => {
    if (Date.now() - startedAt.current < 400) return
    cancel()
  }, [cancel])

  // Single-purpose endpoints (cutout/upscale/eraser): no prompt, no
  // generation knobs, no model choice — just the input (+ mask/resolution).
  const isUtility = meta.id === 'removebg' || meta.id === 'upscale' || meta.id === 'eraser'
  // 2.5.8 categories with their own composer surfaces + input contracts.
  const special =
    intent === 'character' || intent === 'lipsync' || intent === 'music' ||
    intent === 'extend' || intent === 'motion'
  const characterUse = intent === 'character' && characterTab === 'use'
  let { kind: intentKind, op: intentOp } = intentToJob(intent)
  if (characterUse) {
    // The use-surface is a plain image generate with the character attached.
    intentKind = 'image'
    intentOp = 'generate'
  }
  // The prompt field shows wherever the run consumes one — that's the meta
  // flag, plus Character-Studio's use-surface (train has no prompt).
  const needPrompt = meta.needsPrompt || characterUse
  // Gate on the exact run's cost (model + op + clip length), the same figure
  // the CreditsMeter shows — quota.costs[kind] is only the tier's
  // representative per-kind number and would mis-gate utility ops / pricier
  // models.
  // Studio-Spur (Portplan Abschnitt 3d): ein DRITTER Zweig, strikt hinter
  // `backend === 'cloud'`. Nur die vier Rollen-Absichten (lipsync/music/
  // extend/motion, intentRoles(intent), P2) koennen ueberhaupt ein
  // Studio-Modell fahren; character-use bleibt bei seiner festen
  // -lora-Familie (resolveCharacterModel) und ruehrt Studio nie an. Auf der
  // lokalen Spur ist `studioPick` immer undefined, und ausschliesslich das
  // haelt useStudioPrice unten von jedem Netzabruf ab.
  const roleIntent = backend === 'cloud' && !characterUse && intentRoles(intent).length > 0
  const rolePick = roleIntent ? resolveIntentPick(intent, cloudOpModel) : undefined
  const studioPick = rolePick && isStudioModel(rolePick) ? rolePick : undefined
  const pickedModel = characterUse
    ? cloudOpModel
    : roleIntent
      ? (rolePick ?? '')
      : special
        ? cloudOpModel
        : (intentKind === 'video' ? cloudVideoModel : cloudImageModel) ||
          defaultCloudModel(intentKind)?.id || ''
  // A Studio pick runs on its own schema-driven endpoint (studioBaseCredits /
  // studioQuote), not on the classic per-kind picker's kind.
  const runKind = studioPick ? STUDIO_MODELS[studioPick].kind : intentKind
  const runSeconds =
    intentOp === 'music'
      ? musicDuration
      : runKind === 'video' && (intentOp === 'generate' || intentOp === 'animate') && fps > 0
        ? frames / fps
        : undefined
  // Die im Browser gemessene Laenge einer angehaengten Datei, gebraucht nur von den
  // Modellen, die danach abrechnen (studio-contract.ts, price.mode 'input'/'both');
  // useStudioPrice ruft dafuer nichts ab, solange sie fehlt.
  const mediaUrl =
    intent === 'lipsync' ? audioInput?.url
      : intent === 'motion' ? videoInput?.url
        : intent === 'extend' ? extendSource?.url
          : undefined
  const mediaKind = intent === 'lipsync' ? ('audio' as const) : ('video' as const)
  // Measured async only, and only into state the async callback itself
  // writes. Resetting synchronously inside the effect body (setState right
  // where mediaUrl is falsy) is exactly the cascading-render pattern the
  // set-state-in-effect rule flags. Keying the derived value off `mediaUrl`
  // clears it for free the moment the source changes or disappears.
  const [measured, setMeasured] = useState<{ url: string; seconds: number | undefined } | null>(null)
  useEffect(() => {
    let alive = true
    // Review A kleiner Punkt 2: this number only feeds useStudioPrice, which
    // itself already no-ops off the cloud track (`studioPick` is undefined
    // there). Gating here too means a local lipsync/motion/extend attach
    // never spins up an <audio>/<video> element and an 8s measuring timer
    // for a number nobody reads.
    if (backend !== 'cloud' || !mediaUrl) return
    void mediaSeconds(mediaUrl, mediaKind).then((v) => { if (alive) setMeasured({ url: mediaUrl, seconds: v }) })
    return () => { alive = false }
  }, [backend, mediaUrl, mediaKind])
  const inputSeconds = measured && measured.url === mediaUrl ? measured.seconds : undefined
  const studioPrice = useStudioPrice(studioPick, cloudStudioOptions, prompt, runSeconds ?? inputSeconds)
  const setCloudStudioCredits = useCreateStore((s) => s.setCloudStudioCredits)
  useEffect(() => {
    setCloudStudioCredits(studioPrice?.credits ?? null)
  }, [studioPrice?.credits, setCloudStudioCredits])
  const costFallback = quota?.costs[runKind === 'audio' ? 'image' : runKind] ?? 0
  // The exact rule the meter chip renders, so the button can never invite a run
  // the chip is already refusing. Credits alone were not enough: a user out of
  // monthly character trainings kept an enabled Create button and got a 429.
  // A Studio pick that could not get a server-confirmed price (old server,
  // unreachable) gates the button off too. Booking against a guessed number
  // risks a 409 the customer only sees after pressing Create.
  const creditsOk =
    backend !== 'cloud' ||
    (quota != null &&
      !(studioPick && studioPrice?.error) &&
      meterState(
        quota,
        studioPick ? (studioPrice?.credits ?? costFallback) : runCredits(intentKind, intentOp, pickedModel, runSeconds, costFallback, targetResolution),
        runKind,
        intentOp,
      ).kind === 'ok')
  // Match useCloudCreate's submit-time edit fallback so the Neg gate reflects
  // the model the run actually uses, not a t2i model still in the picker.
  const runModel =
    intentOp === 'edit' && !isEditCapable(pickedModel) ? (defaultEditModel()?.id ?? pickedModel) : pickedModel
  // Local model metadata controls whether the negative prompt applies.
  const negSupported = backend !== 'cloud' || cloudModelById(runModel)?.negative_prompt === true
  // R5-66: see maskGate.ts for the full rule and why 'edit' differs from Web.
  const needsMask = needsMaskFor(intent, backend, cloudModelById(runModel)?.maskless)
  // Per-intent readiness for the 2.5.8 categories (mirrors the submit-time
  // checks of BOTH lanes so the button never invites a doomed run). The
  // local lanes always speak from a portrait (no hosted resync endpoints)
  // and extend continues from the picked clip's extracted last frame, which
  // lives in `source`.
  const lipsyncNeedsClip =
    backend === 'cloud' &&
    intent === 'lipsync' &&
    cloudModelById(modelForOp('video', 'lipsync', cloudOpModel))?.lipsync_source === 'video'
  // Studio model metadata names any required inputs.
  const studioNeeds = studioPick ? intentRequiredInputs(intent, studioPick) : []
  const specialReady =
    intent === 'character'
      ? (characterUse ? !!selectedCharacter : trainImages.length >= 4)
      : intent === 'lipsync'
        ? !!audioInput &&
          (lipsyncNeedsClip
            ? !!videoInput
            : studioPick
              ? (!studioNeeds.includes('source_path') || !!source)
              : !!source)
        : intent === 'extend'
          ? (backend === 'cloud' ? !!extendSource : !!source)
          : intent === 'motion'
            ? !!source && !!videoInput
            : true
  // A half-installed bundle is pickable long before it is usable: the lane
  // list refills as soon as the diffusion model lands, while the VAE it needs
  // is still coming down. Measured on the box 2026-08-15 at 88 percent of the
  // Wan 2.2 bundle. Submitting there buys a ComfyUI error about a file that is
  // already on its way, so the button waits for the run that is filling this
  // lane. Local only: a cloud render needs nothing from that download.
  const installing = useSyncExternalStore(
    subscribeInstallRuns,
    () => (backend === 'local' && meta.requiresModels ? getInstallRun(meta.requiresModels).running : false),
  )
  const canGenerate =
    (!needPrompt || prompt.trim().length > 0) &&
    (!meta.needsSource || !!source) &&
    (!needsMask || !!mask) &&
    specialReady &&
    creditsOk &&
    !installing
  const showNoPromptHint = shouldShowLaneHint({ needPrompt, isGenerating, intent, specialReady })

  return (
    // A stable min-height (bottom-anchored) so the prompt window occupies the
    // same vertical space on every tab — utility modes (no LaneControls / no
    // prompt) don't shrink it. That keeps the viewer + gallery row above it the
    // exact SAME height across all tabs, not just within one.
    <div className="shrink-0 px-4 pb-4 pt-2 min-h-[192px] flex flex-col justify-end">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,audio/*,video/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void attachFile(file)
          event.target.value = ''
        }}
      />
      {/* 660, nicht 760: dieselbe Spalte wie im Chat, und dieselbe Rechnung.
          Die 760 waren hier als KOPIE von --lu-measure eingetippt; seit die
          App eine --ui-scale hat, wird die Zahl mitskaliert, 760 ergaebe also
          874 gerenderte px. 660 × 1.15 = 759 — die Breite, die diese Spalte
          vor der Umstellung hatte. Siehe --lu-measure in index.css; dass die
          Zahl hier doppelt steht statt den Token zu lesen, ist ein eigener
          Befund und hier nicht behoben. */}
      <div className="mx-auto w-full max-w-[660px] space-y-2.5">
        {special && intent !== 'lipsync' && <SpecialControls intent={intent} />}
        {!isUtility && <LaneControls />}

        <div className="rounded-[var(--radius-panel)] bg-white/[0.03] border border-white/[0.06] focus-within:border-white/15 transition-colors">
          {needPrompt && (
            <div className="px-3.5 pt-3">
              <PromptField
                value={prompt}
                onChange={setPrompt}
                placeholder={
                  characterUse
                    ? 'Describe the scene for your character…'
                    // R5-66: the shared 'edit' placeholder promises a maskless
                    // restyle that only the local lane actually allows once a
                    // cloud model requires a mask.
                    : (intent === 'edit' && needsMask
                      ? 'Describe the new look. Paint an area first to tell it what to change…'
                      : meta.placeholder)
                }
                onSubmit={() => canGenerate && !isGenerating && guardedGenerate()}
              />
            </div>
          )}

          {/* Das Negativfeld sieht aus wie ein Feld.
              Bis 2.6.7 war es eine randlose Zeile unter einer 1px-Trennlinie,
              in derselben Schriftgroesse (13px) und auf derselben Kante
              (x=282,2 gemessen) wie der Prompt darueber — nichts an ihm sagte
              „hier faengt eine zweite Eingabe an". Der Wert stand zudem in
              `text-gray-400`, waehrend die globale Platzhalterregel gray-200
              malte: 6,78:1 fuer das Getippte gegen 13,91:1 fuer den
              Platzhalter (WCAG 2.1 auf #1b1b1b, gemessen 01.09.2026). Das Feld
              war leer auffaelliger als gefuellt.
              Jetzt: eigene Flaeche + eigener Rand (dasselbe Rezept wie das
              Panel drumherum, eine Stufe schwaecher), und der eingetippte
              Negativprompt ist ein Wert wie jeder andere — er erbt die
              Textfarbe des Promptfeldes statt gedimmt zu werden. Wie stark
              der Platzhalter dagegen zuruecktritt, entscheidet jetzt
              ausschliesslich die ::placeholder-Regel in index.css. */}
          <AnimatePresence>
            {showNegative && needPrompt && negSupported && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div
                  id="negative-prompt-field"
                  className="mx-3.5 mt-2.5 px-2.5 py-2 rounded-[var(--radius-control)] bg-white/[0.03] border border-white/[0.08] focus-within:border-white/20 transition-colors"
                >
                  <span className="t-label text-gray-500 block pb-1">Negative prompt</span>
                  <PromptField
                    value={negativePrompt}
                    onChange={setNegativePrompt}
                    placeholder="What to avoid…"
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Ein Lauf, der weder Prompt noch Maske hat, bekommt die
              gattungstypische Kurzanleitung (noPromptHint). Braucht die
              Absicht eine gemalte Maske (Eraser, Cloud-Edit ohne
              maskenloses Modell), steht stattdessen die eine Zeile, die den
              Zustand der Maske selbst beschreibt, sonst stuende dort ein
              Text, der beim Radiergummi nie zutrifft ("remove the
              background"). */}
          {showNoPromptHint && !needsMask && (
            <div className="px-3.5 py-3 t-body text-gray-500">
              {noPromptHint(meta.id)}
            </div>
          )}
          {needsMask && !needPrompt && !isGenerating && (
            <div className="px-3.5 py-3 t-body text-gray-500">
              {mask ? 'Mask ready. Hit Create.' : 'Paint over what should go, then hit Create.'}
            </div>
          )}

          {/* Action bar */}
          <div className="flex items-center gap-1.5 px-2.5 py-2 border-t border-white/[0.05]">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Add an image, audio, or video file"
              aria-label="Add files"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-purple-300/35 bg-purple-500/10 text-purple-200 shadow-[0_0_14px_rgba(168,85,247,0.28)] transition-all hover:border-purple-200/65 hover:bg-purple-500/20 hover:text-white hover:shadow-[0_0_20px_rgba(168,85,247,0.48)]"
            >
              <Paperclip size={14} />
            </button>
            {intent === 'lipsync' && <LipsyncControls />}
            {/* Ein Schalter, der sagt, dass er einer ist. „Neg" war eine
                Abkuerzung, deren Aufloesung nur im Hover-`title` stand, und
                der Knopf meldete seinen Zustand an nichts ausser der
                Hintergrundfarbe: kein `aria-pressed`, kein `aria-expanded`,
                also fuer einen Screenreader ein gewoehnlicher Knopf ohne
                Zustand. Beides steht jetzt da, und `aria-controls` zeigt auf
                das Feld, das er aufklappt. */}
            {needPrompt && negSupported && (
              <button
                onClick={toggleNegative}
                aria-pressed={showNegative}
                aria-expanded={showNegative}
                aria-controls="negative-prompt-field"
                className={cn('t-control px-2 h-[var(--control-h-sm)] rounded-md transition-colors', showNegative ? 'bg-white/10 text-gray-200' : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.05]')}
                title="Say what the render should avoid"
              >
                Negative
              </button>
            )}
            {needPrompt && <PromptHistory onPick={setPrompt} />}
            <div className="flex-1" />
            {/* Portplan Abschnitt 5, Punkt 3: der Server ist die einzige
                Preiswahrheit fuer ein Studio-Modell. Ist er nicht erreichbar
                oder zu alt (studio.ts, OLDER_SERVER_MESSAGE), bleibt Create
                gesperrt UND sagt hier woran es liegt, statt still auf die
                Formel-Vorschau zurueckzufallen und dann doch zu buchen. */}
            {studioPick && studioPrice?.error && (
              <span className="t-control text-red-300">{studioPrice.error}</span>
            )}
            {meta.id === 'upscale' && (
              <Tooltip content="Target resolution for the upscale pass.">
                <div>
                  <Segmented
                    size="sm"
                    layoutId="upscale-res"
                    value={targetResolution}
                    onChange={(v) => setTargetResolution(v as '2k' | '4k' | '8k')}
                    options={[{ value: '2k', label: '2K' }, { value: '4k', label: '4K' }, { value: '8k', label: '8K' }]}
                  />
                </div>
              </Tooltip>
            )}
            {/* Custom ComfyUI graphs only run on the local backend, so the
                manager only shows where it can do something. Until the button
                was clicked once, a small dot marks it as new (David
                2026-08-02: no banner line, just a minimal marker that goes
                away on click). */}
            {backend === 'local' && (
              <Tooltip content="Your own ComfyUI workflows, and the tags that pair them with models.">
                <div className="relative">
                  <Button variant="ghost" size="sm" icon={Workflow} iconOnly onClick={onOpenWorkflows} title="Workflows and tags" />
                  {shouldShowManagerNotice(backend, managerNoticeSeen) && (
                    <span
                      aria-hidden
                      className="absolute top-0 right-0 w-1.5 h-1.5 rounded-full bg-lazarus-accent pointer-events-none"
                    />
                  )}
                </div>
              </Tooltip>
            )}
            {!isUtility && (
              <>
                <ModelChip />
                <Tooltip content="All advanced settings. Sampler, seed, LoRA, VAE and more.">
                  <Button variant="ghost" size="sm" icon={SlidersHorizontal} iconOnly onClick={onOpenAdvanced} title="Advanced settings" />
                </Tooltip>
              </>
            )}
            {isGenerating ? (
              <Button variant="danger" size="md" icon={X} onClick={guardedCancel}>Cancel</Button>
            ) : (
              <Button variant="primary" size="lg" icon={Sparkles} disabled={!canGenerate} onClick={guardedGenerate}>Create</Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Die Reglerzeile steht MITTIG ueber der Promptbox.
 *
 * David, 05.09.2026, am Windows-Bau: „die einstellungen ueber der promptbox
 * sollen immer mittig ueber der promptbox zentriert stehen." Das dreht D-S32
 * aus 2.6.8 zurueck, und zwar bewusst: dort war die Zeile auf die linke Kante
 * des Prompttextes gesetzt worden (`justify-start` plus 15px Polster), weil
 * eine mittige Zeile ueber linksbuendigem Text als zweite Kante gelesen
 * wurde. David sieht es umgekehrt, und ihm gehoert die Entscheidung.
 *
 * Gemessen am laufenden Bau (1296x808, --ui-scale 1.15, gerenderte Pixel):
 * die Promptbox steht auf Mitte x=648, der Inhalt der Reglerzeile auf x=505,7
 * (Image) und x=497,4 (Edit), also 142 bis 151 px links daneben.
 * `justify-center`
 * legt beide Mitten zusammen; der Kasten der Zeile ist ohnehin schon ein
 * Geschwister des Promptpanels und damit exakt gleich breit.
 *
 * Die Spezialflaechen der Unterkategorien (SpecialControls) stehen bereits
 * mittig, das ist hier also die einzige verbliebene Ausnahme.
 */
const LANE_ROW = 'flex items-center flex-wrap justify-center'

// Quality (proxy over steps) + Aspect (image) + Edit strength (edit).
// The tuning row above the prompt. It renders exactly the knobs the lane's
// submit path actually consumes, so nothing on screen is a dead control:
//   • image (generate / edit / character-use): quality + aspect (+ edit str)
//   • video LOCAL (any lane): steps + size + frames (frames follow the voice
//     on lipsync, so it's hidden there — useCreate derives it from the audio)
//   • video CLOUD regular (video / animate): same, cloud honours w/h/steps/frames
//   • video CLOUD specialized (lipsync / extend / motion): hidden — those ops
//     submit "bare" (fixed server-side), so the sliders would do nothing
//   • audio LOCAL (music): steps (Length lives in MusicControls)
//   • audio CLOUD (music): hidden — bare submit carries only duration + lyrics
function LaneControls() {
  const intent = useCreateStore((s) => s.intent())
  const meta = INTENT_MAP[intent]
  const backend = useCreateStore((s) => s.backend)
  const characterTab = useCreateStore((s) => s.characterTab)
  const steps = useCreateStore((s) => s.steps)
  const setSteps = useCreateStore((s) => s.setSteps)
  const denoise = useCreateStore((s) => s.denoise)
  const setDenoise = useCreateStore((s) => s.setDenoise)
  const imageModelType = useCreateStore((s) => s.imageModelType)
  const width = useCreateStore((s) => s.width)
  const height = useCreateStore((s) => s.height)
  const setSize = useCreateStore((s) => s.setSize)
  const frames = useCreateStore((s) => s.frames)
  const setFrames = useCreateStore((s) => s.setFrames)
  const fps = useCreateStore((s) => s.fps)
  // The local Frames slider only ever reads fps (for the "Nf · Xs" caption);
  // it is set from the video model's own defaults (setVideoModel), never by
  // hand here, so there is no local setFps caller any more now that the
  // cloud Length control owns its own field (Review A kleiner Punkt 1).
  // Review A kleiner Punkt 1: the cloud Length control below reads and
  // writes ITS OWN frames/fps, not the local track's. See the field's doc
  // comment in createStore.ts.
  const cloudFrames = useCreateStore((s) => s.cloudFrames)
  const setCloudFrames = useCreateStore((s) => s.setCloudFrames)
  const cloudFps = useCreateStore((s) => s.cloudFps)
  const setCloudFps = useCreateStore((s) => s.setCloudFps)
  const videoModel = useCreateStore((s) => s.videoModel)
  const cloudVideoModel = useCreateStore((s) => s.cloudVideoModel)

  const base = MODEL_TYPE_DEFAULTS[imageModelType]?.steps ?? 25
  const qSteps = { Draft: Math.round(base * 0.6), Standard: base, High: Math.round(base * 1.5) }
  const activeQ = nearestKey(qSteps, steps)

  // Character-Studio forks: the Train surface owns its own step control
  // (trainSteps in SpecialControls); Use is a plain image generate with the
  // trained LoRA attached, so it takes the image knobs below.
  const characterTrain = intent === 'character' && characterTab === 'train'
  const characterUse = intent === 'character' && characterTab === 'use'

  // The 2.5.8 specialized ops that submit "bare" on cloud (fixed server-side)
  // but consume the sliders locally — mirrors useCloudCreate's specialOp set.
  const specialOp = intent === 'lipsync' || intent === 'music' || intent === 'extend' || intent === 'motion'
  const kind: 'image' | 'video' | 'audio' =
    characterUse ? 'image' : intent === 'music' ? 'audio' : meta.isVideo ? 'video' : 'image'

  // dd29f359 (Portplan Abschnitt 6): the hosted video endpoints book whatever
  // lengths the provider actually prices (video-durations.json / the live
  // catalog's clip.durations), not a fixed 5s/8s pair. Cloud text-to-video /
  // animate is the only lane this reaches. Local video keeps its free
  // Frames slider (nothing here runs on the local track), and the 2.5.8
  // specialized ops (lipsync/music/extend/motion) submit bare and never see
  // this hook either (`knobsLive` below hides the whole row for them on
  // cloud). All hook calls stay UNCONDITIONAL (top of the component, before
  // any early return) so this never violates the rules of hooks across a
  // lane switch.
  const cloudVideoOp = intentToJob(intent).op
  const cloudVideoLaneModel = modelForOp('video', cloudVideoOp, cloudVideoModel || defaultCloudModel('video')?.id || '')
  const cloudVideoDurations = effectiveVideoDurations(cloudVideoLaneModel)
  // Review A kleiner Punkt 1 (studio-r2, 20.09.2026): this used to snap the
  // SHARED frames/fps and write back into them on every cloud model switch,
  // which silently rewrote the local Frames slider's remembered value too
  // (frames/fps back local video generation as well). Reading/writing
  // cloudFrames/cloudFps instead means a cloud length pick, or the snap this
  // effect performs when a model switch makes the current pick invalid,
  // never touches the local track's own frames/fps.
  const cloudVideoSeconds = cloudVideoDurations.length ? snapToVideoDuration(cloudVideoDurations, cloudFrames, cloudFps) : undefined
  useEffect(() => {
    if (
      backend === 'cloud' && kind === 'video' && !specialOp &&
      cloudVideoSeconds !== undefined && cloudFrames / cloudFps !== cloudVideoSeconds
    ) {
      setCloudFrames(cloudVideoSeconds * 16)
      setCloudFps(16)
    }
  }, [backend, kind, specialOp, cloudVideoSeconds, cloudFrames, cloudFps, setCloudFrames, setCloudFps])

  if (characterTrain) return null

  // ── Image lanes: quality + aspect (+ edit strength) ──
  if (kind === 'image') {
    return (
      <div className={cn(LANE_ROW, 'gap-3')}>
        {/* Bis 2.6.7 stand hier `transform: scale(0.7)` — die vierte
            Skalierungsschicht der App. Sie schrumpfte nur das Bild: die Zeile
            belegte weiter ihre volle Layoutbreite, und die 1px-Kanten der
            Segmented-Pillen wurden auf 0,7px gemalt. Die 0,7 stehen jetzt in
            den Tokens, die Segmented und LabeledControl ohnehin lesen — als
            Zielgroessen, nicht als Faktor: 26px Control -> 18px, 12px
            Controltext -> 8px, 10px Label -> 7px, 8px Radius -> 6px. */}
        <div className="flex items-center gap-1.5 [--control-h-sm:18px] [--text-control:8px] [--text-label:7px] [--radius-control:6px]">
          <LabeledControl label="Quality">
            <Segmented
              size="sm"
              layoutId="quality"
              value={activeQ}
              onChange={(k) => setSteps(qSteps[k as keyof typeof qSteps])}
              options={[{ value: 'Draft', label: 'Draft' }, { value: 'Standard', label: 'Standard' }, { value: 'High', label: 'High' }]}
            />
          </LabeledControl>

          {/* Aspect only where the output size is actually user-chosen — a pure
              from-scratch image. Edit/mask ops force the output to the source
              image's dimensions (useCloudCreate overrides w/h from the source),
              so the control was dead there. */}
          {!meta.needsSource && (
            <LabeledControl label="Aspect">
              <Segmented
                size="sm"
                layoutId="aspect"
                value={aspectKey(width, height)}
                onChange={(k) => { const p = aspectPresets(imageModelType)[k as AspectKey]; setSize(p.w, p.h) }}
                options={[
                  { value: '1:1', label: '1:1', icon: Square },
                  { value: '3:4', label: '3:4' },
                  { value: '4:3', label: '4:3' },
                  { value: '16:9', label: '16:9' },
                ]}
              />
            </LabeledControl>
          )}
        </div>

        {meta.id === 'edit' && (
          <div className="w-44">
            <Slider label="Edit strength" min={0.05} max={EDIT_MAX_DENOISE} step={0.05} value={Math.min(denoise, EDIT_MAX_DENOISE)} onChange={setDenoise} format={(v) => v.toFixed(2)} />
          </div>
        )}
      </div>
    )
  }

  // Below here it's video/audio. The sliders only drive a render where the
  // submit path reads them — hide the whole row on the cloud specialized ops.
  const knobsLive = backend !== 'cloud' || !specialOp
  if (!knobsLive) return null

  // ── Audio (music) LOCAL: steps only — Length lives in MusicControls. ──
  if (kind === 'audio') {
    return (
      <div className={LANE_ROW}>
        <div className="w-56">
          <Slider label="Quality (steps)" min={1} max={Math.max(60, base)} step={1} value={steps} onChange={setSteps} format={(v) => `${v}`} />
        </div>
      </div>
    )
  }

  // ── Video: steps + size + frames. Anchor the Size tiers + step ceiling to
  //    the lane's ACTUAL video-model type — imageModelType doesn't track the
  //    video model (setVideoModel/setIntent set width/height but leave it), so
  //    keying off it would show image-centric sizes (1024p) on a 480p video
  //    graph. Mirror the store's per-intent typing (setIntent). ──
  const laneType = intent === 'lipsync' ? 'wans2v' : intent === 'motion' ? 'wananimate' : classifyModel(videoModel)
  const vdef = MODEL_TYPE_DEFAULTS[laneType] ?? MODEL_TYPE_DEFAULTS.unknown
  const nativeShort = Math.min(vdef.width, vdef.height) || 480
  const nativeLong = Math.max(vdef.width, vdef.height) || 832
  const scale = Math.min(width, height) / nativeShort
  const resTiers = [0.66, 1, 1.5]
  const activeRes = String(resTiers.reduce((b, m) => Math.abs(m - scale) < Math.abs(b - scale) ? m : b, 1))
  const applyRes = (mult: number) => {
    const landscape = vdef.width >= vdef.height
    const short = snap16(nativeShort * mult)
    const long = snap16(nativeLong * mult)
    setSize(landscape ? long : short, landscape ? short : long)
  }
  const stepMax = Math.max(40, Math.round((vdef.steps ?? 25) * 1.5))
  const showFrames = intent !== 'lipsync' // lipsync frames follow the voice length

  return (
    <div className={cn(LANE_ROW, 'gap-4')}>
      <div className="w-40">
        <Slider label="Quality (steps)" min={1} max={stepMax} step={1} value={steps} onChange={setSteps} format={(v) => `${v}`} />
      </div>
      <LabeledControl label="Size">
        <Segmented
          size="sm"
          layoutId="lane-res"
          value={activeRes}
          onChange={(k) => applyRes(Number(k))}
          options={resTiers.map((m) => ({ value: String(m), label: `${snap16(nativeShort * m)}p` }))}
        />
      </LabeledControl>
      {backend === 'cloud' && cloudVideoDurations.length > 0 ? (
        // The hosted endpoint renders exactly these lengths (Portplan
        // Abschnitt 6), no fixed 5s/8s pair, and no unpriced button: every
        // option here has a catalog price, live via credits.by_duration or
        // the base/long split runCredits already falls back to.
        <LabeledControl label="Length">
          <Segmented
            size="sm"
            layoutId="clip-length"
            value={String(cloudVideoSeconds ?? cloudVideoDurations[0])}
            onChange={(k) => { setCloudFrames(Number(k) * 16); setCloudFps(16) }}
            options={cloudVideoDurations.map((secs) => ({ value: String(secs), label: `${secs}s` }))}
          />
        </LabeledControl>
      ) : backend === 'cloud' && kind === 'video' && !specialOp ? (
        // Review A kleiner Punkt 2 (Runde 2 report): an empty durations list
        // (no live catalog entry AND no video-durations.json fallback) used
        // to fall through to the LOCAL Frames slider here, which writes
        // `frames`, while the cloud booking (bookedVideoSeconds) reads
        // `cloudFrames` and throws on an empty allowed list regardless of
        // what that field holds. Unreachable with today's data (every
        // generating video model in the catalog carries a durations list),
        // but showing a working-looking slider for a cloud pick that can
        // only ever fail books nothing, so a plain notice is honest instead.
        <span className="t-label text-gray-600">clip length is not available for this model yet</span>
      ) : showFrames ? (
        <div className="w-44">
          <Slider label="Frames" min={9} max={121} step={4} value={frames} onChange={setFrames} format={(v) => `${v}f · ${(v / (fps || 16)).toFixed(1)}s`} />
        </div>
      ) : (
        <span className="t-label text-gray-600">clip length follows your voice</span>
      )}
    </div>
  )
}

function LabeledControl({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // gap-1 statt gap-1.5: 0,375rem × 0,7 ≈ 0,26rem, gerundet auf die
    // 4px-Stufe des 16px-Rasters. Siehe die Reglerzeile oben.
    <div className="flex items-center gap-1">
      <span className="t-label text-gray-600">{label}</span>
      {children}
    </div>
  )
}

// ── aspect helpers ──
type AspectKey = '1:1' | '3:4' | '4:3' | '16:9'
const RATIO: Record<AspectKey, number> = { '1:1': 1, '3:4': 3 / 4, '4:3': 4 / 3, '16:9': 16 / 9 }

function snap64(n: number): number { return Math.max(64, Math.round(n / 64) * 64) }
// Video dims want a multiple of 16 (the VAE/latent grid of the WAN/S2V/VACE
// families) — snap the resolution tiers to it so the graph never rejects them.
function snap16(n: number): number { return Math.max(128, Math.round(n / 16) * 16) }

function aspectPresets(modelType: string): Record<AspectKey, { w: number; h: number }> {
  const def = MODEL_TYPE_DEFAULTS[modelType as keyof typeof MODEL_TYPE_DEFAULTS] ?? MODEL_TYPE_DEFAULTS.sdxl
  const baseLong = Math.max(def.width, def.height)
  const out = {} as Record<AspectKey, { w: number; h: number }>
  for (const k of Object.keys(RATIO) as AspectKey[]) {
    const r = RATIO[k]
    out[k] = r >= 1 ? { w: baseLong, h: snap64(baseLong / r) } : { w: snap64(baseLong * r), h: baseLong }
  }
  return out
}

function aspectKey(w: number, h: number): AspectKey {
  const r = w / h
  let best: AspectKey = '1:1'; let bestD = Infinity
  for (const k of Object.keys(RATIO) as AspectKey[]) {
    const d = Math.abs(RATIO[k] - r)
    if (d < bestD) { bestD = d; best = k }
  }
  return best
}

function nearestKey(map: Record<string, number>, val: number): string {
  let best = Object.keys(map)[0]; let bestD = Infinity
  for (const [k, v] of Object.entries(map)) { const d = Math.abs(v - val); if (d < bestD) { bestD = d; best = k } }
  return best
}

// ── cloud video length (dd29f359, Portplan Abschnitt 6) ──
// Review A2 (Runde 2): moved into video-duration.ts, the one file the
// booking path (useCloudCreate, PresetWorkshop) now reads too, so the
// picker and the booking can never name two different lists again. Kept
// re-exported here so composer-video-duration.test.ts's import path (and
// any other caller of this module) still resolves.
export { effectiveVideoDurations, snapToVideoDuration }
