/**
 * Szenen-Aufbau: Raummodell + Plan + Katalog → auswertbare Szene.
 *
 * Der Interpreter rechnet nie direkt auf den Artefakten, sondern auf einer
 * aufgelösten Szene (Footprints aus Katalog-Massen bzw. Bestands-bboxen).
 * Platzierungen referenzieren nur catalogItemId – Geometrie kommt IMMER aus
 * dem Katalog (Box-Platzhalter mit Auto-Upgrade, Schema-Spezifikation).
 *
 * ⚠️ PARITÄT: 1:1 gespiegelt in fp_engines/rules/scene.py.
 */
import { footprint, type Quad, type Vec2 } from "./geometry.ts";

/** Minimale Sicht auf die Artefakte (strukturell kompatibel zu den generierten Typen). */
export interface RoomInput {
  roomType: string;
  shell: {
    walls: {
      id: string;
      start: Vec2;
      end: Vec2;
      kind: string;
    }[];
    floor: { polygon: Vec2[] };
  };
  openings: {
    id: string;
    type: string;
    hostWall: string;
    offset: number;
    width: number;
    sill: number;
  }[];
  fixpoints: { id: string; type: string; position: Vec2 }[];
  objects: {
    id: string;
    label: string;
    geometry: { bbox: { w: number; d: number; h: number } };
    pose: { pos: Vec2; yawDeg: number };
  }[];
  meta: { estimatedError_cm: number; geometryConfirmed: boolean };
}

export interface PlanInput {
  placements: {
    id: string;
    catalogItemId: string;
    pose: { pos: Vec2; yawDeg: number };
    mountHeight?: number;
  }[];
  meta: { normProfile: string };
}

export interface CatalogItemInput {
  id: string;
  funktionsTyp: string;
  masse: { w: number; d: number; h: number };
  mount?: string;
  anschluesse: string[];
}

/** Ein auswertbares Objekt der Szene (Platzierung ODER Bestandsobjekt). */
export interface SceneObject {
  id: string;
  funktionsTyp: string;
  quad: Quad;
  center: Vec2;
  yawDeg: number;
  w: number;
  d: number;
  h: number;
  mount: string;
  mountHeight: number | null;
  anschluesse: string[];
  isPlacement: boolean;
}

export interface Scene {
  roomType: string;
  floor: Vec2[];
  walls: RoomInput["shell"]["walls"];
  openings: RoomInput["openings"];
  fixpoints: RoomInput["fixpoints"];
  objects: SceneObject[];
  normProfile: string;
  /** Unsicherheits-Marge der Konfidenz-Ampel in cm (0, wenn Geometrie bestätigt). */
  margeCm: number;
}

export function buildScene(room: RoomInput, plan: PlanInput, catalog: CatalogItemInput[]): Scene {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const objects: SceneObject[] = [];

  for (const p of plan.placements) {
    const item = byId.get(p.catalogItemId);
    if (!item) throw new Error(`Placement ${p.id}: Katalog-Item ${p.catalogItemId} fehlt`);
    objects.push({
      id: p.id,
      funktionsTyp: item.funktionsTyp,
      quad: footprint(p.pose.pos, item.masse.w, item.masse.d, p.pose.yawDeg),
      center: p.pose.pos,
      yawDeg: p.pose.yawDeg,
      w: item.masse.w,
      d: item.masse.d,
      h: item.masse.h,
      mount: item.mount ?? "boden",
      mountHeight: p.mountHeight ?? null,
      anschluesse: item.anschluesse,
      isPlacement: true,
    });
  }

  for (const o of room.objects) {
    objects.push({
      id: o.id,
      funktionsTyp: o.label,
      quad: footprint(o.pose.pos, o.geometry.bbox.w, o.geometry.bbox.d, o.pose.yawDeg),
      center: o.pose.pos,
      yawDeg: o.pose.yawDeg,
      w: o.geometry.bbox.w,
      d: o.geometry.bbox.d,
      h: o.geometry.bbox.h,
      mount: "boden",
      mountHeight: null,
      anschluesse: [],
      isPlacement: false,
    });
  }

  return {
    roomType: room.roomType,
    floor: room.shell.floor.polygon,
    walls: room.shell.walls,
    openings: room.openings,
    fixpoints: room.fixpoints,
    objects,
    normProfile: plan.meta.normProfile,
    margeCm: room.meta.geometryConfirmed ? 0 : room.meta.estimatedError_cm,
  };
}
