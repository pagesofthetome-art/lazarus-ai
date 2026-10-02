/**
 * Der Beispielpfad im ComfyUI-Eingabefeld, passend zur Kiste, auf der die App
 * gerade laeuft.
 *
 * T8 hat es auf Ubuntu 22.04 und 26.04 gesehen: Schritt 2 von 4 des
 * Assistenten ("Image & Video Generation") bot als Platzhalter `C:\ComfyUI` an,
 * also einen Pfad, den es auf dieser Maschine gar nicht geben kann. Dasselbe
 * Feld steht ein zweites Mal in Settings > ComfyUI, mit demselben Platzhalter.
 * Ein Platzhalter ist ein Beispiel, und ein Beispiel, das auf der Plattform des
 * Lesers unmoeglich ist, hilft nicht beim Ausfuellen, sondern beim Zweifeln.
 *
 * Deshalb steht die Regel hier und nicht zweimal in einer JSX-Zeile: EIN
 * Beispiel, zwei Leser. Die Plattform kommt aus derselben Quelle wie der Rest
 * der beiden Bildschirme, `api/backend.ts`, und wird hier hereingereicht, damit
 * die Regel ohne Browser pruefbar bleibt.
 *
 * Zwei Zweige und nicht drei: Windows schreibt Laufwerksbuchstaben, alles
 * andere schreibt eine Tilde. Auf dem Mac laeuft ComfyUI ohnehin nicht (dort
 * ist lokale Bilderzeugung Apple MLX, und der Assistent ueberspringt diesen
 * Schritt), aber das Feld in den Einstellungen kann dort stehen, und `~/ComfyUI`
 * ist dort so richtig wie auf Linux.
 */
export function comfyPathPlaceholder(onWindows: boolean): string {
  return onWindows ? 'C:\\ComfyUI' : '~/ComfyUI'
}
