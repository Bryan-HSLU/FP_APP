/** Geteilte Möbel-Proportionen für 2D-Grundriss UND 3D-Viewer.
 *
 * Warum eine eigene Datei: Grundriss (`symbole2d.ts`) und 3D-Bausätze
 * (`moebel3d.tsx`) haben dieselben Möbel zweimal beschrieben – mit leicht
 * unterschiedlichen Anteilen (Armlehne 14 % vs. 11 %, Rückenlehne 22 % vs.
 * 24 %). Ergebnis: Das Sofa im Plan sah anders aus als im 3D, was beim
 * Vergleich sofort auffällt. Die Anteile stehen darum **einmal** hier und
 * werden von beiden Seiten gelesen.
 *
 * Alle Werte sind **Anteile der Bounding-Box** (0..1), nie absolute Meter –
 * so bleiben sie für jede Möbelgrösse gültig und die bbox-Invariante
 * (nichts ragt über w×d×h hinaus) bleibt trivial einhaltbar.
 *
 * Koordinaten wie überall: Front = +z, Rückseite = −z, Ursprung = bbox-Mitte.
 */

/** Sofa/Sessel/Récamière – Polstermöbel mit Rückenlehne und zwei Armlehnen. */
export const SOFA = {
  /** Breite EINER Armlehne, Anteil der Gesamtbreite. */
  armBreite: 0.11,
  /** Tiefe der Rückenlehne, gemessen ab der Rückkante (−d/2). */
  lehneTiefe: 0.24,
  /** Tiefe der Armlehnen (etwas kürzer als der Korpus). */
  armTiefe: 0.9,
  /** Mitten-Versatz der Armlehnen nach vorne. */
  armVersatz: 0.02,
  /** Sitzkissen: Breite und Mitten-Abstand, Anteil der Innenbreite. */
  kissenBreite: 0.47,
  kissenVersatz: 0.24,
  /** Tiefe der Sitzkissen, Anteil der Gesamttiefe. */
  kissenTiefe: 0.66,
  /** Mitten-Versatz der Sitzkissen nach vorne. */
  kissenVersatzTiefe: 0.06,
} as const;

/** Ecksofa/L-Sofa (`modell3d: "sofa-l"`): Hauptbank hinten + Longchair rechts.
 *
 * Anteile der bbox, abgeleitet aus dem bestehenden 3D-Bausatz `sofaL` – das
 * 2D-Symbol fehlte bisher ganz, weshalb im Grundriss ein normales Sofa
 * gezeichnet wurde, während der 3D-Viewer ein L zeigte. Der Longchair liegt
 * rechts (lokal +x) und ragt nach vorne (+z); gespiegelte Aufstellungen
 * ergeben sich über den Yaw des Solvers.
 */
export const ECKSOFA = {
  /** Tiefe der Hauptzeile, gemessen ab der Rückkante. */
  hauptTiefe: 0.62,
  /** Breite des vorspringenden Schenkels. */
  schenkelBreite: 0.46,
  /** Breite EINER Armlehne (nur aussen, innen ist die Sitzlandschaft offen). */
  armBreite: 0.1,
  /** Höhe der Rückenlehne, Anteil der Gesamthöhe. */
  lehneHoehe: 0.5,
} as const;

/** TV-Lowboard – der Fernseher darauf. */
export const TV = {
  /** Oberkante des Korpus (inkl. Platte), Anteil der Gesamthöhe ab Unterkante. */
  korpusOben: 0.44,
  /** Höhe des Standfusses zwischen Korpus und Bildschirm-Unterkante. */
  fussHoehe: 0.08,
  /**
   * Seitenverhältnis des Bildschirms (Breite/Höhe). Fernseher sind seit Jahren
   * praktisch ausnahmslos 16:9 – vorher wurde der Bildschirm aus der
   * Lowboard-Breite abgeleitet und dadurch extrem breitgezogen (bei 1.4 m
   * Möbelbreite ein 1.2 × 0.25 m «Briefschlitz»). Jetzt bestimmt die im
   * bbox verbleibende HÖHE die Grösse, die Breite folgt aus 16:9.
   */
  seitenverhaeltnis: 16 / 9,
  /** Der Bildschirm darf höchstens so breit werden (Anteil der Möbelbreite). */
  maxBreite: 0.95,
} as const;

/**
 * Ablagehöhe für Deko «auf_oberflaeche», als Anteil der Möbelhöhe.
 *
 * Default ist 1.0 = bbox-Oberkante (Tisch, Sideboard, Kommode – dort liegt die
 * Ablagefläche tatsächlich oben). Bei Polstermöbeln ist die Oberkante aber die
 * **Rückenlehne**: ein Plaid oder Kissen landete dadurch frei schwebend über
 * dem Sofa. Für sie zählt die Sitz- bzw. Liegefläche.
 */
export const ABLAGE_ANTEIL: Record<string, number> = {
  sofa: 0.56,
  sessel: 0.58,
  recamiere: 0.58,
  pouf: 0.95,
  bett: 0.95,
  einzelbett: 0.95,
  doppelbett: 0.95,
  kinderbett: 0.95,
  stuhl: 0.55,
  barhocker: 0.95,
  badhocker: 0.95,
};

/** Ablagehöhe eines Möbels in Metern (Deko liegt darauf auf). */
export function ablageHoehe(funktionsTyp: string, hoehe: number): number {
  return hoehe * (ABLAGE_ANTEIL[funktionsTyp] ?? 1.0);
}
