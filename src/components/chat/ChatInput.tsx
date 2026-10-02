import { useState, useRef, useEffect, useLayoutEffect, useCallback, type ReactNode } from 'react'
import { SamplingControls } from './SamplingControls'
import { Send, Square, Paperclip, X, Brain, Gauge, Terminal } from 'lucide-react'
import { matchAgentCommands, type AgentCommand, type CommandScope } from '../../lib/agent-commands'
import { VoiceButton } from './VoiceButton'
import { ApprovalDialog } from './ApprovalDialog'
import { useVoiceStore } from '../../stores/voiceStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useModelStore } from '../../stores/modelStore'
import { useChatStore } from '../../stores/chatStore'
import { isThinkingCompatible, isVisionCompatible, declaredVision } from '../../lib/model-compatibility'
import { clampEffort, effortChoices, effortLabel, nextEffort, DEFAULT_EFFORT } from '../../lib/effort'
import type { AgentToolCall } from '../../types/agent-mode'
import type { ImageAttachment } from '../../types/chat'
import { MAX_CHAT_IMAGES, prepareChatImages } from '../../lib/chat-image-input'
import { COMPOSER_MAX_W } from './composer-width'
import { consumeComposerFocusPending } from '../../hooks/useKeyboardShortcuts'
import { useChatNoticeStore, CHAT_NOTICE_MS } from '../../stores/chatNoticeStore'
import { fitTextarea } from '../../lib/fit-textarea'

interface Props {
  onSend: (content: string, images?: ImageAttachment[]) => void
  onStop: () => void
  /** THIS conversation is answering: the slot shows Stop. */
  isGenerating: boolean
  /**
   * THIS conversation's send is queued behind another local run (Runde 4,
   * review-lanes.md Blocker 1+6): the built-in engine runs one slot, so a
   * second local send waits its turn instead of racing the first one for it.
   * Distinct from plain `isGenerating`, where a stream is already flowing;
   * here nothing has started yet, but the composer still shows Stop (the
   * store aborter is registered the moment the run is admitted to the queue,
   * not only once it starts) and a line explains why nothing is happening.
   * Locking based on a DIFFERENT conversation is gone entirely as of this
   * round: each conversation now only answers for its own send, running or
   * queued, never for another one's.
   */
  waitingForLocalLane?: boolean
  pendingApproval?: AgentToolCall | null
  onApprove?: () => void
  onReject?: () => void
  disabled?: boolean
  /** Keep the draft editable but prevent sending until a surface prerequisite is met. */
  sendDisabled?: boolean
  sendDisabledReason?: string
  /**
   * Which commands this composer offers. Was a boolean meaning
   * "Coding-Agent-only"; since 2.6.8 it is the SCOPE, because the answer
   * stopped being all-or-nothing: plain chat offers /compact and nothing else,
   * while Agent and Coding offer the whole set. Undefined = no menu at all.
   */
  slashCommands?: CommandScope
  /**
   * The model picker, rendered on the right of the action bar (before Send).
   * The header no longer carries it. Each surface passes an upward-opening
   * ModelSelector so the prompt window owns the model choice (web parity).
   */
  composerModel?: ReactNode
  /** Rendered directly above the prompt box (the standing-goal bar). */
  composerAbove?: ReactNode
  /**
   * View-specific action buttons (Plugins · Tools) shown in the action
   * bar between Think and the model picker. Chat and Code pass different sets.
   */
  composerActions?: ReactNode
}

/** How long the synchronous double-fire guard below stays shut. */
const SEND_LOCK_MS = 700

/** The field grows with its text up to this height, then scrolls (matches `max-h-[200px]`). */
const COMPOSER_MAX_PX = 200

/**
 * The double-fire guard's clock read, deliberately OUTSIDE the component.
 *
 * Reading `Date.now()` from a function declared in the component body puts an
 * impure call in the render path as far as React 19 is concerned (`purity`),
 * and the rule is right about where such a read belongs: not in a component,
 * not in a hook. Moving the whole check out here keeps it exactly as
 * synchronous as it was (the point of the guard is that it decides inside the
 * same tick as the second keydown) and makes it a thing that can be reasoned
 * about (and tested) on its own. Returns false when the send must be dropped.
 */
function passSendLock(lock: { current: number }): boolean {
  const now = Date.now()
  if (now - lock.current < SEND_LOCK_MS) return false
  lock.current = now
  return true
}

export function ChatInput({ onSend, onStop, isGenerating, waitingForLocalLane, pendingApproval, onApprove, onReject, disabled, sendDisabled, sendDisabledReason, slashCommands, composerModel, composerActions, composerAbove }: Props) {
  const [input, setInput] = useState('')
  const [images, setImages] = useState<ImageAttachment[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const [preparingImages, setPreparingImages] = useState(false)
  const imageJob = useRef({ busy: false, epoch: 0 })
  const [isVoiceRecording, setIsVoiceRecording] = useState(false)
  // Slash-command autocomplete (v2.5.3). When the input is a lone "/token", show
  // the matching agent commands; ↑/↓ to move, Enter/Tab to pick, Esc to dismiss.
  const [cmdMenu, setCmdMenu] = useState<AgentCommand[]>([])
  const [cmdIndex, setCmdIndex] = useState(0)
  /**
   * Ein Entwurf gehoert dem Gespraech, in dem er getippt wurde.
   *
   * Der Composer wird beim Wechsel nicht neu gebaut, also stand der halbe Satz
   * aus dem alten Chat im neuen wieder im Feld, einmal beobachtet am
   * 03.09.2026, mit dem naheliegenden Ausgang: der Satz geht an den falschen
   * Empfaenger. Ihn beim Wechsel einfach zu leeren waere die andere Haelfte
   * desselben Fehlers, nur teurer (Arbeit weg), darum wird er beiseitegelegt
   * und beim Zurueckkommen wieder hingelegt. Bilder reisen mit dem Text, sonst
   * hinge die Anlage am falschen Satz.
   *
   * WIE der Wechsel bemerkt wird, ist nicht Geschmack, sondern die Stelle, an
   * der dieser Block zweimal mit React aneinandergeriet. Er stand bis zum
   * 03.09.2026 als Effekt hier, mit zwei Refs davor, und war der einzige rote
   * Punkt von `npm run lint`. In Wahrheit zwei, denn eslint meldet pro
   * Komponente nur den ersten:
   *
   *   1. `react-hooks/refs`, "Cannot access refs during render". Der Stand des
   *      Feldes wurde blank im Renderkoerper in ein Ref geschrieben
   *      (`standRef.current = { input, images }`), damit der Effekt beim
   *      Wechsel noch an die Werte VOR dem Wechsel kam.
   *   2. `react-hooks/set-state-in-effect`. Der Effekt rief `setInput` und
   *      `setImages` direkt auf, also genau die Kaskade, vor der die Regel
   *      warnt: erst ein Commit mit dem alten Entwurf, dann ein zweiter mit
   *      dem neuen.
   *
   * Beide Regeln haben recht, und beide zeigen auf dieselbe Ursache: ein
   * Effekt ist der falsche Ort. React nennt den richtigen selbst ("You Might
   * Not Need an Effect" → Zustand anpassen, wenn sich etwas geaendert hat):
   * der Vergleich mit dem vorigen Wert steht IM Render, und die Anpassung
   * geschieht dort. React laeuft die Komponente sofort noch einmal, bevor es
   * ueberhaupt etwas uebergibt.
   *
   * Damit fallen beide Fehler zusammen mit ihrer Ursache weg. Das Ref fuer den
   * Stand braucht es nicht mehr: im Wechselrender fuehren `input` und `images`
   * noch den alten Entwurf, denn geleert wird erst hier, eine Zeile weiter
   * unten. Das ist derselbe Wert, den das Ref transportiert hat, nur ohne
   * Umweg. Und die Kaskade entfaellt, weil der Wechsel keinen eigenen Commit
   * mehr kostet: das Feld ist schon leer, wenn der neue Chat zum ersten Mal
   * zu sehen ist, statt fuer einen Frame den fremden Satz zu zeigen.
   *
   * Die beiden Refs sind deshalb Zustand geworden. Ein Ref darf im Render
   * nicht gelesen werden (Regel 1), und gelesen werden muessen hier beide.
   */
  const conversationId = useChatStore((s) => s.activeConversationId)
  useEffect(() => {
    const job = imageJob.current
    const unsubscribe = useChatStore.subscribe((state, previous) => {
      if (state.activeConversationId !== previous.activeConversationId) job.epoch++
    })
    const stop = () => { job.epoch++; unsubscribe() }
    return stop
  }, [])
  const [entwuerfe, setEntwuerfe] = useState<Record<string, { text: string; bilder: ImageAttachment[] }>>({})
  const [letztesGespraech, setLetztesGespraech] = useState(conversationId)
  if (letztesGespraech !== conversationId) {
    const vorher = letztesGespraech
    setLetztesGespraech(conversationId)
    if (vorher) {
      const text = input
      const bilder = images
      // Der Aktualisierer laeuft unter StrictMode zweimal und muss deshalb
      // beim zweiten Mal dasselbe Ergebnis liefern wie beim ersten. Er
      // rechnet nur aus `bisher`, haengt also an nichts, was er selbst
      // veraendert.
      setEntwuerfe((bisher) => {
        if (text || bilder.length) return { ...bisher, [vorher]: { text, bilder } }
        if (!(vorher in bisher)) return bisher
        const ohne = { ...bisher }
        delete ohne[vorher]
        return ohne
      })
    }
    // Gelesen wird der Stand VOR dieser Anpassung, und das ist richtig:
    // geschrieben wurde gerade der Schluessel `vorher`, geholt wird
    // `conversationId`, und die beiden sind hier nie dasselbe.
    const zurueck = conversationId ? entwuerfe[conversationId] : undefined
    setInput(zurueck?.text ?? '')
    setImages(zurueck?.bilder ?? [])
    setCmdMenu([])
  }
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Text already in the box when dictation started. Interim + final transcripts
  // are written as base + transcript, so streaming chunks REPLACE (not stack)
  // and pre-typed text is never wiped.
  const dictationBaseRef = useRef('')
  const isTranscribing = useVoiceStore((s) => s.isTranscribing)
  const thinkingEnabled = useSettingsStore((s) => s.settings.thinkingEnabled)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const activeModel = useModelStore((s) => s.activeModel)
  const activeModelMeta = useModelStore((s) => s.models.find((m) => m.name === s.activeModel))
  // Server-declared capability (retired hosted service carries thinkMode from /models) wins
  // over the local name-heuristic; 'always' renders the toggle locked on.
  const thinkMode = activeModelMeta && 'thinkMode' in activeModelMeta ? activeModelMeta.thinkMode : undefined
  const thinkLockedOn = thinkMode === 'always'
  const canThink = thinkMode ? thinkMode === 'toggle' : isThinkingCompatible(activeModel)
  // Same server-over-heuristic precedence for vision (input_modalities →
  // supportsVision, and the built-in engine's projector-on-disk answer). A
  // declared flag counts in both directions; models without one still fall
  // back to the name heuristic.
  // Reasoning effort. The rungs come from the server catalogue per model, so a
  // model that declares none gets no control at all and behaves as before. The
  // displayed rung is the CLAMPED one, because that is what goes on the wire:
  // showing 'Max' while sending 'high' would be a control that lies.
  const reasoningEffort = useSettingsStore((s) => s.settings.reasoningEffort)
  const effortLevels = activeModelMeta && 'effortLevels' in activeModelMeta ? activeModelMeta.effortLevels : undefined
  const effortDefault = activeModelMeta && 'effortDefault' in activeModelMeta ? activeModelMeta.effortDefault : undefined
  const effortSteps = effortChoices(effortLevels)
  const effortNow = clampEffort(effortLevels, reasoningEffort ?? DEFAULT_EFFORT, effortDefault)
  // Only while thinking is really happening. 'always' models keep their Think
  // button locked on, so the rung is live there without the button being.
  const thinkingIsOn = thinkLockedOn || (thinkingEnabled && canThink)
  const showEffort = effortSteps.length > 0 && thinkingIsOn
  const serverVision = declaredVision(activeModelMeta)
  const canSeeImages = serverVision !== undefined ? serverVision : isVisionCompatible(activeModel)

  /**
   * Auflage 1 (Review composer, 19.09.2026): `key={conversationId}` weiter
   * unten montiert das Feld beim Gespraechswechsel neu, ein frischer Knoten
   * hat aber nie von selbst Fokus. `useKeyboardShortcuts.ts` setzt die Fahne
   * NUR, wenn der Tastendruck ("new-conversation", Ctrl/Cmd+N) selbst aus
   * diesem Feld kam; ein Wechsel per Sidebar-Klick oder waehrend der Nutzer
   * in einem Suchfeld/Modal tippt, setzt sie nie und stiehlt hier folglich
   * nichts. `consumeComposerFocusPending()` liest und loescht sie in einem
   * Schritt, und das geschieht bewusst HIER im Effekt (nach dem Commit, der
   * Knoten `textareaRef.current` also schon der neue ist), nicht im
   * Renderkoerper oben: ein Verbrauch dort waere ein Seiteneffekt waehrend
   * des Renderns.
   */
  useLayoutEffect(() => {
    if (consumeComposerFocusPending()) {
      textareaRef.current?.focus()
    }
  }, [conversationId])

  // GH #139: measured on a copy outside the page, and written only when the
  // height really changes, so a key within a line lays out nothing but the
  // field (lib/fit-textarea.ts). Before paint, so a new line and its height
  // show up in the same frame.
  useLayoutEffect(() => {
    if (textareaRef.current) fitTextarea(textareaRef.current, COMPOSER_MAX_PX)
    // conversationId mit in der Abhaengigkeit: `key={conversationId}` unten
    // montiert das Textfeld beim Wechsel neu, der frische Knoten startet aber
    // auf `rows={1}`. Ist der uebernommene Entwurf identisch mit dem der
    // vorigen Unterhaltung (gleicher mehrzeiliger Text), aendert sich `input`
    // nicht, der Effekt liefe ohne diese Zeile also nicht, und die Hoehe
    // bliebe auf einer Zeile stehen statt den Entwurf zu zeigen.
  }, [input, conversationId])

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const all = Array.from(files)
    const imageFiles = all.filter(f => f.type.startsWith('image/'))
    // A non-image file (PDF, Word, text, …) can't ride along as a chat image,
    // it belongs in the Documents panel (RAG) so the model can actually read it.
    // Silently dropping it made a user think their PDF attached when it didn't,
    // and the model then hallucinated that it "couldn't receive attachments"
    // (GH #69). Der Satz ist derselbe geblieben, nur sein Platz nicht mehr der
    // Composer-Kasten, sondern der Kopf des Verlaufs (`ChatNotices`).
    if (imageFiles.length < all.length) {
      useChatNoticeStore.getState().show(
        'attachment-is-not-an-image',
        'The clip attaches images. To ask about a PDF, Word, or text file, add it in the Documents panel.',
        'ruhig',
        CHAT_NOTICE_MS,
      )
    }
    if (imageFiles.length === 0) return
    // Die Zeilen zum Bildanhang stehen oben im Verlauf (`ChatNotices`), nie
    // im Eingabekasten: „NICHTS im Prompt-Fenster", David 21.09.2026.
    const notices = useChatNoticeStore.getState()
    const job = imageJob.current
    if (job.busy) {
      notices.show('image-attach', 'Still preparing the previous images. Add these again in a moment.', 'ruhig', CHAT_NOTICE_MS)
      return
    }
    const slots = MAX_CHAT_IMAGES - images.length
    if (slots <= 0) {
      notices.show('image-attach', 'You can attach up to five images per message.', 'ruhig', CHAT_NOTICE_MS)
      return
    }
    job.busy = true
    const epoch = job.epoch
    const cancelled = () => job.epoch !== epoch || useChatStore.getState().activeConversationId !== conversationId
    setPreparingImages(true)
    notices.show('image-attach', 'Preparing images…')
    try {
      const result = await prepareChatImages(imageFiles, slots, cancelled)
      if (cancelled()) return
      setImages(prev => [...prev, ...result.images].slice(0, MAX_CHAT_IMAGES))
      const message = result.errors[0] ?? (imageFiles.length > slots
        ? 'You can attach up to five images per message. Extra images were not added.'
        : '')
      if (message) notices.show('image-attach', message, 'ruhig', CHAT_NOTICE_MS)
      else notices.dismiss('image-attach')
    } finally {
      job.busy = false
      setPreparingImages(false)
      if (useChatNoticeStore.getState().notices.some(n => n.id === 'image-attach' && n.text === 'Preparing images…')) {
        useChatNoticeStore.getState().dismiss('image-attach')
      }
    }
  }, [images.length, conversationId])

  /**
   * Ein Bild an einem Modell, das keine sieht.
   *
   * Nicht blockierend (Senden geht weiter), und die Zeile geht von selbst
   * wieder weg, sobald der Anhang weg ist oder das Modell sehen kann. Frueher
   * war das eine Bedingung im Renderkoerper des Composers; sie ist ein Effekt
   * geworden, weil ihr Ziel jetzt eine Etage hoeher gezeichnet wird und ein
   * Speicher kein Render sein darf. gthvidsten, GH Discussion #67.
   */
  useEffect(() => {
    const blind = images.length > 0 && !!activeModel && !canSeeImages
    const speicher = useChatNoticeStore.getState()
    if (!blind) {
      speicher.dismiss('model-cannot-see-images')
      return
    }
    speicher.show(
      'model-cannot-see-images',
      "This model can't read images. Switch to a vision model (Gemma 4, LLaVA, Qwen-VL) to use the attachment.",
    )
  }, [images.length, activeModel, canSeeImages])

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index))
  }

  // Write a dictation transcript (interim or final) into the input as
  // base + transcript; the layout effect above sizes the field. NEVER sends,
  // because the user reviews and presses Send (David 2026-06-06).
  const applyDictation = (text: string) => {
    const base = dictationBaseRef.current
    const sep = base && !/\s$/.test(base) ? ' ' : ''
    setInput(base + sep + text)
  }

  // Synchronous double-fire guard (David 2026-06-20: "ok generiere jetzt" landed
  // twice in one chat). The `isGenerating` prop and the cleared input only update
  // on the NEXT render, so two Enter keydowns in the same tick (key-repeat / IME
  // / a held Enter) both pass the checks below and send the identical message
  // twice. A short monotonic lock closes that window.
  const sendLockRef = useRef(0)
  const handleSend = () => {
    const trimmed = input.trim()
    if (imageJob.current.busy || (!trimmed && images.length === 0) || isGenerating || waitingForLocalLane || disabled || sendDisabled) return
    if (!passSendLock(sendLockRef)) return
    onSend(trimmed || '(image)', images.length > 0 ? images : undefined)
    setInput('')
    setImages([])
    setCmdMenu([])
  }

  // Update the input + the slash-command typeahead together. The menu shows
  // what the SURFACE can actually carry out: everything in Agent and Coding,
  // and in plain chat only the commands marked for it (today: /compact).
  // Offering an agent command where there is no tool catalogue would be
  // offering work the surface cannot do.
  const updateInput = (value: string) => {
    setInput(value)
    const matches = slashCommands ? matchAgentCommands(value, slashCommands) : []
    setCmdMenu(matches)
    setCmdIndex(0)
  }

  // Fill the input with the chosen command (trailing space so args can follow)
  // and dismiss the menu. The user then types any args and presses Enter.
  const pickCommand = (cmd: AgentCommand) => {
    setInput(`/${cmd.name} `)
    setCmdMenu([])
    setCmdIndex(0)
    textareaRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Slash-command menu navigation takes precedence while it's open.
    if (cmdMenu.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setCmdIndex((i) => (i + 1) % cmdMenu.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setCmdIndex((i) => (i - 1 + cmdMenu.length) % cmdMenu.length)
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault()
        pickCommand(cmdMenu[cmdIndex])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setCmdMenu([])
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (isVoiceRecording || isTranscribing) return
      handleSend()
    }
  }

  // Paste handler for clipboard images (Ctrl+V screenshots)
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    const imageItems = Array.from(items).filter(item => item.type.startsWith('image/'))
    if (imageItems.length === 0) return
    e.preventDefault()
    const files = imageItems.map(item => item.getAsFile()).filter(Boolean) as File[]
    addFiles(files)
  }, [addFiles])

  // Drag & Drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    if (e.dataTransfer?.files?.length) {
      addFiles(e.dataTransfer.files)
    }
  }, [addFiles])

  return (
    <div className={`px-3 pb-2 pt-1 w-full ${COMPOSER_MAX_W} mx-auto`}>
      {/* David, 19.09.2026, Runde 2 (Nachtrag): ueber dem Eingabefeld steht
          seither GAR KEINE Marke mehr, weder "No credits" noch "No refusals".
          Die Komponente, die sie hier zeigte, ist geloescht, nicht nur
          entkoppelt (siehe flash-hinweis-verschiebt-nichts.test.ts). Das
          Etikett neben dem Agent-Schalter (ChatView.tsx, der Flash-Hinweis)
          und die Modellauswahl selbst (ModelRowMarks in ModelSelector.tsx,
          unveraendert) sind die einzigen Stellen, die diese Aussagen noch
          tragen. */}
      {/* Approval used to live here as a popup over the chat input.
          Per user feedback ("eventuell in den chat einarbeiten") it now
          renders INSIDE the pending tool-call block in MessageList, so
          the approve/reject buttons sit visually attached to the tool
          they belong to. ChatView owns the Enter/Esc keyboard layer. */}

      <div
        className={`relative flex flex-col rounded-lg border transition-colors ${isDragOver
          ? 'bg-blue-500/5 border-blue-500/30'
          : 'bg-gray-50 dark:bg-white/[0.03] border-gray-200 dark:border-white/[0.06] focus-within:border-gray-400 dark:focus-within:border-white/15'}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Slash-command autocomplete, floats above the composer */}
        {cmdMenu.length > 0 && (
          <div className="absolute bottom-full left-0 right-0 mb-1.5 z-50 max-h-64 overflow-y-auto scrollbar-thin rounded-lg lu-elevated py-1">
            <div className="px-2.5 py-1 flex items-center gap-1 text-[0.5rem] uppercase tracking-widest text-gray-400 dark:text-gray-600">
              <Terminal size={9} /> Agent commands
            </div>
            {cmdMenu.map((cmd, i) => (
              <button
                key={cmd.name}
                onMouseDown={(e) => { e.preventDefault(); pickCommand(cmd) }}
                onMouseEnter={() => setCmdIndex(i)}
                className={`w-full text-left px-2.5 py-1 flex items-baseline gap-2 transition-colors ${
                  i === cmdIndex ? 'bg-gray-100 dark:bg-white/[0.07]' : 'hover:bg-gray-50 dark:hover:bg-white/[0.04]'
                }`}
              >
                <span className="text-[0.72rem] font-medium text-gray-800 dark:text-gray-100 shrink-0">/{cmd.name}</span>
                {cmd.argHint && <span className="t-micro text-gray-400 dark:text-gray-500 shrink-0">{cmd.argHint}</span>}
                <span className="t-micro text-gray-500 dark:text-gray-400 truncate ml-auto">{cmd.summary}</span>
              </button>
            ))}
          </div>
        )}

        {/* The standing goal sits above everything else in the composer, so an
            instruction that steers every turn is never invisible. */}
        {composerAbove}

        {/* G31: the run is STOPPED until this is answered, so the answer has to
            be where the user's eyes already are. The inline buttons on the tool
            block are still there and still the nicer place to decide from, but
            the list does not scroll to them, so on R01c (Mac, 2026-08-07) a run
            sat waiting 7 minutes with nothing but a clock icon far below the
            fold. An approval has no timeout by design, which makes being seen
            the only thing that ends it. */}
        {pendingApproval && onApprove && onReject && (
          <ApprovalDialog toolCall={pendingApproval} onApprove={onApprove} onReject={onReject} />
        )}

        {/* Prompt area: hints, image previews, then the textarea (buttons live
            in the action bar below, web-parity two-row composer). */}
        <div className="px-3 pt-2.5">
          {/* HIER STAND BIS ZUM 21.09.2026 EIN STAPEL HINWEISE, und genau
              darum ging es dem Eigner am echten Windows-Bau: „NICHTS im
              prompt fenster!" Drei Zeilen sind ausgezogen, keine ist
              verlorengegangen:

                Wartezeile der lokalen Spur  -> LocalLaneWaitLine, gezeichnet
                  von ChatView/CodexView als Geschwister UEBER diesem Kasten
                Anhang ist kein Bild (GH #69) -> ChatNotices, oben im Verlauf
                Modell sieht keine Bilder      -> ChatNotices, oben im Verlauf

              Was hier bleibt, ist kein Hinweis: die Bildvorschauen sind der
              Anhang selbst, und die Freigabe ist eine Entscheidung mit zwei
              Knoepfen. */}

          {/* Image previews */}
          {images.length > 0 && (
            <div className="flex gap-1.5 mb-1.5 flex-wrap">
              {images.map((img, i) => (
                <div key={i} className="relative group">
                  <img
                    src={`data:${img.mimeType};base64,${img.data}`}
                    alt={img.name}
                    className="w-14 h-14 object-cover rounded-lg border border-white/10"
                  />
                  <button
                    onClick={() => removeImage(i)}
                    className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X size={8} />
                  </button>
                  <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-[0.45rem] text-gray-300 text-center rounded-b-lg truncate px-0.5">
                    {img.name}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* `data-lu-composer`: der stabile Erkennungspunkt DIESES Feldes,
              gelesen von `useKeyboardShortcuts.ts` (Ctrl/Cmd+N aus dem
              Composer heraus setzt die Fokusfahne, aus einem Suchfeld nicht).
              Er hiess bis zum 21.09.2026 `data-lazarus-quiet-focus` und schaltete
              nebenbei den Fokusring ab; beides in einem Attribut war schon
              falsch, als das Attribut an sechs Feldern hing, denn damit
              meldete auch eine Preset-Werkstatt-Textarea „ich bin der
              Composer". Der Fokus ist jetzt eine Regel in index.css, die
              jedes Textfeld der App deckt, und dieses Attribut sagt wieder
              nur das eine, wofuer es gelesen wird.

              `key={conversationId}`: der Gespraechswechsel oben raeumt `input`
              ueber React (den kontrollierten Wert), aber das DOM-Textfeld
              selbst behaelt ohne eigenen Schluessel denselben Knoten, samt
              seiner eigenen Selektion/Cursorposition, ueber den Wechsel
              hinweg. Ein Tastenereignis, das der Browser noch gegen den ALTEN
              Knoten in der Warteschlange hat (eine reale Maus- oder
              CDP-Eingabe, die kurz vor dem Wechsel begann), landet dann an der
              alten Cursorposition MITTEN im gerade abgelegten Entwurf, bevor
              Reacts Leerung ueberhaupt sichtbar wird - genau das Muster aus der
              Box-Messung (BERICHT.md Z2: neuer Text mitten im alten,
              Endstueck haengt hinten dran). Ein neuer Schluessel zwingt einen
              WIRKLICH neuen DOM-Knoten pro Unterhaltung: es gibt dann keinen
              alten Knoten mehr, an dem ein verspaetetes Ereignis noch landen
              koennte. */}
          <textarea
            data-lu-composer
            key={conversationId ?? 'none'}
            ref={textareaRef}
            value={input}
            onChange={(e) => updateInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => setTimeout(() => setCmdMenu([]), 120)}
            onPaste={handlePaste}
            placeholder={disabled ? "Unavailable" : isDragOver ? "Drop images here..." : isTranscribing ? "Transcribing..." : isVoiceRecording ? "Recording..." : "Message..."}
            disabled={disabled}
            rows={1}
            className="lu-fokus-am-kasten w-full bg-transparent resize-none text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none text-[12px] leading-relaxed max-h-[200px] disabled:opacity-50 scrollbar-thin"
          />
        </div>

        {/* Action bar, attach · voice · think · view actions · model · send.
            Same in Chat, Code and Remote; each surface passes its own
            composerActions + composerModel (David 2026-07-11, web parity).

            ONE row, always. It used to be `flex-wrap`, and a run starting was
            enough to break it: the Code mode trigger grows by a dot or a
            "then bypass" label the moment a loop is in flight, the row ran out
            of width and the tail (model picker and the Stop button) dropped
            onto a second line. So the composer was a different height standing
            still than it was working, which is what David saw as "der Stop
            Knopf oeffnet eine weitere Zeile, alles sieht asymmetrisch aus".
            No wrapping, a fixed-height row, and every control shrink-0 with
            only the middle spacer giving way, das `flex: 0 0 auto` steckt
            seit der Composer-Grammatik im Rezept `.lazarus-control` (index.css),
            nicht mehr als `shrink-0` an jedem einzelnen Knopf. */}
        <div className="flex flex-nowrap items-center gap-1 px-2 py-1.5 min-h-[38px] border-t border-gray-200 dark:border-white/[0.05]">
          {/* Clip button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isGenerating || preparingImages}
            className="lazarus-control lazarus-control--icon"
            title="Attach images. For PDFs and documents use the Documents panel"
          >
            <Paperclip size={14} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            className="hidden"
            onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }}
          />

          <VoiceButton
            // Streaming dictation: interim chunks arrive while talking, the final
            // transcript replaces them on stop, both via applyDictation, which
            // writes base + transcript and NEVER sends (user presses Send).
            onInterim={applyDictation}
            onTranscript={applyDictation}
            onRecordingChange={(r) => {
              if (r) dictationBaseRef.current = input
              setIsVoiceRecording(r)
            }}
            disabled={isGenerating}
          />

          {/* Think toggle ('always'-models render it locked on).
              Der Ein-Zustand kommt aus `aria-pressed`, nicht aus einer
              zweiten Klassenkette: das neutrale Rezept liest ihn und setzt
              den Behaelter. Vorher war Ein ein blaues Pill, dieselbe Farbe,
              die auch der Fokusring traegt, also zwei Bedeutungen auf einer
              Farbe (Audit §4, Chat mit Antwort). */}
          <button
            onClick={() => {
              if (canThink) updateSettings({ thinkingEnabled: !thinkingEnabled })
            }}
            disabled={!canThink && !thinkLockedOn}
            aria-pressed={(thinkingEnabled && canThink) || thinkLockedOn}
            className="lazarus-control"
            title={
              thinkLockedOn
                ? 'Thinking is always on for this model'
                : canThink
                  ? (thinkingEnabled ? 'Thinking ON' : 'Thinking OFF')
                  : 'Model does not support thinking'
            }
          >
            <Brain size={11} />
            <span>Think</span>
          </button>

          {/* Reasoning effort. Same shape and size as the Think button beside
              it, because it is the same kind of statement about the same
              model; a second visual language here would read as a second
              subject. Deshalb dasselbe Rezept und keine eigene Klassenkette:
              hier stand dasselbe blaue Pill, das am Think-Knopf nebenan
              abgebaut wurde, weil es die Farbe des Fokusrings zweitverwendet
              (Audit §4, Composer-Grammatik).

              Der Zustand ist die STUFE, und die steht im Knopf und im
              zugaenglichen Namen. Kein `aria-pressed`: vier Stufen sind kein
              Ein/Aus-Zustand, und „gedrueckt" waere fuer „low" so wahr wie
              fuer „max". Sichtbar ist der Knopf ohnehin nur, solange Denken an
              ist, und der Behaelter am Think-Knopf daneben sagt das bereits. */}
          {showEffort && (
            <button
              data-testid="effort-toggle"
              onClick={() => updateSettings({ reasoningEffort: nextEffort(effortLevels, effortNow) })}
              aria-label={`Reasoning effort: ${effortLabel(effortNow)}`}
              className="lazarus-control"
              title={`Reasoning effort: ${effortLabel(effortNow)}. Click to cycle. Higher effort spends more output tokens.`}
            >
              <Gauge size={11} />
              <span>{effortLabel(effortNow)}</span>
            </button>
          )}

          {/* View-specific actions (Plugins · Tools) */}
          <div className="flex flex-nowrap items-center gap-1 shrink-0">{composerActions}</div>

          <div className="flex-1 min-w-0" />

          {/* Sampling controls sit next to the picker: same row, collapsed. */}
          <div className="shrink-0"><SamplingControls /></div>

          {/* Model picker, opens upward from the composer */}
          <div className="shrink-0">{composerModel}</div>

          {/* Send and Stop are the SAME slot: one fixed 26x26 box at the end of
              the row, never two, never one below the other. Stop replaces Send
              in place while a run is in flight, exactly as the Chat surface has
              always done, and because the box is sized rather than padded the
              row height cannot move between the two states. */}
          {/* Send und Stop hatten hier je ein `whileTap` aus framer-motion,
              zwei von den sechs, die der Audit als „6 von 462" zaehlt. Der
              Druck steht jetzt als eine Regel in index.css und laeuft ueber
              die `transition` von `.lazarus-control` weich aus; die beiden
              Knoepfe brauchen framer-motion dafuer nicht mehr. */}
          <div className="shrink-0 w-[var(--control-h-sm)] h-[var(--control-h-sm)]" data-testid="composer-send-slot">
            {isGenerating ? (
              <button
                // Called bare: the click event is not an argument of Stop (GH #140).
                onClick={() => onStop()}
                // Neutral, nicht rot: Stop ist der Normalabschluss und die
                // haeufigste Aktion waehrend eines Streams. `data-active`
                // gibt ihm den Behaelter des neutralen Rezepts, damit er
                // auffindbar bleibt, ohne die Fehlerfarbe zu tragen.
                data-active="true"
                className="lazarus-control lazarus-control--icon w-full h-full"
                aria-label="Stop generation"
              >
                <Square size={13} />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={preparingImages || (!input.trim() && images.length === 0) || isTranscribing || !!waitingForLocalLane || !!sendDisabled}
                title={sendDisabled ? sendDisabledReason : undefined}
                className="lazarus-control lazarus-control--icon lazarus-primary w-full h-full"
                aria-label="Send message"
              >
                <Send size={13} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
