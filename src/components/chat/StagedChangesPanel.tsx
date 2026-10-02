import { useState } from 'react'
import { Check, X, ChevronDown, ChevronRight, FileText, RotateCcw, Eye, EyeOff } from 'lucide-react'
import { useStagedChangesStore, type StagedChange } from '../../stores/stagedChangesStore'
import { applyStagedChange, undoAppliedChange } from '../../lib/staged-apply'
import type { AppliedChangeBackup } from '../../types/staged-changes'
import { DiffView } from './DiffView'
import { StagedHtmlPreview } from './StagedHtmlPreview'
import { log } from '../../lib/logger'
import { HINWEIS_TEXT, HINWEIS_ZEILE } from '../../lib/hinweis'

interface Props {
  /** Active conversation id — the panel scopes itself to this chat. */
  chatId: string | null
}

/**
 * Right-sidebar panel that surfaces Codex's queued `file_write` calls when
 * Stage-and-Approve is on. Each change shows its diff and offers per-row
 * Apply/Reject; the footer offers Apply-all/Reject-all for big refactors.
 *
 * Apply rereads and reconciles the file, stores its previous contents, then
 * writes through the trusted filesystem bridge. Recent applies can be undone
 * while the file still matches the version that was applied.
 */
// Module-scoped stable empty-array reference. Zustand selectors run on
// every store update; returning a fresh `[]` literal (or any new object)
// trips Object.is and re-renders forever. Reusing one frozen empty array
// keeps the selector output identity-stable when this chat has no
// staged changes yet.
const EMPTY_CHANGES: readonly StagedChange[] = Object.freeze([])
const EMPTY_BACKUPS: readonly AppliedChangeBackup[] = Object.freeze([])

export function StagedChangesPanel({ chatId }: Props) {
  const changes = useStagedChangesStore((s) =>
    chatId ? s.byChat[chatId] ?? EMPTY_CHANGES : EMPTY_CHANGES,
  ) as StagedChange[]
  const applied = useStagedChangesStore((s) =>
    chatId ? s.appliedByChat[chatId] ?? EMPTY_BACKUPS : EMPTY_BACKUPS,
  ) as AppliedChangeBackup[]
  const remove = useStagedChangesStore((s) => s.remove)
  const clear = useStagedChangesStore((s) => s.clear)
  const [expanded, setExpanded] = useState(true)
  const [appliedExpanded, setAppliedExpanded] = useState(false)
  const [applying, setApplying] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [undoing, setUndoing] = useState<Set<string>>(new Set())
  const [undoErrors, setUndoErrors] = useState<Record<string, string>>({})
  const [previewing, setPreviewing] = useState<Set<string>>(new Set())

  if (!chatId || (changes.length === 0 && applied.length === 0)) return null

  async function applyOne(change: StagedChange) {
    if (!chatId) return
    setApplying((prev) => new Set(prev).add(change.id))
    setErrors((prev) => {
      if (!(change.id in prev)) return prev
      const { [change.id]: _gone, ...rest } = prev
      return rest
    })
    try {
      // Shared trusted write path (lib/staged-apply) — the same call Codex
      // auto-apply uses, so the reviewed diff and the auto-applied diff can
      // never diverge.
      await applyStagedChange(chatId, change)
    } catch (e) {
      // Apply failures leave the entry in the queue so the user can retry — and
      // the reason has to reach the row, not just the log. The row simply
      // staying put looked like a dead button (and now that a stale-file apply
      // is REFUSED, the reason is the whole point).
      log.error('[StagedChangesPanel] apply failed', { err: e })
      const message = e instanceof Error ? e.message : String(e)
      setErrors((prev) => ({ ...prev, [change.id]: message }))
    } finally {
      setApplying((prev) => {
        const next = new Set(prev)
        next.delete(change.id)
        return next
      })
    }
  }

  async function applyAll() {
    if (!chatId) return
    for (const change of [...changes]) {
      // Sequential on purpose, not an oversight: two changes can touch the same
      // file, and `applyOne` reads-modifies-writes. In parallel the later write
      // would be based on a snapshot taken before the earlier one landed.
      // (Hier stand eine Unterdrueckung der Regel `no-await-in-loop`. Die ist
      //  in KEINER Config dieses Baums eingeschaltet — die Zeile hat nie etwas
      //  unterdrueckt, sie hat nur behauptet, es gaebe ein Gate. Der Grund war
      //  richtig, die Form war eine Luege; der Grund bleibt.)
      await applyOne(change)
    }
  }

  function rejectOne(change: StagedChange) {
    if (!chatId) return
    remove(chatId, change.id)
  }

  function rejectAll() {
    if (!chatId) return
    clear(chatId)
  }

  async function undoOne(backup: AppliedChangeBackup) {
    if (!chatId || backup.previousContent === null) return
    setUndoing((previous) => new Set(previous).add(backup.id))
    setUndoErrors((previous) => {
      if (!(backup.id in previous)) return previous
      const { [backup.id]: _gone, ...rest } = previous
      return rest
    })
    try {
      await undoAppliedChange(chatId, backup)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setUndoErrors((previous) => ({ ...previous, [backup.id]: message }))
    } finally {
      setUndoing((previous) => {
        const next = new Set(previous)
        next.delete(backup.id)
        return next
      })
    }
  }

  return (
    // Die Kopfzeile war komplett in Gelb getaucht, Flaeche, Symbole und
    // Schrift. Wartende Aenderungen sind aber kein Zwischenfall, sondern eine
    // Liste, die auf einen Klick wartet: sie traegt jetzt dieselbe neutrale
    // Haut wie die uebrigen Abschnitte der Spalte, und die Zahl daneben ist
    // das Signal (`lib/hinweis.ts`).
    <div className="shrink-0 border-b border-gray-200 dark:border-white/[0.04]" data-testid="staged-changes-panel">
      {changes.length > 0 && <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-2 py-1.5 group hover:bg-gray-100/70 dark:hover:bg-white/[0.04] transition-colors"
        data-testid="staged-changes-header"
      >
        <span className="flex items-center gap-1.5">
          {expanded ? (
            <ChevronDown size={11} className="text-gray-500 dark:text-gray-400" />
          ) : (
            <ChevronRight size={11} className="text-gray-500 dark:text-gray-400" />
          )}
          <FileText size={10} className="text-gray-500 dark:text-gray-400" />
          <span className="t-micro font-semibold text-gray-800 dark:text-gray-200">
            Pending ({changes.length})
          </span>
        </span>
      </button>}

      {/* The list scrolls inside a cap of the column. Without the cap two
          staged files with long diffs took the whole column and the
          transcript below shrank to zero height, so the shell approval
          card that followed sat behind the composer with no way to reach
          it (t10 on the box, 2026-09-06: run parked on "Waiting for your
          approval" for 15 minutes). */}
      {expanded && changes.length > 0 && (
        <div className="px-1.5 pb-2 space-y-1.5 max-h-[40vh] overflow-y-auto scrollbar-thin" data-testid="staged-changes-list">
          {changes.map((change) => {
            const isApplying = applying.has(change.id)
            const extension = change.path.split('.').pop()?.toLowerCase()
            const hasVisualPreview = (extension === 'html' || extension === 'htm' || extension === 'svg') && Boolean(change.newContent)
            const isPreviewing = previewing.has(change.id)
            return (
              <div
                key={change.id}
                className="rounded border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-black/20"
                data-testid="staged-change"
              >
                <div className="flex items-center justify-between gap-1 px-1.5 py-1 border-b border-gray-100 dark:border-white/[0.04]">
                  <span
                    className="text-[0.55rem] font-mono truncate text-gray-700 dark:text-gray-300"
                    title={change.path}
                  >
                    {change.path}
                  </span>
                  <span className="flex items-center gap-0.5 shrink-0">
                    {hasVisualPreview && (
                      <button
                        onClick={() => setPreviewing((previous) => {
                          const next = new Set(previous)
                          if (next.has(change.id)) next.delete(change.id)
                          else next.add(change.id)
                          return next
                        })}
                        title={isPreviewing ? 'Hide preview' : 'Preview staged file'}
                        aria-label={isPreviewing ? 'Hide staged preview' : 'Preview staged file'}
                        aria-expanded={isPreviewing}
                        className="p-0.5 rounded hover:bg-blue-100 dark:hover:bg-blue-500/20 text-blue-600 dark:text-blue-400"
                      >
                        {isPreviewing ? <EyeOff size={10} /> : <Eye size={10} />}
                      </button>
                    )}
                    <button
                      onClick={() => applyOne(change)}
                      disabled={isApplying}
                      title="Apply"
                      className="p-0.5 rounded hover:bg-emerald-100 dark:hover:bg-emerald-500/20 text-emerald-600 disabled:opacity-50"
                    >
                      <Check size={10} />
                    </button>
                    <button
                      onClick={() => rejectOne(change)}
                      disabled={isApplying}
                      title="Reject"
                      className="p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-500/20 text-red-500 disabled:opacity-50"
                    >
                      <X size={10} />
                    </button>
                  </span>
                </div>
                {errors[change.id] && (
                  // Eine Zeile Rot, keine rote Flaeche: der Grund muss lesbar
                  // sein, nicht laut. Die Farbe traegt die Dringlichkeit.
                  // Die Zeile baut sich hier selbst, statt <Hinweis> zu nehmen,
                  // weil sie ihre Testmarke behaelt und ins Kaestchen der
                  // Aenderung eingerueckt sitzt; die Klassen kommen trotzdem
                  // aus der einen Regel.
                  <div
                    role="alert"
                    className={`px-1.5 py-1 ${HINWEIS_ZEILE} ${HINWEIS_TEXT.fehler}`}
                    data-testid="staged-change-error"
                  >
                    {errors[change.id]}
                  </div>
                )}
                {change.diff && (
                  <div className="text-[0.5rem]">
                    <DiffView diff={change.diff} maxLines={40} />
                  </div>
                )}
                {isPreviewing && hasVisualPreview && (
                  <StagedHtmlPreview path={change.path} content={change.newContent} />
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Apply all and Reject all sit OUTSIDE the scroll cap. Inside it they
          scrolled away with the diffs: with two long files the footer sat
          under the fold of the list and a click without scrolling hit
          nothing (t14 on the box, 2026-09-06). */}
      {expanded && changes.length > 0 && (
        <div className="px-1.5 pb-2">
          <div className="flex items-center gap-1 pt-0.5">
            <button
              onClick={applyAll}
              className="flex-1 px-1.5 py-1 rounded-md text-[0.55rem] font-medium bg-emerald-500 hover:bg-emerald-600 text-white transition-colors"
              data-testid="apply-all"
            >
              Apply all
            </button>
            <button
              onClick={rejectAll}
              className="flex-1 px-1.5 py-1 rounded-md text-[0.55rem] font-medium bg-gray-200 dark:bg-white/10 hover:bg-gray-300 dark:hover:bg-white/15 text-gray-800 dark:text-gray-200 transition-colors"
              data-testid="reject-all"
            >
              Reject all
            </button>
          </div>
        </div>
      )}

      {applied.length > 0 && (
        <div className="border-t border-gray-200 dark:border-white/[0.04]">
          <button
            onClick={() => setAppliedExpanded((value) => !value)}
            className="w-full flex items-center justify-between px-2 py-1.5 group hover:bg-gray-100/70 dark:hover:bg-white/[0.04] transition-colors"
            data-testid="applied-changes-header"
          >
            <span className="flex items-center gap-1.5">
              {appliedExpanded ? (
                <ChevronDown size={11} className="text-gray-500 dark:text-gray-400" />
              ) : (
                <ChevronRight size={11} className="text-gray-500 dark:text-gray-400" />
              )}
              <RotateCcw size={10} className="text-gray-500 dark:text-gray-400" />
              <span className="t-micro font-semibold text-gray-800 dark:text-gray-200">
                Recent applies ({applied.length})
              </span>
            </span>
          </button>
          {appliedExpanded && (
            <div className="px-1.5 pb-2 space-y-1.5 max-h-[30vh] overflow-y-auto scrollbar-thin">
              <p className="px-1 text-[0.5rem] text-gray-500 dark:text-gray-400">
                Undo works only while the file still matches the applied version.
              </p>
              {[...applied].reverse().map((backup) => {
                const isUndoing = undoing.has(backup.id)
                return (
                  <div
                    key={backup.id}
                    className="rounded border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-black/20"
                    data-testid="applied-change"
                  >
                    <div className="flex items-center justify-between gap-1 px-1.5 py-1">
                      <span
                        className="text-[0.55rem] font-mono truncate text-gray-700 dark:text-gray-300"
                        title={backup.path}
                      >
                        {backup.path}
                      </span>
                      {backup.previousContent === null ? (
                        <span className="text-[0.48rem] text-gray-500 shrink-0">new file</span>
                      ) : (
                        <button
                          onClick={() => undoOne(backup)}
                          disabled={isUndoing}
                          title="Restore the version from before Apply"
                          className="flex items-center gap-1 px-1 py-0.5 rounded text-[0.5rem] text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10 disabled:opacity-50 shrink-0"
                        >
                          <RotateCcw size={9} /> {isUndoing ? 'Restoring…' : 'Undo'}
                        </button>
                      )}
                    </div>
                    {undoErrors[backup.id] && (
                      <div role="alert" className={`px-1.5 py-1 ${HINWEIS_ZEILE} ${HINWEIS_TEXT.fehler}`}>
                        {undoErrors[backup.id]}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
