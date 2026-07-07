/** Reiner Rechenkern des 3D-Viewers (testbar, ohne three/React).
 *
 *  Enthält die Kamera-Presets (aus der Raum-Bounding-Box abgeleitet), die
 *  Begehungs-Startpose und den Schrittvektor der First-Person-Bewegung. Bewusst
 *  DOM-/three-frei gehalten, damit die Geometrie ohne Renderer testbar bleibt –
 *  gleiche Linie wie `plan2d.ts` (2D-Kern) und `raum3d.ts` (Hüllen-Kern).
 *
 *  Konvention wie überall im Projekt: Grundriss in der x/z-Ebene, y-up, Meter.
 */
import type { Vec2 } from "@fp/shared/rules";

/** Augenhöhe der Begehungskamera (m) – Bryan-Vorgabe. */
export const AUGENHOEHE = 1.6;

/** Fallback-Raumhöhe (m), falls die Wände keine `height` tragen. */
export const RAUMHOEHE_FALLBACK = 2.4;

export type Ansichtspreset = "perspektive" | "draufsicht" | "front" | "seite";
export type Begehungsmodus = "orbit" | "begehung";

/** Achsparallele Bounding-Box eines Grundriss-Polygons plus Zentrum/Spannen. */
export interface RaumBBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  cx: number;
  cz: number;
  breite: number;
  tiefe: number;
}

/** Kamera-Pose als Position + Zielpunkt (beides Weltkoordinaten, Meter). */
export interface KameraPose {
  position: [number, number, number];
  target: [number, number, number];
}

/** Bounding-Box + Zentrum eines Grundriss-Polygons. Leeres Polygon → Nullbox. */
export function raumBBox(polygon: Vec2[]): RaumBBox {
  if (polygon.length === 0) {
    return { minX: 0, maxX: 0, minZ: 0, maxZ: 0, cx: 0, cz: 0, breite: 0, tiefe: 0 };
  }
  const xs = polygon.map((p) => p[0]);
  const zs = polygon.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    cx: (minX + maxX) / 2,
    cz: (minZ + maxZ) / 2,
    breite: maxX - minX,
    tiefe: maxZ - minZ,
  };
}

/**
 * Kamera-Pose für ein Ansichts-Preset, aus der Raum-BBox skaliert (grosse Räume
 * bekommen automatisch mehr Abstand). Der OrbitControls-Zielpunkt ist immer das
 * Raumzentrum.
 *
 * - perspektive: schräg von vorne-oben (heutige Kamera, jetzt raumproportional).
 * - draufsicht: senkrecht über dem Zentrum; ein winziger z-Versatz verhindert
 *   die Gimbal-Entartung (Blick exakt parallel zur up-Achse) von OrbitControls.
 * - front/seite: achsparallel auf halber Raumhöhe, mittig auf das Zentrum.
 */
export function presetKamera(
  bbox: RaumBBox,
  preset: Ansichtspreset,
  raumHoehe = RAUMHOEHE_FALLBACK,
): KameraPose {
  const { cx, cz, maxX, maxZ } = bbox;
  const spanne = Math.max(bbox.breite, bbox.tiefe, 1);
  const halbH = raumHoehe / 2;
  switch (preset) {
    case "draufsicht":
      return { position: [cx, spanne * 1.6 + 2, cz + 1e-3], target: [cx, 0, cz] };
    case "front":
      return { position: [cx, halbH, maxZ + spanne * 1.1 + 1], target: [cx, halbH, cz] };
    case "seite":
      return { position: [maxX + spanne * 1.1 + 1, halbH, cz], target: [cx, halbH, cz] };
    case "perspektive":
    default:
      return {
        position: [cx + spanne * 0.9, spanne * 0.85 + 1.2, cz + spanne * 0.9],
        target: [cx, halbH * 0.7, cz],
      };
  }
}

/** Startpose der Begehung: im Raumzentrum, Augenhöhe, Blick Richtung minZ-Wand. */
export function begehungStart(bbox: RaumBBox): KameraPose {
  return {
    position: [bbox.cx, AUGENHOEHE, bbox.cz],
    target: [bbox.cx, AUGENHOEHE, bbox.minZ - 1],
  };
}

/**
 * Bodenschritt der First-Person-Bewegung aus der Blickrichtung.
 *
 * `blickXZ` ist die auf die Bodenebene projizierte Blickrichtung der Kamera
 * (muss nicht normiert sein). `vor` (+vorwärts/−rückwärts) und `seit`
 * (+rechts/−links) sind je −1|0|1. Die Rechts-Achse ist die um −90° gedrehte
 * Vorwärts-Achse in der x/z-Ebene: Blick nach −z ⇒ rechts = +x (Osten).
 * Rückgabe: Weltversatz [dx, dz]; y bleibt konstant (Bodenhöhe halten).
 */
export function bewegungsDelta(blickXZ: Vec2, vor: number, seit: number, schritt: number): Vec2 {
  let [fx, fz] = blickXZ;
  const len = Math.hypot(fx, fz);
  if (len < 1e-9) return [0, 0];
  fx /= len;
  fz /= len;
  const rx = -fz; // Rechts-Achse = Vorwärts um −90° gedreht (x/z-Ebene)
  const rz = fx;
  return [(fx * vor + rx * seit) * schritt, (fz * vor + rz * seit) * schritt];
}

/**
 * Kamera-Blickrichtung (auf den Boden projiziert) aus Yaw/Pitch der Begehung.
 * Yaw 0 blickt nach −z (Startrichtung), positiver Yaw dreht nach rechts (zu +x).
 * Nur die x/z-Komponenten – die Bewegung bleibt in der Bodenebene.
 */
export function blickRichtung(yaw: number): Vec2 {
  return [Math.sin(yaw), -Math.cos(yaw)];
}
