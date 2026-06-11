/* AUTOGENERIERT aus packages/shared/schemas – nicht von Hand ändern (pnpm codegen). */

export type Uuid = string;
export type Semver = string;
/**
 * @minItems 2
 * @maxItems 2
 */
export type Vec2 = [number, number];
export type Gewerk =
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

/**
 * Vertrag 2: Output Solver → editiert im Viewer → Input Auswertung. constraintReport macht «normkonform» überprüfbar statt behauptet.
 */
export interface PlanObjekt {
  id: Uuid;
  schemaVersion: Semver;
  roomRef: Uuid;
  stilprofilRef: Uuid;
  version: number;
  status: "vorschlag" | "bearbeitet" | "final";
  placements: {
    id: Uuid;
    /**
     * Nur die ID – nie Geometrie einbetten (Box-Platzhalter mit Auto-Upgrade).
     */
    catalogItemId: string;
    pose: Pose;
    gewerk: Gewerk;
    locked: boolean;
    source: "solver" | "user";
    assembly?: Uuid | null;
    /**
     * Unterkante über Boden (m) bei wandmontierten Objekten.
     */
    mountHeight?: number;
  }[];
  /**
   * Lineare Baugruppen (v.a. Küchenzeile): Form + Korpus-Slots im Raster.
   */
  assemblies: {
    id: Uuid;
    type: "kuechenzeile";
    form: "i" | "l" | "u" | "galley" | "insel";
    anchorWall?: Uuid;
    grid?: number;
  }[];
  /**
   * Bauliche Massnahmen – treiben Gewerke/Mengen.
   */
  interventions: {
    id: Uuid;
    kind: "wand-entfernen" | "oeffnung-aendern" | "belag" | "vorwand-neu";
    target?: Uuid;
    params?: {};
  }[];
  finishes: {
    surface: string;
    material: Uuid;
    area?: number;
  }[];
  constraintReport: ConstraintReport;
  meta: {
    solverVersion: string;
    /**
     * Variante reproduzierbar («würfeln»): gleicher Input + seed ⇒ gleicher Plan.
     */
    seed: number;
    normProfile: "ch" | "eu";
    /**
     * Overlay-Flag; Werte erst post-POC.
     */
    barrierefrei: boolean;
    createdAt: string;
    contributors?: string[];
  };
}
export interface Pose {
  pos: Vec2;
  yawDeg: number;
}
export interface ConstraintReport {
  hard: {
    ok: boolean;
    summary: {
      erfuellt: number;
      knapp: number;
      verletzt: number;
    };
  };
  results: {
    ruleId: string;
    /**
     * Konfidenz-Ampel. «knapp» = erfüllt, aber Marge < Messunsicherheit → Next-Steps «vor Ort prüfen». «nicht-geprueft» = Regeltyp im aktuellen Stand bewusst nicht ausgewertet (ehrlich statt stilles ok).
     */
    status: "ok" | "knapp" | "verletzt" | "nicht-geprueft";
    margin_cm?: number | null;
    placements?: Uuid[];
    hinweis?: string;
  }[];
  softScore: {
    stil: number;
    ergonomie: number;
    relation: number;
  };
}
