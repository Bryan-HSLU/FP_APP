/** Reine Geometrie-Logik des Scan-Korrektur-Modus (M7, Scan-Fahrplan Schritt 6).
 *
 *  Gescannte Räume (captureMethod "ar", ~8.5 cm Unsicherheit ohne LiDAR) werden
 *  nutzergeführt korrigiert: Ecken ziehen mit Snapping (macht Wände rechtwinklig
 *  = das Anti-8.5-cm-Werkzeug), Öffnungen prüfen, Anschlüsse setzen (der Scan
 *  erkennt keine → fixpoints leer), erkannte Objekte bestätigen/entfernen
 *  (needsReview). Bewusst DOM-frei und ohne React – so testbar (korrektur.test.ts)
 *  und von der UI (ScanKorrektur.tsx) getrennt.
 *
 *  Fachliche Vorgabe: Brain → M2-M7-Scan-Pipeline-Fahrplan (Schritt 6),
 *  ADR-0003 (Korrektur-Modus). Server-Vertrag: fp_engines/scan/adapter.py
 *  (Wände NICHT garantiert in Umlauf-Reihenfolge, Objekte needsReview=true,
 *  fixpoints=[], meta.geometryConfirmed=false).
 *  Konvention: y-up, rechtshändig, Meter; Grundriss in der x/z-Ebene.
 */
import type { Vec2 } from "@fp/shared/rules";
import { shoelaceFlaeche, wandLaenge } from "./raumbau";

/** Schlanke Wand-Sicht für die Geometrie: nur Identität + Endpunkte. */
export interface KWand {
  id: string;
  start: Vec2;
  end: Vec2;
}

/** Ein Wand-Endpunkt, der an einer Ecke hängt. */
export interface EckenEnde {
  wallId: string;
  welches: "start" | "end";
}

/** Ein eindeutiger Eckpunkt und alle an ihm hängenden Wand-Endpunkte. */
export interface Ecke {
  position: Vec2;
  enden: EckenEnde[];
}

/** Ergebnis der Polygon-Verkettung: ehrlicher Fehler statt Wurf (UI blockt). */
export interface KettenErgebnis {
  ok: boolean;
  polygon: Vec2[];
  fehler?: string;
}

// --- Scan-Raum-Sicht (rich, entkoppelt vom minimalen RoomInput-Typ der App) ---
// Der App-`Room`-Typ ist strukturell minimal; der Scan liefert zur Laufzeit das
// volle Raummodell. Diese Typen modellieren die Felder, die der Korrektur-Modus
// liest/schreibt – die UI castet an der Grenze (Room ↔ ScanRaum).

export interface ScanWand {
  id: string;
  start: Vec2;
  end: Vec2;
  height: number;
  thickness: number;
  kind: string;
  openings?: string[];
}

export interface ScanOeffnung {
  id: string;
  type: "door" | "window";
  hostWall: string;
  offset: number;
  width: number;
  height: number;
  sill: number;
}

export interface ScanFixpunkt {
  id: string;
  type: string;
  position: Vec2;
  wall?: string;
  heightFromFloor?: number;
  mount?: string;
  origin?: string;
  zone?: string | null;
}

export interface ScanObjekt {
  id: string;
  label: string;
  geometry: { repr?: string; bbox: { w: number; d: number; h: number }; meshRef?: string };
  pose: { pos: Vec2; yawDeg: number };
  movable?: boolean;
  confidence?: number;
  needsReview?: boolean;
}

export interface ScanRaum {
  id: string;
  schemaVersion?: string;
  name: string;
  roomType: string;
  source?: string;
  units?: string;
  shell: {
    walls: ScanWand[];
    floor: { polygon: Vec2[]; area?: number };
    ceiling: { height: number };
  };
  openings: ScanOeffnung[];
  zones?: unknown[];
  fixpoints: ScanFixpunkt[];
  objects: ScanObjekt[];
  meta: {
    captureMethod?: string;
    coverageScore?: number;
    estimatedError_cm?: number;
    geometryConfirmed: boolean;
    geometryRef?: string;
  };
  [k: string]: unknown;
}

export type ObjektEntscheidung = "bestaetigt" | "entfernt";

const EPS = 1e-4;

/** Auf 2 Dezimalstellen runden (Muster `runde` in raumbau.ts, cm-genau).
 *  +0 verhindert -0 in den Koordinaten (sonst stolpern Vergleiche/Tests). */
function runde(n: number): number {
  return Math.round(n * 100) / 100 + 0;
}

function rundePunkt(p: Vec2): Vec2 {
  return [runde(p[0]), runde(p[1])];
}

function abstand(a: Vec2, b: Vec2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Eindeutige Eckpunkte aus den Wand-Endpunkten ableiten (Punkt-Gleichheit mit
 *  Epsilon). WICHTIG: geht NUR über Positions-Gleichheit – die Wand-Array-
 *  Reihenfolge ist beim Scan nicht garantiert sequenziell. Jede Ecke kennt, welche
 *  Wand-Endpunkte (wallId + start/end) an ihr hängen. */
export function ecken(walls: KWand[], eps = EPS): Ecke[] {
  const result: Ecke[] = [];
  const zufuegen = (p: Vec2, ende: EckenEnde) => {
    let ecke = result.find((r) => abstand(r.position, p) <= eps);
    if (!ecke) {
      ecke = { position: p, enden: [] };
      result.push(ecke);
    }
    ecke.enden.push(ende);
  };
  for (const w of walls) {
    zufuegen(w.start, { wallId: w.id, welches: "start" });
    zufuegen(w.end, { wallId: w.id, welches: "end" });
  }
  return result;
}

/** Alle an einer Ecke hängenden Wand-Endpunkte auf `neuePosition` verschieben →
 *  neue walls (die angrenzenden Wände wandern mit). */
export function verschiebeEcke(walls: KWand[], ecke: Ecke, neuePosition: Vec2): KWand[] {
  return walls.map((w) => {
    let { start, end } = w;
    for (const ende of ecke.enden) {
      if (ende.wallId !== w.id) continue;
      if (ende.welches === "start") start = neuePosition;
      else end = neuePosition;
    }
    return { ...w, start, end };
  });
}

/** Die Nachbar-Ecken einer Ecke: das jeweils GEGENÜBERLIEGENDE Ende jeder an ihr
 *  hängenden Wand. Diese Punkte speisen das Achsen-Snapping beim Ziehen. */
export function nachbarPunkte(ecke: Ecke, walls: KWand[]): Vec2[] {
  const res: Vec2[] = [];
  for (const ende of ecke.enden) {
    const w = walls.find((x) => x.id === ende.wallId);
    if (!w) continue;
    res.push(ende.welches === "start" ? w.end : w.start);
  }
  return res;
}

/** Snapping eines gezogenen Punkts:
 *  1. Achsen-Snap – liegt eine Nachbar-Ecke in x (bzw. z) näher als `achsTol`,
 *     übernimm deren x (bzw. z). Das richtet die Wand rechtwinklig aus und ist
 *     das eigentliche Gegenmittel zur ~8.5-cm-Scan-Ungenauigkeit.
 *  2. Rest (die nicht gesnappte Achse) auf das 5-cm-Raster runden.
 *  Achsen werden unabhängig behandelt (eine kann snappen, die andere rastern). */
export function snappe(punkt: Vec2, nachbarEcken: Vec2[], grid = 0.05, achsTol = 0.07): Vec2 {
  let bestX: number | null = null;
  let bestXd = achsTol;
  let bestZ: number | null = null;
  let bestZd = achsTol;
  for (const n of nachbarEcken) {
    const dx = Math.abs(n[0] - punkt[0]);
    if (dx < bestXd) {
      bestXd = dx;
      bestX = n[0];
    }
    const dz = Math.abs(n[1] - punkt[1]);
    if (dz < bestZd) {
      bestZd = dz;
      bestZ = n[1];
    }
  }
  const x = bestX !== null ? bestX : Math.round(punkt[0] / grid) * grid;
  const z = bestZ !== null ? bestZ : Math.round(punkt[1] / grid) * grid;
  return rundePunkt([x, z]);
}

/** Wand-Segmente zum geschlossenen Boden-Polygon verketten.
 *  Analog `_kette` in adapter.py: Start bei Wand 0, jeweils die Wand finden,
 *  deren Endpunkt dem aktuellen Kettenende entspricht (Epsilon-Vergleich).
 *  Schliesst der Umlauf nicht, wird ein Fehler-Objekt zurückgegeben statt
 *  geworfen – die UI blockt dann «Übernehmen» statt abzustürzen. */
export function kettePolygon(walls: KWand[], eps = EPS): KettenErgebnis {
  if (walls.length < 3) {
    return { ok: false, polygon: [], fehler: `Zu wenige Wände (${walls.length}) für eine Hülle.` };
  }
  const segmente = walls.map((w) => [w.start, w.end] as [Vec2, Vec2]);
  const erste = segmente[0];
  if (!erste) return { ok: false, polygon: [], fehler: "Keine Wände." };
  const offen = new Set<number>();
  for (let i = 1; i < segmente.length; i++) offen.add(i);
  const kette: Vec2[] = [erste[0], erste[1]];
  while (offen.size > 0) {
    let treffer: { index: number; naechstes: Vec2 } | null = null;
    const ende = kette[kette.length - 1];
    if (!ende) break;
    for (const i of offen) {
      const seg = segmente[i];
      if (!seg) continue;
      const [start, stop] = seg;
      if (abstand(start, ende) <= eps) {
        treffer = { index: i, naechstes: stop };
        break;
      }
      if (abstand(stop, ende) <= eps) {
        treffer = { index: i, naechstes: start };
        break;
      }
    }
    if (!treffer) {
      return {
        ok: false,
        polygon: [],
        fehler: "Wand-Hülle nicht geschlossen: kein Anschluss-Segment am Kettenende.",
      };
    }
    offen.delete(treffer.index);
    kette.push(treffer.naechstes);
  }
  const anfang = kette[0];
  const schluss = kette[kette.length - 1];
  if (!anfang || !schluss || abstand(anfang, schluss) > eps) {
    return {
      ok: false,
      polygon: [],
      fehler: "Wand-Hülle nicht geschlossen: Kettenende trifft den Anfang nicht.",
    };
  }
  return { ok: true, polygon: kette.slice(0, -1) };
}

/** Normierter Parameter t∈[0,1] der Projektion von p auf die Strecke a→b. */
function projektT(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz || 1;
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2;
  return Math.max(0, Math.min(1, t));
}

function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Wendet die Korrektur an und baut ein neues, schema-valides Raummodell:
 *  - walls: neue Endpunkte (Länge ergibt sich neu), height/thickness/kind bleiben,
 *    openings-Rückverweise werden neu aus den Öffnungen aufgebaut.
 *  - openings: offset auf [0, laenge−width] geclampt (width > laenge → offset 0,
 *    Öffnung bleibt, die UI zeigt den Fehler via pruefeOeffnung).
 *  - fixpoints: relative Position erhalten – t = Projektion der ALTEN position auf
 *    die alte Wandachse, neue position = start + t·(end−start) der NEUEN Wand.
 *  - floor: Polygon neu verkettet + Fläche (Shoelace); bei offener Hülle bleibt
 *    das alte Polygon (die UI ruft wendeAn ohnehin nur bei geschlossener Hülle).
 *  - objects: bestätigte → needsReview:false, entfernte raus, unberührte bleiben.
 *  - meta.geometryConfirmed → true (Konfidenz-Ampel rechnet dann ohne Marge).
 *  Alles auf 2 Dezimalstellen gerundet; alle IDs bleiben stabil. */
export function wendeAn(
  room: ScanRaum,
  walls: KWand[],
  openings: ScanOeffnung[],
  fixpunkte: ScanFixpunkt[],
  objektEntscheidungen: Record<string, ObjektEntscheidung>,
): ScanRaum {
  const neueWandById = new Map(walls.map((w) => [w.id, w]));

  // Öffnungen clampen + auf 2 Dezimalstellen runden.
  const openingsOut: ScanOeffnung[] = openings.map((o) => {
    const nw = neueWandById.get(o.hostWall);
    const laenge = nw ? wandLaenge(nw.start, nw.end) : 0;
    const maxOff = Math.max(0, laenge - o.width);
    const offset = Math.min(Math.max(o.offset, 0), maxOff);
    return {
      id: o.id,
      type: o.type,
      hostWall: o.hostWall,
      offset: runde(offset),
      width: runde(o.width),
      height: runde(o.height),
      sill: runde(o.sill),
    };
  });

  // Rückverweise Wand → Öffnungen neu aufbauen.
  const openingsProWand = new Map<string, string[]>();
  for (const o of openingsOut) {
    const arr = openingsProWand.get(o.hostWall) ?? [];
    arr.push(o.id);
    openingsProWand.set(o.hostWall, arr);
  }

  // Wände: neue Endpunkte, alles andere (height/thickness/kind) erhalten.
  const wallsOut: ScanWand[] = room.shell.walls.map((rw) => {
    const nw = neueWandById.get(rw.id);
    const start = nw ? rundePunkt(nw.start) : rundePunkt(rw.start);
    const end = nw ? rundePunkt(nw.end) : rundePunkt(rw.end);
    return { ...rw, start, end, openings: openingsProWand.get(rw.id) ?? [] };
  });

  // Boden-Polygon + Fläche neu (Fallback auf altes Polygon bei offener Hülle).
  const kette = kettePolygon(walls);
  const polygon = (kette.ok ? kette.polygon : room.shell.floor.polygon).map(rundePunkt);
  const area = runde(shoelaceFlaeche(polygon));

  // Fixpunkte: relatives t auf der alten Wandachse → neue Wandachse.
  const alteWandById = new Map(room.shell.walls.map((w) => [w.id, w]));
  const fixpointsOut: ScanFixpunkt[] = fixpunkte.map((f) => {
    let position = f.position;
    const alteWand = f.wall !== undefined ? alteWandById.get(f.wall) : undefined;
    const neueWand = f.wall !== undefined ? neueWandById.get(f.wall) : undefined;
    if (alteWand && neueWand) {
      const t = projektT(f.position, alteWand.start, alteWand.end);
      position = lerp(neueWand.start, neueWand.end, t);
    }
    const out: ScanFixpunkt = {
      id: f.id,
      type: f.type,
      position: rundePunkt(position),
      mount: f.mount ?? "wand",
      origin: f.origin ?? "manuell",
      zone: f.zone ?? null,
    };
    if (f.wall !== undefined) out.wall = f.wall;
    if (f.heightFromFloor !== undefined) out.heightFromFloor = runde(f.heightFromFloor);
    return out;
  });

  // Objekte: entfernte raus, bestätigte needsReview:false, Rest unverändert.
  const objectsOut: ScanObjekt[] = room.objects
    .filter((o) => objektEntscheidungen[o.id] !== "entfernt")
    .map((o) =>
      objektEntscheidungen[o.id] === "bestaetigt" ? { ...o, needsReview: false } : { ...o },
    );

  return {
    ...room,
    shell: {
      ...room.shell,
      walls: wallsOut,
      floor: { ...room.shell.floor, polygon, area },
    },
    openings: openingsOut,
    fixpoints: fixpointsOut,
    objects: objectsOut,
    meta: { ...room.meta, geometryConfirmed: true },
  };
}
