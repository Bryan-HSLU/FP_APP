/** Konvergenz-Erkennung für den Stil-Swipe (Bryan-Wunsch: nicht alle 30 Bilder
 *  erzwingen, sondern so früh wie möglich stoppen, wenn das Profil steht).
 *
 *  Reine Zustandslogik ohne React/DOM – dadurch klein und testbar. Der Swipe
 *  hält einen Verlauf der styleVector-Updates (ein Eintrag je zurückgekommenem
 *  Live-Profil); `istStabil` beurteilt, ob sich das Profil zuletzt kaum noch
 *  bewegt hat.
 */

/** Ein Punkt im Stilraum: Achsen-ID → Wert (typischerweise −1…+1). */
export type StilVektor = Record<string, number>;

/**
 * Grösste absolute Achsen-Differenz zweier Vektoren.
 *
 * Defensiv: fehlt eine Achse in einem der beiden Vektoren, zählt sie als 0 –
 * so crasht ein unvollständiges Update (z. B. eine Achse noch ohne Signal)
 * nicht, sondern geht als «keine Bewegung auf dieser Achse» ein.
 */
export function maxAchsenDifferenz(a: StilVektor, b: StilVektor): number {
  let max = 0;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const diff = Math.abs((a[key] ?? 0) - (b[key] ?? 0));
    if (diff > max) max = diff;
  }
  return max;
}

/**
 * Ist das Stilprofil stabil genug, um das Bewerten zu stoppen?
 *
 * `true`, wenn **beide** Bedingungen gelten:
 *  1. Es liegen mindestens `minBewertungen` Vektor-Updates vor (genug Signal).
 *  2. Die letzten `fenster` aufeinanderfolgenden Updates haben sich **jeweils**
 *     um **weniger als** `delta` bewegt (Mass: grösste Achsen-Differenz).
 *
 * @param verlauf        Chronologische styleVector-Updates (ein Eintrag je Live-Profil).
 * @param minBewertungen Mindestzahl an Updates, bevor überhaupt gestoppt wird.
 * @param delta          Schwelle je Übergang (grösste Achsen-Differenz).
 * @param fenster        Anzahl aufeinanderfolgender Übergänge, die alle unter `delta` liegen müssen.
 */
export function istStabil(
  verlauf: StilVektor[],
  minBewertungen = 8,
  delta = 0.06,
  fenster = 2,
): boolean {
  if (verlauf.length < minBewertungen) return false;
  // Für `fenster` Übergänge brauchen wir `fenster + 1` Punkte.
  if (verlauf.length < fenster + 1) return false;
  for (let i = 0; i < fenster; i++) {
    const j = verlauf.length - 1 - i;
    const neu = verlauf[j];
    const vor = verlauf[j - 1];
    if (!neu || !vor) return false;
    if (maxAchsenDifferenz(neu, vor) >= delta) return false;
  }
  return true;
}
