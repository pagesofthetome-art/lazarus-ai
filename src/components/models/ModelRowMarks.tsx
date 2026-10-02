import { Unlock } from 'lucide-react'
import type { CloudModel } from '../../types/models'

/**
 * Die Marken an einer Zeile der Modellauswahl.
 *
 * The mark comes from model metadata and never from the model name.
 * Eine Marke beschreibt das Modell, sie erlaubt nichts. Was eine Anfrage
 * enthalten darf, entscheidet der Server bei jedem Aufruf neu.
 *
 * Nur `full` wird markiert. Ein Modell, das teilweise mitgeht, bekommt keine
 * Marke: eine Marke, die manchmal stimmt, ist im Kaufmoment schlimmer als
 * keine, weil der Kunde sie als Zusage liest.
 *
 */
export function ModelRowMarks({ model }: { model: { unfiltered?: CloudModel['unfiltered'] } }) {
  return (
    <>
      {model.unfiltered === 'full' && (
        // K12 (3.0.1): unbeantwortete Discord-Meldung, die Marke war nicht
        // auffindbar. Sie stand als reiner Fliesstext in derselben Groesse
        // wie jede andere Kleinschrift der Zeile, ohne Icon, ohne Gewicht,
        // im Sammelbild der Liste ging sie unter. Bleibt auf derselben
        // Stufe der Typo-Leiter (t-micro setzt NUR die Groesse, siehe
        // index.css), bekommt aber ein Icon und Fettung dazu, beides
        // Tailwind-Utilities, die t-micro nicht ueberschreibt.
        <span
          className="t-micro font-semibold text-purple-600 dark:text-purple-300 inline-flex items-center gap-0.5"
          title="Measured: this model answers without refusing. Provider and local rules still apply."
          data-mark="unfiltered"
        >
          <Unlock size={9} className="shrink-0" aria-hidden="true" />
          No refusals
        </span>
      )}
    </>
  )
}
