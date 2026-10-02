/**
 * Darf ein GEMERKTER Ordner der Arbeitsordner sein? Fragen, bevor er gesetzt
 * wird.
 *
 * Fehler D hat den DIALOG ehrlich gemacht: ein Ordner, den die Rust-Seite
 * nicht annimmt, kommt seitdem als Fehler zurueck und wird gar nicht erst
 * gesetzt. Drei Wege setzen einen Ordner aber ohne jeden Dialog: der Knopf
 * "Use last folder", der Vorgabeordner aus den Einstellungen, und
 * `codexStore.workingDirectory` (der Code-Reiter-Ordner selbst); alle drei
 * ueberleben einen Neustart im Speicher des Browsers. Kennt die
 * Erlaubnisliste den Pfad nicht (frische Installation, geleerte Daten, ein
 * Ordner direkt unter `$HOME`), stand er danach in der Kopfzeile, und jede
 * Dateioperation antwortete mit "pick it again to allow it", ohne dass je ein
 * Dialog aufgegangen waere, in dem man das haette tun koennen.
 *
 * `validate_workspace_folder` faellt dasselbe Urteil wie der Dialogweg und
 * merkt sich NICHTS dabei. Ein alter Pfad wird also nicht still in die
 * Erlaubnisliste nachgezogen: auf die Liste kommt ein Ordner weiterhin nur
 * ueber den nativen Dialog.
 *
 * Ausserhalb der gepackten App gibt es weder den Befehl noch ueberhaupt eine
 * Erlaubnisliste (die Begruendung steht in `lib/dev-fs-jail.ts`), also gibt es
 * dort auch nichts abzulehnen.
 */
import { backendCall, isTauri } from '../backend'
import { rememberedWorkspaceRefusedMessage } from '../../lib/workspace-rejected'

/**
 * Der Satz, warum dieser gemerkte Ordner nicht gesetzt werden darf, oder
 * `null`, wenn er in Ordnung ist.
 */
export async function rememberedFolderRefusal(path: string): Promise<string | null> {
  if (!isTauri()) return null
  try {
    await backendCall('validate_workspace_folder', { path })
    return null
  } catch (e) {
    return rememberedWorkspaceRefusedMessage(path, e)
  }
}
