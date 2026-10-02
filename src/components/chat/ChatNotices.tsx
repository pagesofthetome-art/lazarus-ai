/**
 * Der Platz, an dem die Zeilen aus dem Eingabefeld gelandet sind.
 *
 * Oben im Verlaufsbereich, nicht am Composer: David, 21.09.2026, mehrfach am
 * echten Windows-Bau, „NICHTS im prompt fenster!" Ein Toastsystem, in das
 * beliebige Stellen der App schreiben koennten, gibt es hier nicht, und dafuer
 * eins zu erfinden waere mehr Bauwerk als Befund. Also ein Platz, eine Form,
 * und jede Zeile mit Namen.
 *
 * Gezeichnet wird mit `<Hinweis>`, also in genau der Form, die `lib/hinweis.ts`
 * fuer Anmerkungen und Fehler vorschreibt: eine Zeile, kein Kasten, ruhiges
 * Grau oder Rot, und ein x, das sie wegnimmt.
 */
import { Bot, FolderOpen, ImageOff, Images, Paperclip } from 'lucide-react'
import { Hinweis } from '../ui/Hinweis'
import { useChatNoticeStore, type ChatNoticeId } from '../../stores/chatNoticeStore'
import { COMPOSER_MAX_W } from './composer-width'

/** Das Symbol je Zeile. Keine eigene Farbe: die traegt der Ton. */
const ICON: Record<ChatNoticeId, typeof Paperclip> = {
  'attachment-is-not-an-image': Paperclip,
  'model-cannot-see-images': ImageOff,
  'image-attach': Images,
  'agent-outside-workspace': FolderOpen,
  'agent-for-local-files': Bot,
}

interface Props {
  /** Die Dokumentenablage oeffnen, fuer die Zeile ueber den fehlgegangenen
   *  Anhang. Fehlt sie, faellt der Knopf weg und der Satz bleibt wahr. */
  onAttachDocs?: () => void
}

export function ChatNotices({ onAttachDocs }: Props) {
  const notices = useChatNoticeStore((s) => s.notices)
  const dismiss = useChatNoticeStore((s) => s.dismiss)

  if (notices.length === 0) return null

  return (
    <div data-testid="chat-notices" className={`w-full ${COMPOSER_MAX_W} mx-auto px-3 pt-1`}>
      {notices.map((n) => {
        const Icon = ICON[n.id]
        return (
          <Hinweis
            key={n.id}
            ton={n.ton}
            className="px-1"
            icon={<Icon size={11} className="shrink-0 mt-0.5" />}
            onDismiss={() => dismiss(n.id)}
          >
            {n.text}
            {n.id === 'attachment-is-not-an-image' && onAttachDocs && (
              <button
                onClick={() => { dismiss(n.id); onAttachDocs() }}
                className="ml-1 underline underline-offset-2 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              >
                Open Documents
              </button>
            )}
          </Hinweis>
        )
      })}
    </div>
  )
}
