/* AUTOGENERIERT aus packages/shared/schemas – nicht von Hand ändern (pnpm codegen). */

export type Uuid = string;
export type Semver = string;

/**
 * Vertrag 5: Bild-Katalog für Swipe & Presets (Stammdaten). Bilder sind raumtyp-gebunden; Lizenz ist Pflichtfeld (Content-Pipeline).
 */
export interface BildKatalogItem {
  id: Uuid;
  schemaVersion: Semver;
  bildRef: string;
  roomType: "bad" | "kueche" | "wohnen" | "schlafen" | "essen" | "flur" | "sonstig";
  achsenTags: {
    [k: string]: number;
  };
  attributTags: string[];
  palette: string[];
  lizenz: {
    quelle: string;
    rechte: string;
  };
  istPreset: boolean;
  /**
   * Kuratierter Achsen-Vektor hinter dem Preset-Bild (nur wenn istPreset).
   */
  presetProfile?: {
    [k: string]: number;
  };
}
