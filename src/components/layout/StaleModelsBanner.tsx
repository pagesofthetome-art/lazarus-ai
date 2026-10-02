import { useState } from 'react'
import { RefreshCw, X, Check } from 'lucide-react'
import { useModelHealthStore } from '../../stores/modelHealthStore'
import { useModels } from '../../hooks/useModels'
import { checkModelCapability } from '../../api/ollama'
import { countLabel } from '../../lib/formatters'
import { HINWEIS_TEXT, HINWEIS_ZEILE } from '../../lib/hinweis'

/**
 * Top-of-app notice shown when the startup health scan finds installed
 * Ollama models whose manifests are rejected by 0.20.7. Auto-hides when all
 * models are refreshed, or when the user dismisses it, and a dismissal LASTS:
 * it is written to disk with the rest of the store and only the next scan that
 * finds a DIFFERENT set of stale models brings the banner back
 * (stores/modelHealthStore, `setStaleModels`).
 *
 * Cause: Ollama auto-upgraded 0.20.6 to 0.20.7 today and started strict-
 * rejecting manifests pulled before the registry-side capabilities refresh.
 * Fix: re-pull each stale model. The banner does this serially via the
 * existing useModels.pullModel flow (progress lands in DownloadBadge).
 *
 * Bauform: eine ruhige Zeile nach der Regel in `lib/hinweis.ts`. Bis zum
 * 04.09.2026 stand hier ein randbreites gelbes Band mit Fuellflaeche
 * (ein gefuellter gelber Grund), Kante, fetter Ueberschrift und drei Gelbtoenen
 * uebereinander. Es ist aber nichts abgestuerzt: ein Modell muss
 * nachgeladen werden, mehr sagt der Satz nicht. Also `ruhig` statt einer
 * eigenen dritten Farbe, und `role="status"` statt `role="alert"`, damit
 * der Screenreader den Nutzer dafuer nicht unterbricht.
 *
 * Der Refresh-Knopf bleibt ein Knopf: er traegt das Haus-Rezept
 * `.lazarus-control` (dieselbe Haut wie die Knoepfe der Eingabeleiste), also
 * Rand, Radius, Hover-Fuellung und Fokusring. Sichtbar anklickbar, ohne
 * ein eigener Farbkasten zu sein.
 */
export function StaleModelsBanner() {
  const { staleModels, dismissed, dismiss, markFresh } = useModelHealthStore()
  const { pullModel, isPullingModel } = useModels()
  const [refreshingAll, setRefreshingAll] = useState(false)

  if (dismissed || staleModels.length === 0) return null

  const pending = staleModels.filter((m) => !isPullingModel(m))
  const inProgressCount = staleModels.filter((m) => isPullingModel(m)).length

  const refreshAll = async () => {
    if (refreshingAll) return
    setRefreshingAll(true)
    try {
      // Serial: one pull at a time keeps disk/network manageable and gives
      // clear progress in DownloadBadge without interleaved output.
      for (const name of pending) {
        try {
          await pullModel(name)
          // Verify post-pull: Ollama's on-disk manifest is refreshed, probe
          // to confirm 0.20.7 now accepts it before marking fresh.
          const check = await checkModelCapability(name)
          if (check.ok) markFresh(name)
        } catch {
          // Continue with next model; user can retry via the notice later.
        }
      }
    } finally {
      setRefreshingAll(false)
    }
  }

  return (
    <div role="status" className={`${HINWEIS_ZEILE} ${HINWEIS_TEXT.ruhig} px-3 py-1`}>
      <span className="flex-1 min-w-0 self-center truncate" title={staleModels.join(', ')}>
        Ollama 0.20.7 rejects {countLabel(staleModels.length, 'installed model')}:{' '}
        {staleModels.slice(0, 3).join(', ')}
        {staleModels.length > 3 ? `, +${staleModels.length - 3} more` : ''}
      </span>
      {/* Steht ausserhalb der abgeschnittenen Liste: der Fortschritt ist
          das Einzige, was sich waehrend des Laufs aendert, und darf nicht
          hinter dem Namen des dritten Modells verschwinden. */}
      {inProgressCount > 0 && (
        <span className="self-center shrink-0">
          · refreshing {inProgressCount}/{staleModels.length}
        </span>
      )}
      <button
        onClick={refreshAll}
        disabled={refreshingAll || pending.length === 0}
        className="lazarus-control self-center"
        title={`Re-pull ${countLabel(staleModels.length, 'stale model')}`}
      >
        {refreshingAll ? (
          <>
            <RefreshCw size={10} className="animate-spin" />
            <span>Refreshing…</span>
          </>
        ) : pending.length === 0 ? (
          <>
            <Check size={10} />
            <span>Queued</span>
          </>
        ) : (
          <>
            <RefreshCw size={10} />
            <span>Refresh all</span>
          </>
        )}
      </button>
      <button
        onClick={dismiss}
        className="self-center shrink-0 rounded p-[1px] opacity-70 hover:opacity-100 transition-opacity"
        /* Hiess bis 3.0.0 "Dismiss until next launch" und war seit 2.5.9
           falsch: a3b05a44 hat die Ablage dauerhaft gemacht, weil der Knopf
           vorher nichts bewirkte (die Anlaufpruefung raeumte die Marke bei
           jedem Start wieder weg), und niemand hat die Beschriftung
           mitgenommen. Wer sie las, erwartete den Hinweis am naechsten Tag
           wieder und bekam ihn nie. */
        aria-label="Dismiss. It comes back only when a different model goes stale."
        title="Dismiss. It comes back only when a different model goes stale."
      >
        <X size={11} />
      </button>
    </div>
  )
}
