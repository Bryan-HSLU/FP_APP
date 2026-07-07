/** Reine Zustandslogik des Fortschrittswegs (ohne React/DOM – dadurch klein
 *  und testbar). Der Weg hat fünf Schritte; welcher Schritt aktiv, erledigt,
 *  verfügbar oder gesperrt (und damit klickbar) ist, hängt nur von zwei Zahlen
 *  ab: dem aktuellen Schritt und dem am weitesten erreichten Schritt.
 */

/** Beschriftungen der fünf Wizard-Schritte (Bryans Weg). Bewusst kompakt –
 *  «Ergebnis» statt «Auswertung & Export» für den engen Weg. */
export const FORTSCHRITT_SCHRITTE = [
  "Projekt",
  "Stil",
  "Vorschlag",
  "Anpassen",
  "Ergebnis",
] as const;

export type SchrittZustand = "aktiv" | "erledigt" | "verfuegbar" | "gesperrt";

export interface SchrittInfo {
  zustand: SchrittZustand;
  /** Klickbar = bereits erreicht und nicht der aktuelle Schritt. */
  klickbar: boolean;
}

/**
 * Ermittelt den visuellen Zustand eines Weg-Schritts.
 *
 * @param nr                  1-basierte Schrittnummer.
 * @param aktuellerSchritt    Der Schritt, auf dem der Nutzer gerade steht.
 * @param maxErreichterSchritt Der am weitesten freigeschaltete Schritt.
 *
 * - `aktiv`      = genau der aktuelle Schritt (orange).
 * - `erledigt`   = liegt hinter dem aktuellen Schritt (dunkelgrün + ✓).
 * - `verfuegbar` = schon erreicht, aber vor dem aktuellen liegend (z. B. nach
 *                  «Zurück») – erreichbar, aber noch nicht abgeschlossen.
 * - `gesperrt`   = noch nicht freigeschaltet (Salbei, nicht klickbar).
 */
export function schrittZustand(
  nr: number,
  aktuellerSchritt: number,
  maxErreichterSchritt: number,
): SchrittInfo {
  if (nr === aktuellerSchritt) return { zustand: "aktiv", klickbar: false };
  if (nr > maxErreichterSchritt) return { zustand: "gesperrt", klickbar: false };
  if (nr < aktuellerSchritt) return { zustand: "erledigt", klickbar: true };
  return { zustand: "verfuegbar", klickbar: true };
}
