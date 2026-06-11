/* AUTOGENERIERT aus packages/shared/schemas – nicht von Hand ändern (pnpm codegen). */

export type Uuid = string;
export type Semver = string;

/**
 * Vertrag 3: Stil-Engine → Kurator/Solver. Reine Achsen statt benannter Stile (ADR-0006); Achsen-Set datengetrieben über die Taxonomie.
 */
export interface Stilprofil {
  id: Uuid;
  schemaVersion: Semver;
  taxonomyVersion: Semver;
  /**
   * Achsen-ID (aus data/taxonomy/) → Wert −1…+1 (Gegensatzpaare, 0 = neutral). Erweiterbar ohne Schema-Änderung.
   */
  styleVector: {
    [k: string]: number;
  };
  derivedRequirements: string[];
  palette: string[];
  meta: {
    method: "swipe" | "preset";
    presetId?: Uuid;
    /**
     * Profil ist raumtyp-gebunden (Bad-Projekt → Bad-Bilder).
     */
    roomType: "bad" | "kueche" | "wohnen" | "schlafen" | "essen" | "flur" | "sonstig";
    likes?: number;
    dislikes?: number;
    /**
     * Mindest-Stichprobe erreicht?
     */
    sampleSufficient: boolean;
  };
}
