/** Stil-Nähe (Cosinus-Ähnlichkeit) zwischen einem Stilprofil-Vektor und den
 *  `achsenTags` eines Objekts. Ausgelagert aus `ObjektInfoPanel`, damit sowohl
 *  das Info-Panel als auch die Scene-Dressing-Engine (`dressing.ts`) dieselbe
 *  Logik nutzen (kein Duplikat). Bewusst DOM-/React-frei und rein rechnend.
 */

/**
 * Cosinus-Ähnlichkeit zwischen dem Stilvektor (Achsen) und den `achsenTags`
 * eines Objekts über die gemeinsamen Achsen. Ergebnis in [0,1] (Cosinus [−1,1]
 * linear auf [0,1] abgebildet; 1 = deckungsgleiche Ausrichtung). `null`, wenn es
 * keine gemeinsame Achse gibt.
 */
export function stilNaehe(
  styleVector: Record<string, number>,
  achsenTags: Record<string, number>,
): number | null {
  let dot = 0;
  let na = 0;
  let nb = 0;
  let gemeinsame = 0;
  for (const [achse, wa] of Object.entries(styleVector)) {
    const wb = achsenTags[achse];
    if (wb === undefined) continue;
    gemeinsame++;
    dot += wa * wb;
    na += wa * wa;
    nb += wb * wb;
  }
  if (gemeinsame === 0 || na === 0 || nb === 0) return null;
  const cos = dot / (Math.sqrt(na) * Math.sqrt(nb));
  return Math.max(0, Math.min(1, (cos + 1) / 2));
}
