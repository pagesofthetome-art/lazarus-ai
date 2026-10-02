import { X } from 'lucide-react'
import { useBackgroundShutdownStore } from '../../stores/backgroundShutdownStore'
import { HINWEIS_TEXT, HINWEIS_ZEILE } from '../../lib/hinweis'

/**
 * B1 Runde 2, Punkt 1 und 4. The one visible line for what
 * `lib/background-shutdown.ts` did without the user watching, see that
 * module's doc comment for the two triggers.
 *
 * Same quiet-row form as StaleModelsBanner: nothing crashed, so no filled
 * warning colour, `role="status"` so a screen reader is not interrupted.
 */
export function BackgroundShutdownBanner() {
  const { notice, dismiss } = useBackgroundShutdownStore()

  if (!notice) return null

  const text = notice.kind === 'offline'
    ? 'Connection lost. Running work is waiting or will retry once you are back online.'
    : 'Closing the window stopped background agent work so nothing kept running unseen. Send a new message to continue.'

  return (
    <div role="status" className={`${HINWEIS_ZEILE} ${HINWEIS_TEXT.ruhig} px-3 py-1`}>
      <span className="flex-1 min-w-0 self-center">{text}</span>
      <button
        onClick={dismiss}
        className="self-center shrink-0 rounded p-[1px] opacity-70 hover:opacity-100 transition-opacity"
        aria-label="Dismiss"
        title="Dismiss"
      >
        <X size={11} />
      </button>
    </div>
  )
}
