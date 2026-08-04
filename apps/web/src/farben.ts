/** Farb-System für generische Eigen-Objekte (Kurator-Pipeline v3, Welle 3).
 *
 * EINE Quelle für die wählbaren Farben ist das Schema-Enum
 * `katalog-item.schema.json#/$defs/farbSlug` (16 kuratierte Interieur-Farben);
 * `FarbSlug` kommt aus den generierten Typen. Hier liegt nur die **Client-Optik**
 * (Slug → Hex) und die reine Auflösungslogik MANUELL > KI > Default – analog zu
 * `MATERIAL_LOOK` (Flächen) und `MATERIAL_FARBE` (Möbel-Basisfarbe). Die
 * Erdung/Validierung (Slug ∈ farbVarianten) passiert im Kurator (Python); hier
 * wird nichts geprüft, nur dargestellt.
 *
 * Die Schema↔Map-Deckung ist per Test abgesichert (`farben.test.ts`): sind neue
 * Slugs im Schema, fehlt hier ein Hex → der Test schlägt an (Drift-Schutz).
 */
import type { katalogItem } from "@fp/shared/generated";

export type FarbSlug = katalogItem.FarbSlug;

/**
 * Slug → Hex. Die Töne sind fürs Rendering fein abgestimmt (matte Interieur-
 * Farben, nicht knallig). `Record<FarbSlug, string>` erzwingt zur Compile-Zeit,
 * dass jeder Schema-Slug einen Hex hat; der Laufzeit-Test prüft die Gegenrichtung.
 */
export const FARBSLUG_HEX: Record<FarbSlug, string> = {
  // Neutraltöne
  weiss: "#f4f4f2",
  creme: "#ece5d8",
  sand: "#d9c9a8",
  beige: "#cbb99a",
  taupe: "#a89a8c",
  hellgrau: "#c9c9c6",
  warmgrau: "#b3aca4",
  anthrazit: "#3f4145",
  schwarz: "#232323",
  // Hölzer – hell nach dunkel
  "esche-hell": "#ddc9a3",
  "eiche-hell": "#c9a76c",
  "eiche-natur": "#a8834f",
  buche: "#c8a882",
  nussbaum: "#6f4e33",
  wenge: "#453026",
  // Metalle & Stein (gedämpft, damit sie neben Holz nicht schreien)
  chrom: "#c4c8cb",
  edelstahl: "#b9bebe",
  schwarzstahl: "#41454a",
  messing: "#ad8a4c",
  kupfer: "#a8674a",
  beton: "#9c9b97",
  "naturstein-hell": "#cfc7b8",
  "marmor-weiss": "#e8e6e0",
  // Farbakzente
  salbei: "#9aa88e",
  graugruen: "#7d8b7a",
  olive: "#6f7250",
  petrol: "#3c6069",
  blaugrau: "#7d8b96",
  dunkelblau: "#2d3a55",
  terracotta: "#b0603f",
  rostrot: "#9b4a2f",
  senf: "#c4964a",
  bordeaux: "#6e2b35",
};

/** Alle Slugs (stabile Reihenfolge = Insertion, entspricht dem Schema-Enum). */
export const FARBSLUGS = Object.keys(FARBSLUG_HEX) as FarbSlug[];

/** Type-Guard: ist `v` ein bekannter Farb-Slug? */
export function istFarbSlug(v: unknown): v is FarbSlug {
  return typeof v === "string" && v in FARBSLUG_HEX;
}

/** Hex-Wert eines Slugs (leerer Fallback #cccccc bei unbekanntem Slug). */
export function farbHex(slug: string | null | undefined): string {
  return slug && istFarbSlug(slug) ? FARBSLUG_HEX[slug] : "#cccccc";
}

/**
 * Effektive Farbvariante eines Objekts nach der eisernen Rangfolge
 * **MANUELL > KI > Default (= erste farbVariante)**.
 *
 * - `manuell`  – Nutzer-Override aus dem UI-State (pro placementId).
 * - `ki`       – `placement.farbe` aus dem Plan (Kurator-Wahl).
 * - Default    – erste Variante der `farbVarianten` des Katalog-Items.
 *
 * Rückgabe `undefined`, wenn keine gültige Variante bestimmbar ist (Item ohne
 * `farbVarianten` und ohne Override) → der Renderer nutzt dann seine
 * Material-Basisfarbe (unveränderter Pfad). Rein & deterministisch.
 */
export function loeseFarbSlug(
  farbVarianten: readonly string[] | null | undefined,
  ki: string | null | undefined,
  manuell: string | null | undefined,
): FarbSlug | undefined {
  const kandidat = manuell ?? ki ?? farbVarianten?.[0];
  return istFarbSlug(kandidat) ? kandidat : undefined;
}
