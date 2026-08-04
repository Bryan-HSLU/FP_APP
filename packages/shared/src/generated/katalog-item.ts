/* AUTOGENERIERT aus packages/shared/schemas – nicht von Hand ändern (pnpm codegen). */

export type Uuid = string;
export type Semver = string;
/**
 * Farbwelt der Katalog-Items (additiv erweiterbar, minor). Gruppiert: Neutraltöne, Holz, Metall/Stein, Farbakzente. Reihenfolge ist stabil – der Client leitet daraus die Picker-Sortierung ab.
 */
export type FarbSlug =
  | "weiss"
  | "creme"
  | "sand"
  | "beige"
  | "taupe"
  | "hellgrau"
  | "warmgrau"
  | "anthrazit"
  | "schwarz"
  | "esche-hell"
  | "eiche-hell"
  | "eiche-natur"
  | "nussbaum"
  | "wenge"
  | "buche"
  | "chrom"
  | "edelstahl"
  | "schwarzstahl"
  | "messing"
  | "kupfer"
  | "beton"
  | "naturstein-hell"
  | "marmor-weiss"
  | "salbei"
  | "graugruen"
  | "olive"
  | "petrol"
  | "blaugrau"
  | "dunkelblau"
  | "terracotta"
  | "rostrot"
  | "senf"
  | "bordeaux";

/**
 * Vertrag 4: Möbel-/Objektkatalog (Stammdaten). Box-Platzhalter mit Auto-Upgrade: ohne gltfRef rendert der Viewer eine Box aus masse; Platzierungen referenzieren nur die ID.
 */
export interface KatalogItem {
  id: Uuid;
  schemaVersion: Semver;
  name: string;
  kategorie: string;
  /**
   * Funktionaler Typ, auf den Regeln matchen (z.B. wc, lavabo, dusche, herd, sofa).
   */
  funktionsTyp: string;
  /**
   * @minItems 1
   */
  roomTypes: [
    "bad" | "kueche" | "wohnen" | "schlafen" | "essen" | "flur" | "sonstig",
    ...("bad" | "kueche" | "wohnen" | "schlafen" | "essen" | "flur" | "sonstig")[]
  ];
  gewerk:
    | "sanitaer"
    | "elektro"
    | "schreiner"
    | "maler"
    | "plattenleger"
    | "bodenleger"
    | "heizung"
    | "lueftung"
    | "kueche"
    | "moebel"
    | "baumeister";
  masse: {
    w: number;
    d: number;
    h: number;
  };
  gltfRef?: string;
  /**
   * 3D-Bausatz-Variante für den Viewer (z.B. wc-wandhaengend, lavabo-aufsatz). Fehlt es, greift der Standard-Bausatz des funktionsTyp; für spätere echte Assets bleibt gltfRef zuständig.
   */
  modell3d?: string;
  /**
   * AR-Einzelobjekt-Vorschau (Quick Look), Stretch.
   */
  usdzRef?: string;
  assetStatus: "placeholder" | "modeled";
  /**
   * P1 Pflicht/Anschluss · P2 Funktion · P3 Ergänzung (Gestaltungs-Engine).
   */
  priorityClass: "P1" | "P2" | "P3";
  /**
   * Objekt-Ebenen-Modell (ADR-0014): «haupt» = raumprägend (Sofa, Esstisch, WC, Küchenzeile …), zuerst gewählt; «ergaenzung» = ergänzt ein Haupt-Objekt (Stuhl zum Esstisch, Couchtisch zum Sofa …). Optional/additiv – fehlt es, gilt das Item als eigenständig (eine Gruppe, keine Anker-Pflicht). Orthogonal zu priorityClass (Auswahl-Semantik vs. Platzierungs-Konkurrenz).
   */
  objektEbene?: "haupt" | "ergaenzung";
  /**
   * Nur bei objektEbene=ergaenzung: funktionsTyp des Haupt-Objekts, an dem die Ergänzung hängt (z.B. «esstisch» für Stühle). Harte Kontrolle: die Ergänzung ist nur wählbar, wenn ein Haupt-Objekt dieses funktionsTyps gewählt ist. Fehlt es, ist die Ergänzung frei wählbar (kein Anker).
   */
  ankerTyp?: string;
  /**
   * Obergrenze der Instanzen dieses Items in einem Raum (z.B. Stuhl 6, Barhocker 4). Default 1 (Einzelstück). Der Kurator/die Baseline wählt anzahl ≤ maxAnzahl; das Platz-Budget begrenzt zusätzlich.
   */
  maxAnzahl?: number;
  /**
   * Host-Bindung; Default boden.
   */
  mount?: "boden" | "wand";
  /**
   * Erlaubte Montagehöhe (Unterkante bzw. Oberkante je Konvention der Regel) bei mount=wand.
   */
  mountHeightRange?: {
    min: number;
    max: number;
  };
  achsenTags: {
    [k: string]: number;
  };
  /**
   * Wählbare Farbvarianten des generischen Objekts; erste = Default-Optik. Grundlage für KI-Farbwahl und UI-Picker (nur solange Eigen-Objekte, keine Hersteller-Assets). Obergrenze 6 (war 4): generische Möbel wirken sonst austauschbar – mehr wählbare Töne je Objekt sind der günstigste Hebel gegen «immer dasselbe».
   *
   * @minItems 1
   * @maxItems 6
   */
  farbVarianten?:
    | [FarbSlug]
    | [FarbSlug, FarbSlug]
    | [FarbSlug, FarbSlug, FarbSlug]
    | [FarbSlug, FarbSlug, FarbSlug, FarbSlug]
    | [FarbSlug, FarbSlug, FarbSlug, FarbSlug, FarbSlug]
    | [FarbSlug, FarbSlug, FarbSlug, FarbSlug, FarbSlug, FarbSlug];
  attributTags: string[];
  anschluesse: ("wasser" | "abwasser" | "elektro" | "starkstrom" | "lueftung" | "heizung")[];
  relationalRules: string[];
  normProfileVariante?: "ch55" | "eu60";
  bkpCode?: string;
  ebkpCode?: string;
  npkRef?: string;
  preis: {
    value: number;
    currency: "CHF";
    stand: string;
    /**
     * Provenance-Pflicht.
     */
    quelle: string;
    bandbreitePct: number;
  };
}
