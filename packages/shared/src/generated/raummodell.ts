/* AUTOGENERIERT aus packages/shared/schemas – nicht von Hand ändern (pnpm codegen). */

export type Uuid = string;
export type Semver = string;
export type RoomType = "bad" | "kueche" | "wohnen" | "schlafen" | "essen" | "flur" | "sonstig";
/**
 * [x, z] in Metern (Grundriss-Ebene).
 *
 * @minItems 2
 * @maxItems 2
 */
export type Vec2 = [number, number];
export type AnschlussTyp =
  | "wasser"
  | "abwasser"
  | "elektro"
  | "starkstrom"
  | "lueftung"
  | "heizung";

/**
 * Vertrag 1: Output Raum-Engine → Input Solver/Viewer. y-up, rechtshändig, Meter; Grundriss in der x/z-Ebene. Quelle: Brain → Domaenenmodell-Schema-Spezifikation.
 */
export interface Raummodell {
  id: Uuid;
  schemaVersion: Semver;
  name: string;
  roomType: RoomType;
  source: "scan" | "video" | "plan-import" | "sample" | "manuell";
  units: "m";
  shell: {
    /**
     * Wand-SEGMENTE (kein Polygon): nur Segmente tragen kind massiv/offen/virtuell je Kante (Grossraum). Validator: Hülle geschlossen.
     *
     * @minItems 3
     */
    walls: [
      {
        id: Uuid;
        start: Vec2;
        end: Vec2;
        height: number;
        thickness: number;
        kind: "massiv" | "offen" | "virtuell";
        openings?: Uuid[];
      },
      {
        id: Uuid;
        start: Vec2;
        end: Vec2;
        height: number;
        thickness: number;
        kind: "massiv" | "offen" | "virtuell";
        openings?: Uuid[];
      },
      {
        id: Uuid;
        start: Vec2;
        end: Vec2;
        height: number;
        thickness: number;
        kind: "massiv" | "offen" | "virtuell";
        openings?: Uuid[];
      },
      ...{
        id: Uuid;
        start: Vec2;
        end: Vec2;
        height: number;
        thickness: number;
        kind: "massiv" | "offen" | "virtuell";
        openings?: Uuid[];
      }[],
    ];
    /**
     * Wird aus den Wand-Segmenten ABGELEITET/validiert, nicht doppelt gepflegt.
     */
    floor: {
      /**
       * @minItems 3
       */
      polygon: [Vec2, Vec2, Vec2, ...Vec2[]];
      area?: number;
    };
    ceiling: {
      height: number;
    };
  };
  openings: {
    id: Uuid;
    type: "door" | "window";
    hostWall: Uuid;
    /**
     * Abstand des Öffnungs-Anfangs vom Wand-Start entlang der Wand (m).
     */
    offset: number;
    width: number;
    height: number;
    /**
     * Brüstungshöhe; Türen: 0.
     */
    sill: number;
  }[];
  /**
   * Funktionsbereiche innerhalb einer Hülle (Grossraum). Regeln gelten pro Zone.
   */
  zones: {
    id: Uuid;
    name: string;
    roomType: RoomType;
    /**
     * @minItems 3
     */
    polygon: [Vec2, Vec2, Vec2, ...Vec2[]];
  }[];
  /**
   * Anschlüsse – die Brücke zu den harten connection-Regeln. Standort genügt.
   */
  fixpoints: {
    id: Uuid;
    type: AnschlussTyp;
    position: Vec2;
    wall?: Uuid;
    heightFromFloor?: number;
    mount: "wand" | "boden";
    origin: "bestand" | "vorwand" | "manuell";
    zone?: Uuid | null;
  }[];
  /**
   * Erkannte Bestandsobjekte (für Umbau ggf. entfernen/behalten).
   */
  objects: {
    id: Uuid;
    label: string;
    geometry: {
      repr: "bbox" | "mesh-simpl" | "voxel";
      bbox: Masse;
      meshRef?: string;
    };
    pose: Pose;
    movable: boolean;
    confidence: number;
    needsReview?: boolean;
  }[];
  meta: {
    captureMethod: "ar" | "sfm" | "plan" | "sample" | "manuell";
    coverageScore?: number;
    estimatedError_cm: number;
    /**
     * Nutzer hat Masse bestätigt → Unsicherheits-Marge der Konfidenz-Ampel wird 0.
     */
    geometryConfirmed: boolean;
    geometryRef?: string;
  };
}
export interface Masse {
  w: number;
  d: number;
  h: number;
}
export interface Pose {
  pos: Vec2;
  /**
   * Rotation um y in Grad (POC: 2D-Top-Down).
   */
  yawDeg: number;
}
