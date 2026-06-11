/* AUTOGENERIERT aus packages/shared/schemas – nicht von Hand ändern (pnpm codegen). */

export type Uuid = string;
export type Semver = string;

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
    ...("bad" | "kueche" | "wohnen" | "schlafen" | "essen" | "flur" | "sonstig")[],
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
   * AR-Einzelobjekt-Vorschau (Quick Look), Stretch.
   */
  usdzRef?: string;
  assetStatus: "placeholder" | "modeled";
  /**
   * P1 Pflicht/Anschluss · P2 Funktion · P3 Ergänzung (Gestaltungs-Engine).
   */
  priorityClass: "P1" | "P2" | "P3";
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
