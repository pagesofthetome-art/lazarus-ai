/**
 * How often, and how patiently, the app may try to bring the built-in engine
 * back up on its own after a start failed.
 *
 * GH #118: the boot resume was one shot and swallowed its failure without a
 * word, so an engine that lost a race at login (antivirus scanning a fresh
 * install, graphics driver still settling) stayed dead until the user re-picked
 * the model by hand. The other direction is just as bad: a model this box
 * genuinely cannot load must not turn into an endless restart loop that keeps
 * the machine busy forever. So the policy is bounded and lives in one place.
 */

// ── Wer den Schuss haelt (Fund 1 der Kampagne 3.0.0, T3 auf der Box) ────────
//
// Der Wiederanlauf ist EIN Schuss je Anlass und nicht einer je Sitzung. Anlass
// eins ist der Start der App: die llama-server-Kinder sterben mit ihr, und die
// gespeicherte Wahl zeigt danach auf einen toten Port. Anlass zwei ist der
// Rueckweg aus der Cloud, und der fehlte. Der Weg IN die Cloud haelt Motor und
// Einbettung an (AppShell, `offload_local_models`), der Weg zurueck brachte nur
// die Einbettung wieder, weil deren Wiederanlauf keinen Schuss verbraucht.
// Gemessen am 11.09.2026 auf der Box: `the Lazarus Engine was stopped port=8127` um
// 16:41:34, die Einbettung auf 8128 von selbst zurueck um 16:47:27, der
// Chatmotor blieb bis 17:58:59 zu, ohne einen Hinweis irgendwo.
//
// Der Schuss liegt deshalb hier und nicht mehr als Modulzustand im Hook: die
// Stelle, die ihn faellig macht, ist der Cloud-Schalter, und die Stelle, die
// ihn verbraucht, ist die Modelliste. Beide erreichen dieses Modul, ohne
// einander zu kennen.
let wiederanlaufOffen = true

/** Steht ein Wiederanlauf der eigenen Engine noch aus. */
export function engineResumeIsOwed(): boolean {
  return wiederanlaufOffen
}

/** Verbraucht. Eine Antwort verbraucht den Schuss genau einmal, auch eine
 *  Absage: dann gibt es keine Liste, aus der wiederbelebt werden koennte. */
export function spendEngineResume(): void {
  wiederanlaufOffen = false
}

/** Wieder faellig, weil die App den Motor gerade selbst angehalten hat. */
export function oweEngineResume(): void {
  wiederanlaufOffen = true
}

/** Total start attempts, the first one included. */
export const RESUME_ATTEMPTS = 3

/** How long to wait after attempt 1, and after attempt 2. */
export const RESUME_BACKOFF_MS = [1500, 5000]

/**
 * Milliseconds to wait before the attempt that follows `attempt` (0-based), or
 * null when the budget is spent and the app has to stop trying.
 */
export function resumeBackoffMs(attempt: number): number | null {
  if (!Number.isInteger(attempt) || attempt < 0) return null
  if (attempt >= RESUME_ATTEMPTS - 1) return null
  return RESUME_BACKOFF_MS[attempt] ?? RESUME_BACKOFF_MS[RESUME_BACKOFF_MS.length - 1]
}

/** What one resume run ended as. */
export type ResumeOutcome =
  /** The engine was already up. */
  | 'already-running'
  /** There was nothing to resume (no active model, or another backend). */
  | 'not-eligible'
  /** An activation was issued. */
  | 'started'
  /** Every attempt failed, or a failure that no retry repairs came back. */
  | 'gave-up'

export interface ResumeDeps {
  /** Ask the app whether its own engine is up. */
  status: () => Promise<{ running?: boolean } | null | undefined>
  /** Is there a built-in model to resume at all. */
  eligible: () => boolean
  /** Start the engine on the active model. */
  activate: () => Promise<unknown>
  /** True when a failed start is worth another attempt. */
  worthRetrying: (err: unknown) => boolean
  sleep: (ms: number) => Promise<void>
  onError?: (attempt: number, err: unknown) => void
}

/**
 * The bounded resume loop itself, with its four dependencies handed in, so the
 * decisions can be asserted without a React tree, a Tauri backend or a real
 * wait (review S7). `useModels` supplies the real ones.
 */
export async function runEngineResume(deps: ResumeDeps): Promise<{
  outcome: ResumeOutcome
  attempts: number
  sleptMs: number[]
}> {
  const sleptMs: number[] = []
  for (let attempt = 0; attempt < RESUME_ATTEMPTS; attempt++) {
    try {
      const status = await deps.status()
      if (status?.running) return { outcome: 'already-running', attempts: attempt + 1, sleptMs }
      if (!deps.eligible()) return { outcome: 'not-eligible', attempts: attempt + 1, sleptMs }
      // Whatever it answers, one activation per pass is all there is to do: a
      // refusal means the GGUF is gone from the disk, and no retry conjures it.
      await deps.activate()
      return { outcome: 'started', attempts: attempt + 1, sleptMs }
    } catch (err) {
      deps.onError?.(attempt + 1, err)
      if (!deps.worthRetrying(err)) return { outcome: 'gave-up', attempts: attempt + 1, sleptMs }
      const delay = resumeBackoffMs(attempt)
      if (delay === null) return { outcome: 'gave-up', attempts: attempt + 1, sleptMs }
      sleptMs.push(delay)
      await deps.sleep(delay)
    }
  }
  return { outcome: 'gave-up', attempts: RESUME_ATTEMPTS, sleptMs }
}
