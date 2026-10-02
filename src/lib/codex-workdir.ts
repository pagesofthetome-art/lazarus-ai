/**
 * When the Coding Agent's working directory may be changed, and what the empty
 * state is allowed to promise.
 *
 * "Is a run in flight" used to be a different expression on every surface,
 * which is how A8 (2.6.8) got as far as it did. It is a pure function here,
 * with the tests next to it.
 *
 * WO der Agent arbeitet, steht NICHT hier, sondern in
 * `hooks/codex/workspace-precedence.ts`, wo `useCodex` es auch liest. Bis 3.0.0
 * lag daneben eine zweite Rechnung derselben Rangfolge, die kein Aufrufer je
 * gelesen hat, waehrend sechs Tests sie massen und damit die ausgelieferte
 * Rechnung gruen aussehen liessen, ohne sie anzufassen (R2-42).
 */
import { isActiveCodexStatus, type CodexThreadStatus } from '../types/codex'

/**
 * What the agent falls back to when the picker is empty, in the words the user
 * needs. The empty state used to promise "~/agent-workspace" flat out, which is
 * a lie for anybody who set a default workspace in Settings or pinned a folder
 * on this chat: those win over an empty picker (see the precedence above).
 */
export function codexFallbackLabel(workspacePath: string | null | undefined): string {
  return workspacePath || '~/agent-workspace'
}

/**
 * Why the working directory is held right now, or null when it is free.
 *
 * 'run'  a coding turn is in flight, from the moment the send starts.
 * 'loop' a /loop is standing between two passes: the thread says idle, the
 *        next pass is on a timer, and moving the folder under it would send
 *        that pass somewhere else without anybody watching.
 */
export type CodexBusyReason = 'run' | 'loop'

export interface CodexBusyInput {
  /**
   * Sends that have started and not yet finished. Counted synchronously at the
   * top of sendInstruction: the thread status only flips to 'running' after
   * five awaits (workspace slug, tool support, token budget, memory, rules),
   * and the whole gap was unlocked before.
   */
  sendsInFlight: number
  /** codexStore.threads, for a turn that is past those awaits. */
  threads: Record<string, { status: CodexThreadStatus }>
  /**
   * generationStore.generating, as the PROOF that a thread's status is about a
   * run that is still alive. See below.
   */
  generating: Record<string, boolean>
  /** agentLoopStore.loop, or null when no /loop is standing. */
  loop: unknown | null
}

/**
 * Only Coding Agent signals count. The first cut read every conversation's
 * generating flag, so a streaming Chat tab in another conversation locked the
 * folder picker on Code for no reason at all.
 *
 * ── WARUM DIE FAHNE DAZUGEHOERT ──────────────────────────────────────────
 * Ein Faden bleibt auf 'running' stehen, bis der Lauf sich abgewickelt hat.
 * `stopCodex` raeumt die Erzeugungsfahne SOFORT (`abortConversation`), der
 * Status kommt erst im `finally` des Laufs zurueck auf 'idle', und ein
 * Shell-Befehl, der das Signal nicht beachtet, dehnt dieses Fenster beliebig
 * weit. Solange es offen stand, waren beide Ordnerknoepfe tot, und der Grund
 * hing als `title` an einem `disabled` Knopf, der keine Mauszeiger-Ereignisse
 * annimmt, also nie erschienen ist. Fuer den Nutzer war der Ordner damit ohne
 * Vorwarnung und ohne Ausweg gesperrt.
 *
 * Der Status allein ist also kein Beweis, dass etwas laeuft, und genau das ist
 * der Fehler, gegen den `lib/run-idle.ts` fuer die ganze App geschrieben
 * wurde: zwei Quellen, und keine von beiden ist fuer sich die Wahrheit. Hier
 * ist es dieselbe Versoehnung, nur pro Gespraech und ohne Speicherzugriff, weil
 * diese Funktion rein bleibt und ihre Aufrufer beide Karten ohnehin
 * abonnieren.
 *
 * `isActiveCodexStatus` statt `=== 'running'`: die Wartefreigabe und das
 * Schreiben der abgelegten Aenderungen sind genauso laufende Arbeit, und der
 * Vergleich von Hand war der stille `else`, den AS-08 beschreibt.
 *
 * Gesperrt bleibt damit genau ein Lauf, der wirklich noch laeuft. Der Weg
 * heraus ist der Stopp-Knopf, den der Lauf ohnehin hat: er raeumt die Fahne,
 * und der Ordner ist im selben Augenblick wieder frei.
 */
export function codexBusyReason({ sendsInFlight, threads, generating, loop }: CodexBusyInput): CodexBusyReason | null {
  if (sendsInFlight > 0) return 'run'
  const alive = Object.entries(threads).some(
    ([convId, t]) => isActiveCodexStatus(t.status) && generating[convId] === true,
  )
  if (alive) return 'run'
  if (loop) return 'loop'
  return null
}

/**
 * One sentence per reason, so the two buttons cannot drift apart. Both name a
 * way out: a disabled button cannot be waited out blindly, and a run whose
 * tail hangs would otherwise hold the folder for the rest of the session.
 */
export const CODEX_WORKDIR_LOCK_TITLE: Record<CodexBusyReason, string> = {
  run: 'A coding run is in flight. Wait for it to finish or press Stop, then you can change the folder.',
  loop: 'A loop is still running. Stop it first, then you can change the folder.',
}
