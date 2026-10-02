/**
 * The Installed half of Models > LoRAs.
 *
 * A LoRA is not a model you switch to, it is a file the LoRA stack in Create
 * layers on top of one, so this list carries no Use button and nothing here
 * can be made the active model. What it does carry is the two things the user
 * came for: what each file weighs, and a way to take one off the disk again.
 *
 * The rows come from the same ComfyUI inventory the Image tab reads (they are
 * the `source: 'lora'` half of it), so there is no second reader and no second
 * answer about what is installed.
 */
import { Layers, Trash2 } from 'lucide-react'
import { parseLocalCharacterLora } from '../../api/trainer'
import { formatBytes } from '../../lib/formatters'

export interface LoraRow {
  name: string
  /** Bytes on disk, 0 when the size probe could not answer. */
  size: number
}

interface Props {
  /** The rows to draw, already narrowed by the header search. */
  rows: LoraRow[]
  /** How many LoRAs are installed in total, search or no search. The empty
   *  state is a claim about the DISK, so it hangs off this and never off the
   *  filtered list: ten installed LoRAs and a query that matches none of them
   *  used to read "No LoRAs installed yet". */
  total: number
  /** What the header search currently holds, for the no-match line. */
  searchQuery: string
  /** Opens the shared delete confirmation of the Models view. */
  onDelete: (name: string) => void
  /** Sends the user to the Get new segment of this same rail. */
  onGetNew: () => void
}

/** The one sentence that says where a downloaded LoRA is actually used. The
 *  three names are the labels Create really shows: the drawer is titled
 *  "Advanced settings" (AdvancedDrawer.tsx), the group inside it "Expert" and
 *  the list "LoRA stack" (ParamGroups.tsx). */
export const LORA_USE_HINT = 'Use them in Create, Advanced settings, Expert, LoRA stack.'

export function LoraManager({ rows, total, searchQuery, onDelete, onGetNew }: Props) {
  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-16 px-6 gap-3">
        <div className="w-14 h-14 rounded-full bg-gray-100 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.06] flex items-center justify-center">
          <Layers size={28} className="text-gray-400 dark:text-gray-500" />
        </div>
        <div className="space-y-1">
          <p className="t-control text-gray-800 dark:text-gray-200">No LoRAs installed yet</p>
          <p className="t-micro text-gray-500 max-w-[300px] leading-relaxed">
            Get new searches CivitAI and puts what you pick into ComfyUI&apos;s models/loras folder. {LORA_USE_HINT}
          </p>
        </div>
        <button
          onClick={onGetNew}
          className="flex items-center gap-1.5 mt-1 px-3 py-1.5 rounded-md bg-gray-900 dark:bg-white/10 hover:bg-gray-800 dark:hover:bg-white/15 text-white t-micro font-medium transition-colors"
        >
          <Layers size={11} /> Get new LoRAs
        </button>
      </div>
    )
  }

  return (
    <section className="space-y-1.5">
      <div className="flex items-center gap-2 px-1">
        <Layers size={11} />
        <h2 className="t-micro font-semibold uppercase tracking-[0.12em] text-gray-700 dark:text-gray-300">LoRAs</h2>
        <span className="text-[0.55rem] text-gray-400 dark:text-gray-500 tabular-nums">{rows.length}</span>
        <div className="flex-1 h-px bg-gray-200 dark:bg-white/[0.06]" />
      </div>
      <p className="px-1 text-[0.55rem] text-gray-500 dark:text-gray-500">{LORA_USE_HINT}</p>
      <div className="space-y-1.5">
        {rows.map((row) => {
          const character = parseLocalCharacterLora(row.name)
          return (
            <div
              key={row.name}
              data-testid="lora-row"
              className="flex items-center gap-3 px-3 py-2 rounded-lg border border-gray-200 dark:border-white/[0.06] bg-white dark:bg-white/[0.02]"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate t-control text-gray-900 dark:text-gray-100">{row.name}</span>
                  {character && (
                    <span className="shrink-0 px-1.5 py-0.5 rounded t-micro border border-lazarus-accent/30 bg-lazarus-accent-soft text-lazarus-accent-edge dark:text-lazarus-accent">
                      Character
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5 t-micro text-gray-500 dark:text-gray-500">
                  {row.size > 0 && <span className="tabular-nums">{formatBytes(row.size)}</span>}
                  {character && <span className="font-mono">Trigger word: {character.trigger}</span>}
                </div>
              </div>
              <button
                onClick={() => onDelete(row.name)}
                title="Delete"
                aria-label={`Delete ${row.name}`}
                className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
              >
                <Trash2 size={13} />
              </button>
            </div>
          )
        })}
        {/* Same shape as the other rails: the section heading and its count
            stay, and the filtered-away list says so instead of claiming
            anything about what is installed. */}
        {rows.length === 0 && (
          <p className="text-center t-micro text-gray-500 py-6">No installed LoRAs match "{searchQuery}"</p>
        )}
      </div>
    </section>
  )
}
