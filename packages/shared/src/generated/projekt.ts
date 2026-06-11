/* AUTOGENERIERT aus packages/shared/schemas – nicht von Hand ändern (pnpm codegen). */

export type Uuid = string;
export type Semver = string;

/**
 * Projekt-Hülle: bündelt Raum/Stilprofil/Pläne/Dokumente. Privacy-Metadaten (retentionUntil) von Anfang an im Modell (ADR-0009). Zustandsmaschine: Engineering-Grundlagen §2.
 */
export interface Projekt {
  id: Uuid;
  schemaVersion: Semver;
  name: string;
  zustand:
    | "neu"
    | "raumErfasst"
    | "geometrieBestaetigt"
    | "stilVorhanden"
    | "planVorschlag"
    | "planBearbeitet"
    | "ausgewertet";
  /**
   * Modell kann Mehrraum, POC-UI zeigt 1 (Schema-Spezifikation, offene Frage entschieden als design-in).
   */
  raumRefs: Uuid[];
  stilprofilRef?: Uuid;
  planRefs: Uuid[];
  dokumente: {
    typ:
      | "kv"
      | "mengen"
      | "gewerke"
      | "einkaufsliste"
      | "plan-pdf"
      | "plan-dxf"
      | "3d-export"
      | "next-steps"
      | "bauzeitenplan"
      | "lv"
      | "offertanfrage";
    pfad: string;
    erstellt: string;
  }[];
  createdAt: string;
  retentionUntil: string;
  contributors?: string[];
}
