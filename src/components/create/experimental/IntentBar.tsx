import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Cloud } from 'lucide-react'
import { useCreateStore } from '../../../stores/createStore'
import { isIntentLocked, visibleIntents } from './intents'
import { isMlxImageHost } from '../../../api/mlx-image'
import { cn } from '../ui/cn'
import { ICON_SM } from '../../ui/icon-size'

// Jede Pille traegt ihre Beschriftung, immer. Bis 2.6.7 stand hier ein
// `max-width`-Aufklappen: nur die AKTIVE Pille zeigte ihren Namen, die
// uebrigen elf standen auf einer Maximalbreite von null, Deckkraft null und
// ohne waagerechtes Polster, die Hauptnavigation des ganzen Create-Bereichs
// war eine Reihe unbeschrifteter Icons, deren Namen nur der Hover-Tooltip
// verriet. Die kurzen Namen lagen dabei fertig im Datenmodell (`short` in
// intents.ts) und wurden von niemandem gelesen.
//
// (Die drei Utilities stehen hier bewusst ausgeschrieben statt als
// Klassennamen: Tailwind scannt diese Datei als Text und haette aus der
// Erklaerung wieder Regeln im ausgelieferten Bundle gemacht, siehe
// keine-klasse-aus-prosa.test.ts, der genau das gefangen hat.)
//
// Gemessen am 01.09.2026 im laufenden Fenster (Chromium 149, 1280x800,
// --ui-scale 1.15, also gerenderte Pixel), alle zwoelf Pillen der
// Cloud-/Windows-Leiste beschriftet:
//
//   nur Icons (Ist bis 2.6.7)     476 px
//   `short`  (Image … Motion)    1068 px   <- passt, 184 px Luft
//   `label`  (Edit / Image to Image, Remove Background, …)  1704 px
//   verfuegbar bei 1280px Fenster 1252 px
//
// Deshalb `short` und nicht `label`: die vollen Namen sprengen schon das
// Standardfenster um 452 px. `short` traegt bis hinunter zu ~1096 px
// Fensterbreite in einer Zeile.
//
// Darunter reicht der Platz nicht mehr. Nachgemessen bei 700 px Fenster:
// die Leiste laeuft 50 px ueber ihren Container hinaus, die Pillen stauchen
// NICHT, weil ein Flex-Item mit `whitespace-nowrap`-Inhalt und ohne `min-w-0`
// seine Mindestbreite behaelt. Der Ausgang waere die abgeschnittene letzte
// Pille am rechten Rand.
//
// Deshalb `flex-wrap`: dieselbe Leiste bricht in eine zweite Zeile um
// (gemessen 35,6 -> 71,3 px Hoehe; die Buehne darunter ist `flex-1` und gibt
// die 35,7 px her). Kein Ueberlauf, kein abgeschnittener Text, nichts
// verschwindet.
//
// 2.6.8 hatte hier ein Scrollrad an dieser Stelle: eine Zeile, die den
// aktiven Eintrag in die Mitte fuhr und die Nachbarn nach aussen ausblendete.
// Rueckbau am 07.09.2026 nach dem Discord-Befund „when the tools move I have
// to look for them" (Rollback auf den Stand von 2.6.7). Ein Werkzeug, das
// seinen Platz wechselt, ist teurer als eine zweite Zeile.
//
// Der volle Name bleibt in `title` und `aria-label`. „Edit" auf der Pille,
// „Edit / Image to Image" fuer Hover und Screenreader.
//
// Die aktive Pille hebt sich weiter ueber Flaeche, Rand und Schriftfarbe ab
// (kein Framer-Layout, nichts kann auf dem Weg springen).
const EASE = 'ease-[cubic-bezier(0.22,1,0.36,1)]'

export function IntentBar() {
  const intent = useCreateStore((s) => s.intent())
  const setIntent = useCreateStore((s) => s.setIntent)
  const backend = useCreateStore((s) => s.backend)
  // The shared helper returns every mode relevant to this backend and host.
  // Local-only gaps stay visible as Cloud-locked choices; isIntentAvailable
  // uses the same rule for result actions that switch into an intent.
  const mlxHost = isMlxImageHost()
  const intents = visibleIntents(backend, mlxHost)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const selectedMeta = intents.find((meta) => meta.id === intent) ?? intents[0]
  const SelectedIcon = selectedMeta?.icon

  useEffect(() => {
    if (!open) return
    const closeOnOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutside)
    return () => document.removeEventListener('mousedown', closeOnOutside)
  }, [open])

  return (
    <div ref={rootRef} className="absolute left-0 top-0 z-30 flex justify-start px-4 pt-1">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Choose create mode"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex items-center gap-2 h-9 rounded-full border px-4 transition-[background-color,border-color,box-shadow,color] duration-200',
          EASE,
          'border-purple-300/30 bg-purple-500/10 text-purple-100 shadow-[0_0_18px_rgba(168,85,247,0.22)] hover:border-purple-200/55 hover:bg-purple-500/15',
        )}
      >
        {SelectedIcon && <SelectedIcon size={ICON_SM} />}
        <span className="t-control">{selectedMeta?.label ?? 'Create mode'}</span>
        <ChevronDown size={13} className={cn('transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Create mode"
          className="pointer-events-auto absolute top-full z-40 mt-1.5 grid min-w-[260px] grid-cols-2 gap-1 rounded-xl border border-gray-200 bg-white p-2 shadow-xl dark:border-white/10 dark:bg-[#171421]"
        >
          {intents.map((meta) => {
            const selected = intent === meta.id
            const locked = isIntentLocked(meta, backend, mlxHost)
            const Icon = meta.icon
            return (
              <button
                key={meta.id}
                type="button"
                role="option"
                aria-selected={selected}
                aria-disabled={locked}
                aria-label={meta.label}
                title={locked ? `${meta.label} requires the Cloud backend` : meta.label}
                onClick={() => { if (!locked) { setIntent(meta.id); setOpen(false) } }}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors',
                  locked
                    ? 'cursor-not-allowed border-transparent text-gray-500/70 dark:text-gray-500'
                    : selected
                    ? 'border-purple-200/55 bg-purple-500/20 text-purple-50 shadow-[0_0_12px_rgba(168,85,247,0.24)]'
                    : 'border-transparent text-gray-400 hover:border-purple-300/25 hover:bg-purple-500/10 hover:text-purple-100',
                )}
              >
                <Icon size={ICON_SM} />
                <span className="t-control">{meta.short}</span>
                {locked && <Cloud size={ICON_SM} className="ml-auto opacity-70" aria-hidden="true" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
