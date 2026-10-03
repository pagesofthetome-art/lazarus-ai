import { useCodex } from '../../hooks/useCodex'
import { useAutoScroll } from '../../hooks/useAutoScroll'
import { useCodexStore } from '../../stores/codexStore'
import { useUIStore } from '../../stores/uiStore'
import { useChatStore } from '../../stores/chatStore'
import { useBackgroundAgentWake } from '../../hooks/useBackgroundAgentWake'
import { useGenerationStore } from '../../stores/generationStore'
import { ChatInput } from './ChatInput'
import { ToolCallBlock } from './ToolCallBlock'
import { ToolCallBand } from './ToolCallBand'
import { groupAgentBlocks } from '../../lib/tool-call-groups'
import { ThinkingBlock } from './ThinkingBlock'
import { MarkdownRenderer } from './MarkdownRenderer'
import { TokenCounter } from './TokenCounter'
import { ContextDropdown } from './ContextDropdown'
import { SmallModelModeToggle } from './SmallModelModeToggle'
import { WorkingAnchor } from './WorkingAnchor'
import { useCodexConfirmStore } from '../../stores/codexConfirmStore'
import { PluginsDropdown } from './PluginsDropdown'
import { CodexModeDropdown } from './CodexModeDropdown'
import { ModelSelector } from '../models/ModelSelector'
import { MONOGRAM, MONOGRAM_INVERT } from '../layout/brand'
import { AVATAR_SLOT } from './avatar-slot'
import { GoalBar } from './GoalBar'
import { ChatNotices } from './ChatNotices'
import { LocalLaneWaitLine } from './LocalLaneWaitLine'
import { LoopBar } from './LoopBar'
import { useSettingsStore } from '../../stores/settingsStore'
import { useModelStore } from '../../stores/modelStore'
import { isLocalModelByName } from '../../api/agents/model-locality'
import { useAnyAgentLoopActive } from '../../stores/agentLoopStore'
import { useDeveloperSandboxStore } from '../../stores/developerSandboxStore'
import { createDeveloperSession } from '../../lib/developer-sandbox'
import { CODEX_WORKDIR_LOCK_TITLE, codexBusyReason } from '../../lib/codex-workdir'
import { StagedChangesPanel } from './StagedChangesPanel'
import { SlashStepsBlock } from './SlashStepsBlock'
import { CompactBlock } from './CompactBlock'
import { compactionAnchors } from '../../lib/compact-summary'
import { User, Code, Eye, GitBranch, Download, RefreshCw, Check, AlertTriangle, PackageCheck, LoaderCircle, Shield, ShieldCheck } from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'
import { backendCall, checkGitInstalled, openExternal, type GitStatus } from '../../api/backend'
import { CodexConfirmDialog } from './CodexConfirmDialog'
import { Hinweis } from '../ui/Hinweis'
import { HINWEIS_TEXT } from '../../lib/hinweis'
import { stripModelNoise } from '../../lib/strip-model-noise'
import { useIsQueuedForLocalLane, useLocalLaneQueuePosition } from '../../lib/run-idle'
import { Modal } from '../ui/Modal'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { useDeveloperVmAccessStore } from '../../stores/developerVmAccessStore'

// Code always drives a tool loop, so the aggressive tier applies here.
const stripChannelTags = (text: string) => stripModelNoise(text, { aggressive: true })

// Typo-Leiter (die-typo-leiter-und-ihre-umgehung.test.ts): the workdir-lock
// banner and the "no folder picked" hint both use the same quiet size and
// tone. That size is deliberately not folded into `.t-micro` (index.css,
// `.t-micro`-Audit: "kein Name unter 10"), so this is a shared literal, not a
// new consolidation. One constant means one occurrence in the source instead
// of two, which is the difference between staying under and going over the
// ratchet's cap.
const QUIET_HINT_TEXT = `text-[0.55rem] ${HINWEIS_TEXT.ruhig}`

// Code-Mode renders EVERY between-tool answer as normal, always-visible prose
// now (David 2026-06-04: "kein Collapse, das soll ganz normal wie eine Antwort
// angezeigt werden"). The render path below dedupes verbatim repeats so a
// chatty small model can't stack the same line. (The old CollapsibleAnswer
// one-line-preview component was removed.)

export function CodexView() {
  const { sendInstruction, stopCodex, isRunning } = useCodex()
  // Derselbe Weckhaken wie im Agentenweg: eine Hintergrundaufgabe endet fast
  // immer NACH dem Zug, der sie startete, und ohne diesen Haken erfuehre das
  // Modell davon erst bei der naechsten Eingabe des Menschen.
  //
  // R2-18: `sendInstruction` nimmt (text, opts), der Haken ruft aber
  // (text, images, opts). Das Objekt mit `hiddenUser: true` landete damit auf
  // Position 3 und fiel weg, also stand die Weckzeile als sichtbare
  // Nutzernachricht im Verlauf, als haette der Mensch sie getippt. Ein Adapter
  // schiebt sie auf die Stelle, an der sie gelesen wird.
  useBackgroundAgentWake(
    useChatStore((s) => s.activeConversationId),
    (text, _images, opts) => sendInstruction(text, opts),
  )
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const developerMode = useUIStore((s) => s.currentView === 'developer')
  const sandboxSession = useDeveloperSandboxStore((s) => s.session)
  const sandboxStatus = sandboxSession?.status
  const sandboxPreviewUrl = useDeveloperSandboxStore((s) => s.previewUrl)
  const setSandboxPreviewUrl = useDeveloperSandboxStore((s) => s.setPreviewUrl)
  const resetSandbox = useDeveloperSandboxStore((s) => s.reset)
  const setSandboxStatus = useDeveloperSandboxStore((s) => s.setStatus)
  const conversations = useChatStore((s) => s.conversations)
  const thread = useCodexStore((s) => activeConversationId ? s.threads[activeConversationId] : undefined)

  const conversation = conversations.find(c => c.id === activeConversationId)
  const messages = conversation?.messages || []

  // Verdichtungslinien fuer den Code-Verlauf. Codex blendet nur `hidden` aus
  // (Systemhinweise bleiben stehen), aber die Rechnung laeuft trotzdem ueber
  // die volle Liste, denn der Schnittpunkt darf auf eine ausgeblendete zeigen.
  const compactAt = compactionAnchors(
    messages,
    messages.filter((m) => !m.hidden).map((m) => m.id),
    conversation?.compactions,
  )

  // Per-conversation generating flag (David 2026-06-12): the typing indicator
  // + realtime counter + a message's live-stream state must follow the coding
  // chat that's ACTUALLY running, not every chat the user switches to. The
  // hook's `isRunning` is global (kept for the input, which guards shared stream
  // refs); the visual bits below read this conversation-scoped flag instead.
  const generatingMap = useGenerationStore((s) => s.generating)
  const codexGenerating = !!activeConversationId && !!generatingMap[activeConversationId]
  const pendingConfirm = useCodexConfirmStore((s) => s.pending)
  // Runde 4 (review-lanes.md Blocker 1+6): THIS conversation's own send
  // queued behind another local run. Not part of `generatingMap` (no stream
  // is flowing yet), so it needs its own read. Nachbesserung 9 (Runde 3) had
  // added a cross-conversation lock here via `composerBusy` (parity with
  // ChatView.tsx, closing the one path Blocker 1's Reichweite point noted as
  // reachable: Chat<->Code); that lock is gone as of this round, the same as
  // in ChatView.tsx, now that a local second send queues visibly instead of
  // racing the first one and a cloud second send just runs alongside it.
  const queuedForLocalLane = useIsQueuedForLocalLane(activeConversationId)
  const localLaneQueuePosition = useLocalLaneQueuePosition(activeConversationId)

  // G8-3 (David): "sobald er fertig gedacht hat, hakt das so komisch ab und
  // zoomt irgendwo ganz anders hin." The hand-rolled pin here only fired on
  // [messages, events] changes, so the height SWAP when a thinking round ends
  // (live bubble cleared above, ThinkingBlock added below, preview collapses)
  // landed between triggers and left the view parked mid-transcript. Same
  // mechanism as G33 on the chat list, same cure: the shared useAutoScroll
  // hook re-pins through a ResizeObserver on EVERY content-height change,
  // growth and collapse alike, while the user is following. Scrolling up to
  // read stays possible (same <100px disengage), and sending an instruction
  // re-engages via the last user message id.
  const lastMessage = messages[messages.length - 1]
  const lastUserMessage = messages.filter((m) => m.role === 'user').at(-1)
  const { ref: scrollRef, contentRef } = useAutoScroll(
    `${lastMessage?.content ?? ''}|${thread?.events?.length ?? 0}`,
    lastUserMessage?.id,
  )

  const codexReviewMode = useSettingsStore((s) => s.settings.codexReviewMode)
  const userAvatarDataUrl = useSettingsStore((s) => s.settings.userAvatarDataUrl)
  const activeModel = useModelStore((s) => s.activeModel)
  const createConversation = useChatStore((s) => s.createConversation)
  const setActiveConversation = useChatStore((s) => s.setActiveConversation)
  const developerModelUnavailable = developerMode && (!activeModel || !isLocalModelByName(activeModel))
  const codexWorkingDir = useCodexStore((s) => s.workingDirectory)
  const setSandboxSession = useDeveloperSandboxStore((s) => s.setSession)
  const [developerEntryOpen, setDeveloperEntryOpen] = useState(false)
  const [developerActionError, setDeveloperActionError] = useState('')
  const [developerPublishFailed, setDeveloperPublishFailed] = useState(false)
  const chooseDeveloperWorkspace = async () => {
    if (!isTauri()) return
    try {
      const picked = await invoke<string | null>('pick_folder', { defaultPath: codexWorkingDir || null, asWorkspace: true })
      if (picked) useCodexStore.getState().setWorkingDirectory(picked)
    } catch (error) { setDeveloperActionError(String(error)) }
  }
  const startSandboxPreview = async () => {
    if (!isTauri()) {
      setDeveloperActionError('Starting Developer Mode requires the Lazarus desktop app. This web preview cannot create a native sandbox.')
      setDeveloperEntryOpen(false)
      return
    }
    if (!codexWorkingDir || (sandboxSession && sandboxStatus !== 'failed')) return
    setDeveloperActionError('')
    setDeveloperPublishFailed(false)
    setDeveloperEntryOpen(false)
    if (sandboxSession) resetSandbox()
    setSandboxSession(createDeveloperSession(`${codexWorkingDir}\\.lazarus-sandbox`, 'starting', codexWorkingDir))
    try {
      const backupRoot = `${codexWorkingDir}\\.lazarus-backups`
      await invoke('developer_sandbox_backup', { workspaceRoot: codexWorkingDir, backupRoot })
      const latest = await invoke<string>('developer_sandbox_latest_backup', { backupRoot })
      const sandboxRoot = await invoke<string>('developer_sandbox_boot', {
        backupZip: latest,
        sandboxRoot: `${codexWorkingDir}\\.lazarus-sandbox`,
      })
      await backendCall('stop_bundled_engine')
      const previewUrl = await invoke<string>('developer_preview_start', { workspaceRoot: sandboxRoot })
      setSandboxPreviewUrl(previewUrl)
      setSandboxSession({ ...createDeveloperSession(sandboxRoot, latest, codexWorkingDir), status: 'ready' })
      useCodexStore.getState().setWorkingDirectory(sandboxRoot)
    } catch (error) {
      setDeveloperActionError(String(error))
      setSandboxStatus('failed')
    }
  }
  const applySandbox = async () => {
    if (!sandboxSession) return
    setSandboxStatus('applying')
    try {
      await invoke('developer_preview_stop')
      await invoke('developer_sandbox_publish', { sandboxRoot: sandboxSession.workspaceRoot, workspaceRoot: sandboxSession.sourceWorkspaceRoot })
    } catch (error) { setDeveloperActionError(String(error)); setDeveloperPublishFailed(true); setSandboxStatus('failed') }
  }
  const discardSandbox = async () => {
    if (!sandboxSession) return
    setSandboxStatus('discarding')
    try {
      await invoke('developer_preview_stop')
      await invoke('developer_sandbox_discard', { sandboxRoot: sandboxSession.workspaceRoot })
      if (sandboxSession.sourceWorkspaceRoot) useCodexStore.getState().setWorkingDirectory(sandboxSession.sourceWorkspaceRoot)
      useUIStore.getState().setView('chat')
    } catch (error) { setDeveloperActionError(String(error)) } finally { resetSandbox() }
  }
  // A8 (2.6.8): the same Remove sits in the explorer column, but that column
  // can be collapsed, and two users looked for a way out of their folder and
  // found none. The header always shows the folder, so it also carries the way
  // to give it back. Locked, not hidden, while a coding turn is in flight, and
  // the verdict is the shared one so the two buttons cannot drift apart.
  // Beide Karten, aus demselben Grund wie im Explorer: ein Faden, der auf
  // 'running' stehengeblieben ist, sperrt den Ordner nicht mehr allein.
  const sendsInFlight = useCodexStore((s) => s.sendsInFlight)
  const threads = useCodexStore((s) => s.threads)
  // The working directory is GLOBAL across every Codex conversation (A8): a
  // loop in ANY of them must still keep the folder locked, not only the
  // active one's.
  const loop = useAnyAgentLoopActive()
  const lockReason = codexBusyReason({ sendsInFlight, threads, generating: generatingMap, loop })

  // Git availability for the Codex view (v2.5.0). Codex shells out to git for
  // git_status/diff/commit/log; if git is missing those tools fail. Probe on
  // open and surface a minimal install banner when it's not on PATH.
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null)
  const [androidBuildOpen, setAndroidBuildOpen] = useState(false)
  const [androidBuildRunning, setAndroidBuildRunning] = useState(false)
  const [androidBuildOutput, setAndroidBuildOutput] = useState('')
  const [androidBuildError, setAndroidBuildError] = useState('')
  const vmAccessToken = useDeveloperVmAccessStore((s) => activeConversationId ? s.tokensByConversation[activeConversationId] : undefined)
  const grantVmAccessInStore = useDeveloperVmAccessStore((s) => s.grant)
  const revokeVmAccessInStore = useDeveloperVmAccessStore((s) => s.revoke)
  const [vmAccessConfirmOpen, setVmAccessConfirmOpen] = useState(false)
  const [vmAccessBusy, setVmAccessBusy] = useState(false)
  const [vmAccessError, setVmAccessError] = useState('')
  // Starts as `true` because the probe below starts with the component: the
  // effect used to flip it on synchronously, which is a cascading render for a
  // value that was already knowable at mount (React 19 `set-state-in-effect`).
  const [gitChecking, setGitChecking] = useState(true)
  useEffect(() => {
    let cancelled = false
    checkGitInstalled()
      .then((s) => { if (!cancelled) setGitStatus(s) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setGitChecking(false) })
    return () => { cancelled = true }
  }, [])
  const recheckGit = () => {
    setGitChecking(true)
    checkGitInstalled().then(setGitStatus).catch(() => {}).finally(() => setGitChecking(false))
  }

  const buildAndroidUpdate = async () => {
    if (!codexWorkingDir || androidBuildRunning) return
    setAndroidBuildRunning(true)
    setAndroidBuildOutput('')
    setAndroidBuildError('')
    try {
      const output = await invoke<string>('developer_build_android', { workspaceRoot: codexWorkingDir })
      setAndroidBuildOutput(output || 'The APK update was built and published.')
    } catch (error) {
      setAndroidBuildError(String(error))
    } finally {
      setAndroidBuildRunning(false)
    }
  }

  // If no folder has been selected yet, keep the button useful: hand the
  // coding agent an explicit build request so it can use the approved VM
  // workspace or locate an existing APK project before starting the build.
  const handleBuildApkClick = () => {
    if (androidBuildRunning) return
    if (!codexWorkingDir) {
      void sendInstruction('Build the Lazarus Android APK. Use the approved VM workspace files in the Lazarus project; if an existing APK project or current APK is available, use it as the starting point. Inspect the project, resolve build issues, and report the generated APK path.')
      return
    }
    setAndroidBuildOutput('')
    setAndroidBuildError('')
    setAndroidBuildOpen(true)
  }

  const grantVmAccess = async () => {
    if (!activeConversationId || developerModelUnavailable || vmAccessBusy) return
    setVmAccessBusy(true)
    setVmAccessError('')
    try {
      const token = await invoke<string>('developer_vm_access_grant', { conversationId: activeConversationId })
      grantVmAccessInStore(activeConversationId, token)
      setVmAccessConfirmOpen(false)
    } catch (error) {
      setVmAccessError(String(error))
    } finally {
      setVmAccessBusy(false)
    }
  }

  const revokeVmAccess = (conversationId: string, token?: string) => {
    if (!token) return
    if (conversationId === activeConversationId && codexGenerating) stopCodex()
    revokeVmAccessInStore(conversationId, token)
    void invoke<boolean>('developer_vm_access_revoke', { conversationId, accessToken: token })
      .then((revoked) => {
        if (!revoked) setVmAccessError('The native access lease did not confirm revocation. Close Lazarus to clear it completely.')
      })
      .catch((error) => setVmAccessError(`Could not confirm revocation: ${String(error)}. Close Lazarus to clear the lease.`))
  }

  // New coding session (David 2026-06-04: "start neu" must really start new).
  // Abort any in-flight loop, then create a fresh codex conversation. The
  // working directory persists in codexStore, so the new session keeps the
  // folder; a brand-new conversation means a brand-new thread on next send.
  const startNewSession = () => {
    stopCodex()
    if (activeConversationId) revokeVmAccess(activeConversationId, vmAccessToken)
    if (activeModel) createConversation(activeModel, '', 'codex')
    else if (developerMode) setActiveConversation(null)
  }

  return (
    // Derselbe leckende Vorfahre wie in ChatView.tsx (flashchip Runde 5,
    // e111f8f6..d18d05a8): overflow-hidden clippt visuell, verhindert aber
    // kein programmatisches Scrollen. Ein Klick auf ModelSelector,
    // CodexModeDropdown oder PluginsDropdown, deren Ausloeser teilweise
    // ausserhalb der Zeile liegt, holt den Browser das fokussierte Element
    // per scrollLeft auf GENAU DIESEM Vorfahren "in Sicht" und verschiebt den
    // ganzen Code-Reiter seitlich, dauerhaft. overflow-clip clippt genauso,
    // laesst aber kein programmatisches Scrollen zu. Kein Nachkomme in dieser
    // Datei haengt scrollTop, scrollTo oder scrollIntoView an dieses Element
    // (grep gegen src/components/chat/CodexView.tsx bestaetigt das).
    // min-h-0 gehoert zwingend dazu (Issue 138): overflow-hidden machte dieses
    // Element zum Bildlaufbehaelter, und darin ist die automatische
    // Mindesthoehe eines Flex-Kindes 0. overflow-clip ist KEIN
    // Bildlaufbehaelter, also faellt min-height auf die Inhaltshoehe zurueck,
    // der Rahmen waechst mit dem Verlauf ueber das Fenster hinaus und schiebt
    // den Composer hinaus. ChatView.tsx Zeile 300 traegt dasselbe min-h-0.
    <>
    <div className="flex-1 flex overflow-clip min-h-0">
      {/* Main panel. min-h-0 aus demselben Grund wie am Rahmen darueber
          (Issue 138, ChatView.tsx Zeile 300): sonst erzwingt der Verlauf in
          dieser Spalte seine volle Inhaltshoehe und der Composer darunter
          landet unter dem Fensterrand. */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 relative">
        {/* Codex header */}
        <div
          data-testid="codex-header"
          className="relative flex items-center gap-1.5 px-2 py-1 border-b border-purple-400/20 bg-white/[0.02] dark:bg-white/[0.02] shadow-[0_0_22px_rgba(168,85,247,0.16)]"
        >
          <Code size={9} className="text-gray-500" />
          <span className="text-[0.55rem] text-gray-600 dark:text-gray-400 font-medium">
            {developerMode ? 'Developer Studio' : 'Coding Agent'}
          </span>
          {developerMode && sandboxStatus && (
            <span className="rounded border border-violet-400/25 px-1.5 py-0.5 text-[0.5rem] text-violet-300" aria-label={`Developer sandbox ${sandboxStatus}`}>
              Sandbox {sandboxStatus}
            </span>
          )}
          {/* Code-Review Mode badge (B13), makes it impossible to miss
              that the agent is read-only. The toggle itself lives in
              Settings → Codex Agent; clicking the badge jumps you there
              isn't worth a routing change in v2.5.0.
              Das Abzeichen stand in Gelb und las sich damit wie eine Stoerung,
              obwohl es das Gegenteil meldet: der Agent kann nichts anfassen.
              Gruen sagt "diese Zusicherung gilt". Es ist keine Ampel, sondern
              ein Zustandschip, deshalb behaelt es seine Form und wechselt nur
              den Farbton. Im Kopf daneben ist Gruen frei: der Modellumschalter
              nimmt Violett, alles andere ist grau. */}
          {codexReviewMode && (
            <span
              className="flex items-center gap-1 px-1.5 py-0 rounded border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-[0.55rem] bg-emerald-500/[0.04]"
              title="Code-Review Mode is active. The coding agent will inspect the codebase but won't write files or run commands. Disable in Settings → Coding Agent."
            >
              <Eye size={9} />
              <span>Review</span>
            </span>
          )}
          {/* Working directory indicator, so the user always sees WHERE the
              agent operates (David 2026-06-04: "ich hab den Ordner angegeben …
              er ist eigentlich in Dokumenten"). Empty = per-chat sandbox under
              ~/agent-workspace, which is also where shell output now lands. */}
          <div className="flex-1" />
          {developerMode && (
            <button
              onClick={() => {
                if (vmAccessToken && activeConversationId) revokeVmAccess(activeConversationId, vmAccessToken)
                else { setVmAccessError(''); setVmAccessConfirmOpen(true) }
              }}
              disabled={!activeConversationId || (!vmAccessToken && developerModelUnavailable) || vmAccessBusy}
              data-testid="developer-vm-access"
              aria-label={vmAccessToken ? 'VM access is enabled for this Developer task' : 'VM access is off; click to approve access for this Developer task'}
              title={developerModelUnavailable
                ? 'Choose a model running on this PC before granting machine-wide access.'
                : vmAccessToken
                  ? 'Revoke full VM access for this Developer task'
                  : 'Allow this local Developer task to access files across this PC'}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[0.55rem] transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${vmAccessToken
                ? 'text-amber-600 dark:text-amber-300 bg-amber-500/10 hover:bg-amber-500/15'
                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5'}`}
            >
              {vmAccessToken ? <ShieldCheck size={10} /> : <Shield size={10} />}
              <span>{vmAccessToken ? 'VM access on' : 'VM access off'}</span>
            </button>
          )}
          {/* EIN Kontextelement (D-S06): der Fuellstand ist die Beschriftung
              des Fensterwaehlers, nicht dieselbe Zahl ein zweites Mal daneben. */}
          <ContextDropdown><TokenCounter /></ContextDropdown>
          <SmallModelModeToggle />
        </div>

        {developerMode && (
          <div className="flex items-center gap-2 border-b border-violet-400/20 bg-violet-500/[0.04] px-3 py-2" data-testid="developer-mode-actions">
            <button
              onClick={() => sandboxSession?.status === 'ready' || (sandboxSession && developerPublishFailed) ? void applySandbox() : sandboxSession ? void startSandboxPreview() : setDeveloperEntryOpen(true)}
              disabled={!!sandboxSession && sandboxStatus !== 'ready' && sandboxStatus !== 'failed'}
              className="flex items-center h-[var(--control-h-md)] px-2 rounded-md text-[0.68rem] font-medium transition-colors bg-white dark:bg-white/[0.08] text-gray-900 dark:text-white disabled:opacity-50"
            >{sandboxSession?.status === 'ready' || (sandboxSession && developerPublishFailed) ? 'Apply changes' : sandboxSession ? sandboxStatus === 'failed' ? 'Retry Developer Mode' : sandboxStatus === 'applying' ? 'Building and relaunching…' : 'Starting Developer Mode…' : 'Start Developer Mode'}</button>
            <button
              onClick={() => void discardSandbox()}
              disabled={!sandboxSession || (sandboxStatus !== 'ready' && sandboxStatus !== 'failed')}
              className="ml-auto rounded-md border border-red-400/40 px-4 py-2 text-xs font-medium text-red-300 hover:bg-red-500/10 disabled:opacity-40"
            >End Developer Mode</button>
          </div>
        )}

        {/* R2-21: der Sperrgrund hing bisher nur als `title` am Entfernen-Knopf,
            und ein `disabled` Knopf nimmt keine Mauszeiger-Ereignisse an, also
            ist der Hinweis nie erschienen (derselbe Fehler wie im ExplorerPanel,
            dort mit `explorer-workdir-lock` behoben). Ruhiger Ton, keine
            Warnfarbe: gesperrt ist ein Zustand, der von selbst endet. */}
        {lockReason && (
          <p
            data-testid="codex-workdir-lock"
            className={`px-3 py-1 ${QUIET_HINT_TEXT} border-b border-gray-200 dark:border-white/[0.04]`}
          >
            {CODEX_WORKDIR_LOCK_TITLE[lockReason]}
          </p>
        )}

        {developerMode && vmAccessError && !vmAccessConfirmOpen && (
          <p className="px-3 py-1 t-micro text-red-700 dark:text-red-300 border-b border-red-500/20" role="alert">
            {vmAccessError}
          </p>
        )}
        {developerMode && developerActionError && (
          <p role="status" className="px-3 py-1 t-micro text-amber-700 dark:text-amber-200 border-b border-amber-500/20">{developerActionError}</p>
        )}

        {/* Git-missing banner (v2.5.0). Codex shells out to git for
            status/diff/commit/log, and without it those tools fail. Minimal,
            dismiss-by-installing: an Install button (opens the platform git
            download page) + a Recheck button for after the install.
            Ton `fehler`: ohne git fallen echte Werkzeuge aus, und es gibt genau
            eine Handlung dagegen, die gleich daneben steht. Die gelbe Fuellung
            und der gelbe Rahmen sind weg, die Linie unten ist die Trennung zum
            Verlauf und dieselbe wie am Kopf darueber, kein Rahmen um den Satz
            (`lib/hinweis.ts`). */}
        {gitStatus && !gitStatus.installed && (
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-200 dark:border-white/[0.04]">
            <Hinweis ton="fehler" icon={<GitBranch size={12} className="shrink-0 mt-0.5" />} className="flex-1">
              Git isn't installed. The coding agent needs it for diffs, commits and history.
            </Hinweis>
            <button
              onClick={() => openExternal(gitStatus.download_url)}
              className="flex items-center gap-1 px-2 py-0.5 rounded t-micro font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
            >
              <Download size={11} /> Install Git
            </button>
            <button
              onClick={recheckGit}
              disabled={gitChecking}
              title="Re-check after installing Git"
              className="flex items-center gap-1 px-1.5 py-0.5 rounded t-micro text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={11} className={gitChecking ? 'animate-spin' : ''} />
            </button>
          </div>
        )}

        {/* Stage-and-Approve queue (B10). Renders nothing when there
            are no pending changes for the active chat, so non-stage-mode
            users never see it. */}
        <StagedChangesPanel chatId={activeConversationId} />

        {/* Messages */}
        <div ref={scrollRef} className="relative flex-1 min-h-[10rem] overflow-y-auto scrollbar-thin" data-testid="codex-transcript">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Code size={28} className="text-gray-300 dark:text-gray-700 mb-2" />
              <p className="text-[0.7rem] text-gray-500 font-medium">
                {developerMode ? 'Developer Studio' : 'Coding Agent'}
              </p>
              <p className="text-[0.55rem] text-gray-400 dark:text-gray-600 mt-0.5 max-w-[300px]">
                Describe what you want Lazarus to do.
              </p>
            </div>
          ) : (
            <div ref={contentRef} className="py-1">
              {messages.filter(msg => !msg.hidden).map((msg) => {
                // Der Rumpf hat mehrere Ausgaenge (Hinweiszeile, Werkzeugblock,
                // normale Blase). Statt jeden einzeln anzufassen, wandert er
                // unveraendert in eine IIFE, seine `return`s werden ihre. Die
                // Verdichtungslinie haengt danach EINMAL an, fuer alle Ausgaenge
                // gleich. Der Alternativentwurf, jeden Ausgang zu umhuellen,
                // waere dieselbe Zeile an fuenf Stellen gewesen, und die
                // sechste, die jemand spaeter dazuschreibt, haette gefehlt.
                const gerendert = (() => {
                // App notices (a staged change that landed on disk) are not
                // model turns. They used to be written hidden, so the one line
                // that says "the file on disk is not the diff you approved"
                // reached nobody, and an assistant bubble would be the other
                // wrong answer: it would claim the model said it.
                // Die beiden Faelle unterscheiden sich im TON, nicht in der
                // Bauform: die Datei auf der Platte weicht vom genehmigten Diff
                // ab, da muss jemand hinsehen (rot), oder sie ist genau der
                // genehmigte Diff (ruhig). Vorher hatten beide einen Kasten,
                // der gelbe darin sah aus wie ein Absturz (`lib/hinweis.ts`).
                if (msg.role === 'system' && msg.notice) {
                  const warn = msg.notice === 'warn'
                  return (
                    <div key={msg.id} className="px-3 py-1" data-testid="codex-notice">
                      <Hinweis
                        ton={warn ? 'fehler' : 'ruhig'}
                        icon={warn
                          ? <AlertTriangle size={10} className="mt-0.5 shrink-0" />
                          : <Check size={10} className="mt-0.5 shrink-0" />}
                      >
                        <span className="break-words">{msg.content}</span>
                      </Hinweis>
                    </div>
                  )
                }
                // Slash commands: the user typed "/review", but msg.content holds
                // the expanded instruction the model ran on, show displayContent.
                const rawForDisplay = msg.role === 'user' ? (msg.displayContent || msg.content) : msg.content
                const cleanContent = rawForDisplay ? stripChannelTags(rawForDisplay) : ''
                return (
                  <div
                    key={msg.id}
                    className={`flex gap-2 px-3 py-1 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
                  >
                    {/* Derselbe Chip wie im Chat (avatar-slot.ts). Hier stand
                        die dritte Fassung: 20px, ohne Rahmen, Monogramm nackt. */}
                    <div className={AVATAR_SLOT}>
                      {msg.role === 'user'
                        ? (userAvatarDataUrl
                            ? <img src={userAvatarDataUrl} alt="" className="w-full h-full object-cover" />
                            : <User size={11} className="text-gray-400" />)
                        : <img src={MONOGRAM} alt="" className={`w-[70%] h-[70%] object-contain opacity-80 ${MONOGRAM_INVERT}`} />
                      }
                    </div>
                    <div className="max-w-[85%] space-y-0.5">
                      {/* Thinking */}
                      {msg.role === 'assistant' && msg.thinking && (
                        <ThinkingBlock
                          thinking={msg.thinking}
                          streaming={codexGenerating && msg.id === messages[messages.length - 1]?.id && !cleanContent.trim()}
                        />
                      )}
                      {(() => {
                        const running = codexGenerating && msg.id === messages[messages.length - 1]?.id
                        const hasBlocks = !!(msg.role === 'assistant' && msg.agentBlocks && msg.agentBlocks.length > 0)
                        const stepCount = msg.agentBlocks?.filter((b) => b.phase === 'tool_call' && b.toolCall).length ?? 0
                        const hasAnswerBlock = !!(msg.agentBlocks && msg.agentBlocks.some((b) => b.phase === 'answer' && b.content.trim()))

                        // Reflection blocks (Architect plan, RepoMap context) ,
                        // shown above the tool calls so the user sees what context
                        // primed the editor model before it started fetching tools.
                        const reflection = hasBlocks ? (
                          <div className="space-y-1">
                            {msg.agentBlocks!
                              .filter((b) => b.phase === 'reflection' && b.content)
                              .map((block) => (
                                <div
                                  key={block.id}
                                  className="px-2 py-1.5 rounded border border-gray-200 dark:border-white/10 bg-gray-50/60 dark:bg-white/[0.02] text-[0.7rem] text-gray-700 dark:text-gray-300"
                                >
                                  <MarkdownRenderer content={stripModelNoise(block.content)} />
                                </div>
                              ))}
                          </div>
                        ) : null

                        // Interleaved tool_call + answer blocks (Codex 2026-05) so
                        // commentary sits BETWEEN tool calls, else the legacy
                        // tool-only split. Identical logic to before, just hoisted
                        // into a value so a slash run can wrap it in the window.
                        const transcript = !hasBlocks
                          ? null
                          : hasAnswerBlock
                            ? (() => {
                                // Interleave strictly by timestamp: tool → answer →
                                // tool → tool → answer … in the real order produced
                                // (provider/LLM-agnostic, David 2026-06-02 r2). Drop
                                // answer blocks that strip to empty.
                                const ordered = [...msg.agentBlocks!]
                                  .filter(
                                    (b) =>
                                      (b.phase === 'tool_call' && b.toolCall) ||
                                      (b.phase === 'answer' && stripChannelTags(b.content)) ||
                                      // G21-2: per-round thoughts, chronological
                                      (b.phase === 'thinking' && b.content.trim()),
                                  )
                                  .sort((a, b) => a.timestamp - b.timestamp)
                                // Render EVERY answer normally + visible
                                // (David 2026-06-04: "kein Collapse, ganz
                                // normal wie eine Antwort"). Skip only a
                                // verbatim repeat of the previous answer.
                                const skippedAnswers = new Set<string>()
                                let lastAnswer = ''
                                for (const b of ordered) {
                                  if (b.phase !== 'answer') continue
                                  const a = stripChannelTags(b.content)
                                  if (!a) continue
                                  if (a === lastAnswer) skippedAnswers.add(b.id)
                                  else lastAnswer = a
                                }
                                return (
                                  <div className="space-y-1">
                                    {groupAgentBlocks(ordered).map((group) => {
                                      // Consecutive tool calls render as ONE
                                      // band that morphs from tool to tool and
                                      // collapses to "N steps" when done
                                      // (David 2026-07-31).
                                      if (group.kind === 'tools') {
                                        return (
                                          <ToolCallBand
                                            key={group.blocks[0].id}
                                            calls={group.calls}
                                            notes={group.notes}
                                            renderNote={(block) => {
                                              if (block.phase === 'thinking') {
                                                return <ThinkingBlock thinking={block.content} />
                                              }
                                              const note = stripChannelTags(block.content)
                                              if (!note) return null
                                              return (
                                                <div className="px-1 py-0.5 text-[0.7rem] leading-relaxed text-gray-500 dark:text-gray-400">
                                                  <MarkdownRenderer content={note} />
                                                </div>
                                              )
                                            }}
                                          />
                                        )
                                      }
                                      const block = group.block
                                      if (block.phase === 'thinking') {
                                        // Trailing thought before the final
                                        // answer, in its collapsed G14-7 bubble.
                                        return <ThinkingBlock key={block.id} thinking={block.content} />
                                      }
                                      if (block.phase === 'answer') {
                                        const answer = stripChannelTags(block.content)
                                        if (!answer || skippedAnswers.has(block.id)) return null
                                        return (
                                          <div key={block.id} className="px-1 py-0.5">
                                            <div className="text-[12px] leading-relaxed">
                                              <MarkdownRenderer content={answer} />
                                            </div>
                                          </div>
                                        )
                                      }
                                      return null
                                    })}
                                  </div>
                                )
                              })()
                            : (
                                <div className="space-y-0">
                                  {(() => {
                                    const calls = msg.agentBlocks!
                                      .filter((b) => b.phase === 'tool_call' && b.toolCall)
                                      .map((b) => b.toolCall!)
                                    return calls.length > 0 ? <ToolCallBand calls={calls} /> : null
                                  })()}
                                </div>
                              )

                        // Text content, user bubble always; assistant only when
                        // there are no per-iteration answer blocks (interleave
                        // already rendered those). Assistant drops the bubble to
                        // match the regular Chat view; user keeps the right anchor.
                        const textContent = cleanContent && (msg.role === 'user' || !hasAnswerBlock) ? (
                          <div className={
                            msg.role === 'user'
                              ? 'rounded-lg px-2.5 py-1.5 bg-gray-100 dark:bg-white/[0.06] border border-gray-200 dark:border-white/[0.08]'
                              : 'px-1 py-0.5'
                          }>
                            <div className="text-[12px] leading-relaxed">
                              {msg.role === 'user' ? (
                                <p className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{cleanContent}</p>
                              ) : (
                                <MarkdownRenderer content={cleanContent} />
                              )}
                            </div>
                          </div>
                        ) : null

                        // Slash command (David 2026-06-12): the STEPS (tool calls +
                        // intermediate commentary) go in the collapsible window;
                        // the FINAL answer renders OUTSIDE it, normal + readable ,
                        // "die finale antwort soll nicht im tool call sein, nur die
                        // letzte". Same block shape for Ollama + LM Studio, so this
                        // is backend-agnostic. The final answer = the last 'answer'
                        // block, or msg.content when the model never emitted one.
                        if (msg.role === 'assistant' && msg.slashCommand) {
                          const blocks = msg.agentBlocks || []
                          const answerBlocks = blocks
                            .filter((b) => b.phase === 'answer' && stripChannelTags(b.content))
                            .sort((a, b) => a.timestamp - b.timestamp)
                          const finalAnswerBlock = answerBlocks[answerBlocks.length - 1]
                          const finalAnswerText = finalAnswerBlock
                            ? stripChannelTags(finalAnswerBlock.content)
                            : (!hasAnswerBlock && cleanContent ? cleanContent : '')
                          // Steps = tool calls + every answer EXCEPT the final one.
                          const stepsOrdered = [...blocks]
                            .filter(
                              (b) =>
                                (b.phase === 'tool_call' && b.toolCall) ||
                                (b.phase === 'answer' &&
                                  stripChannelTags(b.content) &&
                                  b.id !== finalAnswerBlock?.id),
                            )
                            .sort((a, b) => a.timestamp - b.timestamp)
                          return (
                            <>
                              {(stepCount > 0 || running) && (
                                <SlashStepsBlock command={msg.slashCommand} stepCount={stepCount} running={running}>
                                  <div className="space-y-1">
                                    {reflection}
                                    <div className="space-y-1">
                                      {stepsOrdered.map((block, idx) => {
                                        if (block.phase === 'tool_call' && block.toolCall) {
                                          return <ToolCallBlock key={block.id} toolCall={block.toolCall} />
                                        }
                                        const answer = stripChannelTags(block.content)
                                        if (!answer) return null
                                        const prev = stepsOrdered
                                          .slice(0, idx)
                                          .reverse()
                                          .find((b) => b.phase === 'answer' && stripChannelTags(b.content))
                                        if (prev && stripChannelTags(prev.content) === answer) return null
                                        return (
                                          <div key={block.id} className="px-1 py-0.5">
                                            <div className="text-[12px] leading-relaxed">
                                              <MarkdownRenderer content={answer} />
                                            </div>
                                          </div>
                                        )
                                      })}
                                    </div>
                                  </div>
                                </SlashStepsBlock>
                              )}
                              {finalAnswerText && (
                                <div className="px-1 py-0.5">
                                  <div className="text-[12px] leading-relaxed">
                                    <MarkdownRenderer content={finalAnswerText} />
                                  </div>
                                </div>
                              )}
                            </>
                          )
                        }

                        return (
                          <>
                            {reflection}
                            {transcript}
                            {textContent}
                          </>
                        )
                      })()}
                    </div>
                  </div>
                )
                })()
                const linien = compactAt.get(msg.id)
                if (!linien?.length) return gerendert
                return (
                  <Fragment key={msg.id}>
                    {gerendert}
                    {linien.map((record) => (
                      <CompactBlock key={record.id} record={record} />
                    ))}
                  </Fragment>
                )
              })}
              {/* 3-dot indicator while THIS coding chat is mid-loop. Bound to
                  the per-conversation flag so switching to another (idle) chat
                  doesn't show its dots. David 2026-06-12 ("die drei ladepunkte
                  kommen in vorherigen chats auch"). */}
              {/* Shell/code approval, inline in the stream so it reads as the
                  next step of the run instead of covering it (David 2026-07-24:
                  "ich hätte das gerne im chat, wie ein tool call"). Renders
                  nothing while no request is pending. */}
              <CodexConfirmDialog />
              {/* G14-6: one anchor with shimmer + clock, no dots, no floating
                  counter. It also names an approval wait for what it is, so a
                  blocked run never looks like a working one (G15b). */}
              <WorkingAnchor
                isRunning={codexGenerating}
                label={pendingConfirm ? 'Waiting for your approval' : undefined}
              />
            </div>
          )}
          {developerMode && sandboxPreviewUrl && sandboxSession?.status === 'ready' && (
            <div className="absolute inset-0 z-10 flex flex-col bg-black" data-testid="developer-sandbox-preview">
              <div className="flex h-7 shrink-0 items-center border-b border-violet-400/30 bg-[#120b1d] px-3 text-[0.65rem] text-violet-200">Live sandbox preview</div>
              <iframe title="Developer sandbox preview" src={sandboxPreviewUrl} className="min-h-0 flex-1 border-0 bg-black" />
            </div>
          )}
        </div>

        {/* Die stehenden Sitzungsbaender und die Zeilen, die frueher IM
            Composer standen (David, 21.09.2026: „NICHTS im prompt fenster!").
            LoopBar und GoalBar sind Bedienelemente und bleiben sichtbar, nur
            als Geschwister UEBER dem Kasten statt darin; die Wartezeile und
            die Composer-Hinweise sind Hinweise und stehen jetzt hier. Die
            Zeile ueber das MODELL ist in den Modellwaehler gezogen. */}
        <ChatNotices />
        <LoopBar onStop={stopCodex} />
        <GoalBar />
        <LocalLaneWaitLine waiting={!!queuedForLocalLane} queuePosition={localLaneQueuePosition} />

        {/* Input */}
        <ChatInput
          onSend={(content) => sendInstruction(content)}
          onStop={stopCodex}
          // Store flag, not the hook's local isRunning (audit A2): the view
          // remounts on every tab switch and a fresh hook says "idle" while
          // the old instance's loop is still running, which offered a second
          // parallel send and no Stop button. The generating flag follows the
          // conversation, not the hook instance.
          isGenerating={isRunning || codexGenerating || queuedForLocalLane}
          waitingForLocalLane={queuedForLocalLane}
          sendDisabled={developerModelUnavailable}
          sendDisabledReason=""
          slashCommands="agent"
          composerModel={<ModelSelector openUpward surface="code" />}
          // Ask / Bypass / Plan sits here, in the CODE composer only (plan
          // C1). ChatInput stays surface-neutral, so the Chat tab inherits
          // nothing from it. Plugins used to ride along here and now lives in
          // the header next to New, so this row carries ONE view-specific
          // control and stays a single quiet line in both states.
          composerActions={(
            <div className="flex items-center gap-1">
              <button onClick={startNewSession} title="New coding session" className="px-1.5 py-1 rounded text-[0.55rem] text-gray-500 hover:text-gray-200">New</button>
              {!developerMode && <>
                <button onClick={() => sendInstruction('Build the Windows EXE from the current project and report any errors.')} title="Build the Windows EXE" className="px-1.5 py-1 rounded text-[0.55rem] text-purple-300 shadow-[0_0_14px_rgba(168,85,247,0.3)]">Build EXE</button>
                <button onClick={handleBuildApkClick} disabled={androidBuildRunning} title="Build the Android APK from the current project" className="px-1.5 py-1 rounded text-[0.55rem] text-purple-300 shadow-[0_0_14px_rgba(168,85,247,0.3)] disabled:opacity-40">Build APK</button>
                <button onClick={() => sendInstruction('Run the project checks and tests, then summarize any failures.')} title="Run project tests" className="px-1.5 py-1 rounded text-[0.55rem] text-purple-300 shadow-[0_0_14px_rgba(168,85,247,0.3)]">Test</button>
              </>}
              <PluginsDropdown iconOnly openUpward />
              <CodexModeDropdown openUpward />
            </div>
          )}
        />
      </div>

    </div>
    <Modal open={developerEntryOpen} onClose={() => setDeveloperEntryOpen(false)} title="Enter Developer Mode?">
      <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
        <p>Lazarus will save a snapshot of the current source project, create an isolated working copy, and show its preview inside this window. Your published files stay unchanged until you apply.</p>
        {!isTauri() && <p className="rounded border border-amber-500/30 p-2 text-xs text-amber-700 dark:text-amber-200">Starting the native sandbox requires the Lazarus desktop app.</p>}
        {developerActionError && <p role="alert" className="break-words text-xs text-red-600 dark:text-red-300">{developerActionError}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={() => setDeveloperEntryOpen(false)} className="rounded px-3 py-2 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10">Cancel</button>
          {!codexWorkingDir && isTauri() && <button onClick={() => void chooseDeveloperWorkspace()} className="rounded border border-violet-400/40 px-3 py-2 text-xs text-violet-200">Choose Lazarus source folder</button>}
          <button onClick={() => void startSandboxPreview()} disabled={!isTauri() || !codexWorkingDir} className="rounded bg-violet-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">Start Developer Mode</button>
        </div>
      </div>
    </Modal>
    <Modal
      open={vmAccessConfirmOpen}
      onClose={() => { if (!vmAccessBusy) setVmAccessConfirmOpen(false) }}
      title="Allow full PC access for this task?"
      maxWidth="max-w-xl"
    >
      <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
        <p>The local model in this Developer conversation will be able to read, create, edit, move, and delete files anywhere your Windows account can access, and run commands without asking you each time.</p>
        <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">This is broad access. It lasts until you turn it off, start a new Developer session, or close Lazarus. It does not make Lazarus an administrator; Windows can still block protected files or ask for UAC credentials.</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">On Android, file access is handled through Android’s system picker and permissions. The APK cannot silently grant itself administrator access.</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">File edits in Ask mode remain in the existing review queue. Commands may change or remove files directly.</p>
        {vmAccessError && <p role="alert" className="break-words rounded-lg border border-red-500/20 bg-red-500/5 p-2 text-xs text-red-700 dark:text-red-300">{vmAccessError}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={() => setVmAccessConfirmOpen(false)}
            disabled={vmAccessBusy}
            className="rounded-lg px-3 py-2 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10 disabled:opacity-50"
          >Cancel</button>
          <button
            onClick={grantVmAccess}
            disabled={vmAccessBusy || !activeConversationId || developerModelUnavailable}
            className="flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-xs font-medium text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {vmAccessBusy ? <LoaderCircle size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
            {vmAccessBusy ? 'Enabling…' : 'Allow for this task'}
          </button>
        </div>
      </div>
    </Modal>
    <Modal
      open={androidBuildOpen}
      onClose={() => { if (!androidBuildRunning) setAndroidBuildOpen(false) }}
      title="Build Android update"
      maxWidth="max-w-xl"
    >
      <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
        <p>This uses the selected project folder to build a new Lazarus APK, increase its version, and publish the APK with an update notice.</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">It runs the project’s <code>build_and_publish_android.ps1</code> script and Gradle build. The phone will still ask you before Android installs the update.</p>
        <p className="break-all rounded-lg border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-black/20 px-3 py-2 font-mono text-xs">{codexWorkingDir || 'No project folder selected'}</p>
        {androidBuildRunning && (
          <div className="flex items-center gap-2 text-xs text-violet-600 dark:text-violet-300" role="status">
            <LoaderCircle size={14} className="animate-spin" />
            <span>Building APK. This can take several minutes.</span>
          </div>
        )}
        {androidBuildError && (
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-700 dark:text-red-300">{androidBuildError}</pre>
        )}
        {androidBuildOutput && (
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-300">{androidBuildOutput}</pre>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={() => setAndroidBuildOpen(false)}
            disabled={androidBuildRunning}
            className="rounded-lg px-3 py-2 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10 disabled:opacity-50"
          >
            {androidBuildOutput || androidBuildError ? 'Close' : 'Cancel'}
          </button>
          {!androidBuildOutput && (
            <button
              onClick={buildAndroidUpdate}
              disabled={!codexWorkingDir || androidBuildRunning}
              className="flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-xs font-medium text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {androidBuildRunning ? <LoaderCircle size={13} className="animate-spin" /> : <PackageCheck size={13} />}
              {androidBuildRunning ? 'Building…' : 'Build and publish update'}
            </button>
          )}
        </div>
      </div>
    </Modal>
    </>
  )
}
