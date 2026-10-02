/**
 * „Warum passiert gerade nichts": die Wartezeile der lokalen Spur.
 *
 * Die eingebaute Engine bedient EINEN Steckplatz, ein zweites lokales Senden
 * stellt sich also an, statt zu scheitern oder stumm zu haengen. Dieser Satz
 * sagt das, und er verschwindet in dem Augenblick, in dem der Lauf anfaengt.
 *
 * Er stand bis zum 21.09.2026 im Composer-Kasten (`ChatInput.tsx`), also
 * genau dort, wo nach der Regel des Eigners nichts stehen darf („NICHTS im
 * prompt fenster!"). Gezeichnet wird er jetzt von den beiden Ansichten, die
 * die Zahlen ohnehin ausrechnen und weiterreichen, als Geschwister UEBER dem
 * Kasten, auf dessen Breite. Inhaltlich unveraendert, Wort fuer Wort.
 */
import { Hinweis } from '../ui/Hinweis'
import { COMPOSER_MAX_W } from './composer-width'

interface Props {
  /** Dieses Gespraech hat gesendet, der Lauf ist angenommen und wartet. */
  waiting: boolean
  /** Platz in der Warteschlange, 1 = als naechstes. */
  queuePosition?: number | null
  /** Der Halter vor uns rechnet nicht, er wartet auf eine Freigabe. */
  onApproval?: boolean
  /** Titel des Halters, fuer den benannten Satz. */
  onApprovalIn?: string
}

/** Der Satz allein, ohne Zeichnung: so laesst er sich nachlesen und pruefen. */
export function localLaneWaitText(
  queuePosition?: number | null,
  onApproval?: boolean,
  onApprovalIn?: string,
): string {
  const head = onApproval
    ? onApprovalIn
      ? `Waiting: "${onApprovalIn}" is holding the local model while it waits for your approval.`
      : 'Waiting: another conversation is holding the local model while it waits for your approval.'
    : 'Waiting for the local model to finish another answer.'
  if (!queuePosition || queuePosition <= 1) return head
  const ahead = queuePosition - 1
  return `${head} ${ahead} more chat${ahead === 1 ? '' : 's'} ahead of this one.`
}

export function LocalLaneWaitLine({ waiting, queuePosition, onApproval, onApprovalIn }: Props) {
  if (!waiting) return null
  return (
    <div data-testid="composer-waiting-local-lane" className={`w-full ${COMPOSER_MAX_W} mx-auto px-3`}>
      <Hinweis className="px-2">
        {localLaneWaitText(queuePosition, onApproval, onApprovalIn)}
      </Hinweis>
    </div>
  )
}
