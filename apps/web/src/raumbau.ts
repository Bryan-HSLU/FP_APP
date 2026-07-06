/** Reine Bau-Logik des manuellen Raum-Editors (dritte Erstellungsvariante).
 *
 *  Nimmt Form + Masse + Öffnungen + Anschlüsse und erzeugt daraus ein
 *  schema-valides Raummodell (packages/shared/schemas/raummodell.schema.json).
 *  Bewusst DOM-frei und ohne React – so testbar (raumbau.test.ts) und vom
 *  UI (RaumEditor.tsx) sauber getrennt.
 *
 *  Fachliche Vorgabe: Brain → vault/50_Umsetzung/Raum-Editor-Manuell.md.
 *  Konvention: y-up, rechtshändig, Meter; Grundriss in der x/z-Ebene, Umlauf
 *  wie das R1-WC-Fixture (raummodell.r1-wc.json): Start (0,0) → +x → +z → zurück.
 */
import type { Vec2 } from "@fp/shared/rules";

export type Grundform = "rechteck" | "l-form";

/** Nur diese Raumtypen haben Kataloge/Regeln → nur sie sind wählbar. */
export type RaumTyp = "bad" | "wohnen" | "kueche";

export type Anschlusstyp = "wasser" | "abwasser" | "elektro" | "starkstrom" | "lueftung";

/** Öffnungs-Vorgabe aus dem Editor – referenziert die Wand über ihren Index. */
export interface OeffnungsSpec {
  wandIndex: number;
  type: "door" | "window";
  /** Abstand des Öffnungs-Anfangs vom Wand-Start entlang der Wand (m). */
  offset: number;
  width: number;
  height: number;
  sill: number;
}

/** Anschluss-Vorgabe aus dem Editor – Punkt auf einer Wand (Offset ab Start). */
export interface FixpunktSpec {
  wandIndex: number;
  type: Anschlusstyp;
  /** Abstand entlang der Wand vom Wand-Start (m). */
  offset: number;
  heightFromFloor: number;
}

export interface RechteckParams {
  breite: number;
  tiefe: number;
}

/** L-Form = Rechteck minus Eck-Ausschnitt an der fixen Ecke (max x, max z). */
export interface LFormParams extends RechteckParams {
  ausschnittBreite: number;
  ausschnittTiefe: number;
}

export interface RaumbauEingabe {
  name: string;
  roomType: RaumTyp;
  form: Grundform;
  params: LFormParams;
  raumhoehe: number;
  oeffnungen: OeffnungsSpec[];
  fixpunkte: FixpunktSpec[];
}

/** Defaults laut Konzept: Tür 0.8×2.0 (sill 0), Fenster 1.2×1.0 (sill 0.9). */
export const OEFFNUNG_DEFAULT = {
  door: { width: 0.8, height: 2.0, sill: 0 },
  window: { width: 1.2, height: 1.0, sill: 0.9 },
} as const;

export const RAUMHOEHE_DEFAULT = 2.5;
export const WANDDICKE = 0.1;
export const FIXPUNKT_HOEHE_DEFAULT = 0.3;

/** Solver-Voraussetzungen je Raumtyp (fehlende Anschlüsse → Hinweis im UI). */
export const PFLICHT_ANSCHLUESSE: Record<RaumTyp, Anschlusstyp[]> = {
  bad: ["wasser", "abwasser"],
  kueche: ["wasser", "abwasser", "starkstrom", "elektro"],
  wohnen: [],
};

const FIXPUNKT_KUERZEL: Record<Anschlusstyp, string> = {
  wasser: "W",
  abwasser: "A",
  elektro: "E",
  starkstrom: "S",
  lueftung: "L",
};

export function anschlussKuerzel(typ: Anschlusstyp): string {
  return FIXPUNKT_KUERZEL[typ];
}

/** Auf mm runden – vermeidet Float-Rauschen (0.1+0.2) in den Koordinaten. */
function runde(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function rundePunkt(p: Vec2): Vec2 {
  return [runde(p[0]), runde(p[1])];
}

/** Eckpunkte des Grundriss-Polygons im Umlauf (wie R1-Fixture). */
export function grundrissPunkte(form: Grundform, p: LFormParams): Vec2[] {
  const { breite: b, tiefe: t } = p;
  if (form === "rechteck") {
    return [
      [0, 0],
      [b, 0],
      [b, t],
      [0, t],
    ];
  }
  // L-Form: Ausschnitt an der Ecke (max x, max z) – identische Topologie zu R1.
  const ab = p.ausschnittBreite;
  const at = p.ausschnittTiefe;
  const roh: Vec2[] = [
    [0, 0],
    [b, 0],
    [b, t - at],
    [b - ab, t - at],
    [b - ab, t],
    [0, t],
  ];
  return roh.map(rundePunkt);
}

/** Fläche eines einfachen Polygons (Gausssche Trapezformel), immer ≥ 0. */
export function shoelaceFlaeche(punkte: Vec2[]): number {
  let summe = 0;
  for (let i = 0; i < punkte.length; i++) {
    const a = punkte[i];
    const b = punkte[(i + 1) % punkte.length];
    if (!a || !b) continue; // Modulo garantiert Treffer – nur für strikte Indexzugriffe.
    summe += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(summe) / 2;
}

export function wandLaenge(start: Vec2, end: Vec2): number {
  return Math.hypot(end[0] - start[0], end[1] - start[1]);
}

/** Punkt auf einer Wand im Abstand `offset` (m) vom Wand-Start. */
export function punktAufWand(start: Vec2, end: Vec2, offset: number): Vec2 {
  const len = wandLaenge(start, end) || 1;
  const t = Math.max(0, Math.min(1, offset / len));
  return rundePunkt([start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t]);
}

/** Öffnung prüfen: passt sie (offset ≥ 0, breite > 0, offset+breite ≤ Wandlänge)?
 *  Rückgabe = Fehlertext oder null (= gültig). */
export function pruefeOeffnung(spec: OeffnungsSpec, laenge: number): string | null {
  if (spec.offset < 0) return "Offset darf nicht negativ sein.";
  if (spec.width <= 0) return "Breite muss > 0 sein.";
  if (spec.height <= 0) return "Höhe muss > 0 sein.";
  if (spec.sill < 0) return "Brüstung darf nicht negativ sein.";
  if (spec.offset + spec.width > laenge + 1e-6)
    return `Öffnung ragt über die Wand (${laenge.toFixed(2)} m) hinaus.`;
  return null;
}

/** Fehlende Pflicht-Anschlüsse für den Raumtyp (für den Solver-Hinweis im UI). */
export function fehlendeAnschluesse(roomType: RaumTyp, gesetzt: Anschlusstyp[]): Anschlusstyp[] {
  const vorhanden = new Set(gesetzt);
  return PFLICHT_ANSCHLUESSE[roomType].filter((a) => !vorhanden.has(a));
}

// --- Ergebnis-Typ: strukturell = Raummodell-Vertrag ------------------------

export interface RaummodellWand {
  id: string;
  start: Vec2;
  end: Vec2;
  height: number;
  thickness: number;
  kind: "massiv";
  openings: string[];
}

export interface RaummodellOeffnung {
  id: string;
  type: "door" | "window";
  hostWall: string;
  offset: number;
  width: number;
  height: number;
  sill: number;
}

export interface RaummodellFixpunkt {
  id: string;
  type: Anschlusstyp;
  position: Vec2;
  wall: string;
  heightFromFloor: number;
  mount: "wand";
  origin: "manuell";
  zone: null;
}

export interface Raummodell {
  id: string;
  schemaVersion: "0.1.0";
  name: string;
  roomType: RaumTyp;
  source: "manuell";
  units: "m";
  shell: {
    walls: RaummodellWand[];
    floor: { polygon: Vec2[]; area: number };
    ceiling: { height: number };
  };
  openings: RaummodellOeffnung[];
  zones: never[];
  fixpoints: RaummodellFixpunkt[];
  objects: never[];
  meta: {
    captureMethod: "manuell";
    estimatedError_cm: 0;
    geometryConfirmed: true;
  };
}

/** Baut aus einer Editor-Eingabe ein schema-valides Raummodell.
 *  Öffnungen/Fixpunkte mit ungültigem Wand-Index werden übersprungen. */
export function baueRaummodell(e: RaumbauEingabe): Raummodell {
  const punkte = grundrissPunkte(e.form, e.params);
  const hoehe = e.raumhoehe;

  // Wände = Segmente im Umlauf (letzte Wand schliesst zum Startpunkt zurück).
  const walls: RaummodellWand[] = punkte.map((start, i) => ({
    id: crypto.randomUUID(),
    start,
    // Modulo schliesst den Umlauf; ?? start nur für den strikten Indexzugriff.
    end: punkte[(i + 1) % punkte.length] ?? start,
    height: hoehe,
    thickness: WANDDICKE,
    kind: "massiv",
    openings: [],
  }));

  const openings: RaummodellOeffnung[] = [];
  for (const spec of e.oeffnungen) {
    const wand = walls[spec.wandIndex];
    if (!wand) continue;
    const id = crypto.randomUUID();
    openings.push({
      id,
      type: spec.type,
      hostWall: wand.id,
      offset: runde(spec.offset),
      width: runde(spec.width),
      height: runde(spec.height),
      sill: runde(spec.sill),
    });
    wand.openings.push(id); // Rückverweis Wand → Öffnung pflegen.
  }

  const fixpoints: RaummodellFixpunkt[] = [];
  for (const spec of e.fixpunkte) {
    const wand = walls[spec.wandIndex];
    if (!wand) continue;
    fixpoints.push({
      id: crypto.randomUUID(),
      type: spec.type,
      position: punktAufWand(wand.start, wand.end, spec.offset),
      wall: wand.id,
      heightFromFloor: runde(spec.heightFromFloor),
      mount: "wand",
      origin: "manuell",
      zone: null,
    });
  }

  return {
    id: crypto.randomUUID(),
    schemaVersion: "0.1.0",
    name: e.name.trim() || "Mein Raum",
    roomType: e.roomType,
    source: "manuell",
    units: "m",
    shell: {
      walls,
      floor: { polygon: punkte, area: runde(shoelaceFlaeche(punkte)) },
      ceiling: { height: hoehe },
    },
    openings,
    zones: [],
    fixpoints,
    objects: [],
    // Nutzer gibt die Masse selbst an → keine Scan-Unsicherheits-Marge.
    meta: { captureMethod: "manuell", estimatedError_cm: 0, geometryConfirmed: true },
  };
}
