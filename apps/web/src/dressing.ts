/** Scene-Dressing-Engine (rein visuelle Deko-Ebene, getrennt vom Plan).
 *
 *  Konzept: FP_Kopf/vault/50_Umsetzung/Scene-Dressing-Konzept.md
 *
 *  `sceneDressing(room, plan, catalog, styleProfile, seed)` leitet aus dem
 *  bestehenden Plan **Anker** ab (Oberflächen von Möbeln, freie Ecken, Wände)
 *  und platziert kleine Deko-Objekte daran – **deterministisch** (Seed-RNG),
 *  **stilabhängig** (Varianten-/Materialwahl per stilNaehe) und **ohne den Plan
 *  zu verändern**. Der Plan wird ausschliesslich GELESEN. Ergebnis ist eine
 *  eigene Struktur (`DressingPlatzierung[]`), die die 3D-Ebene rendert – sie
 *  fliesst NIE in placements/constraintReport/LV zurück (Solver-Invariante 0 ❌
 *  bleibt unberührt).
 */
import { footprint, overlapDepth, pointInPolygon, type Quad, type Vec2 } from "@fp/shared/rules";
import type { DressingItem, KatalogItem, Placement, Plan, Room } from "./api";
import { stilNaehe } from "./stilnaehe";

/** Stil-Variante eines Deko-Objekts (steuert Material/Farbe, nicht die Geometrie). */
export type DressingVariante = "warm" | "kuehl";

/** Ergebnis der Engine: eine visuelle Deko-Platzierung in Weltkoordinaten
 *  (y-up, Meter). `pos` ist die Objekt-**Mitte** (wie bei Moebel3D, Gruppe). */
export interface DressingPlatzierung {
  /** Deterministische, stabile ID (dressingItemId + Anker + Index). */
  id: string;
  dressingItemId: string;
  /** Bausatz-Schlüssel für dressing3d (= funktionsTyp des Deko-Objekts). */
  funktionsTyp: string;
  modell3d?: string;
  /** Welt-Mitte [x, y, z] (y = Höhe der Objektmitte). */
  pos: [number, number, number];
  yawDeg: number;
  masse: { w: number; d: number; h: number };
  /** Aufgelöste Basisfarbe (stilabhängig). */
  farbe: string;
  variante: DressingVariante;
  klasse: DressingItem["klasse"];
  assetStatus: "placeholder" | "modeled";
  gltfRef?: string;
}

// ── Seed-RNG (mulberry32) – deterministisch, NICHT Math.random ────────────────
/** Kleiner deterministischer 32-bit-RNG. Gleicher Seed ⇒ gleiche Sequenz. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Farb-Paletten (warm/kühl) je Deko-funktionsTyp ────────────────────────────
const DRESSING_FARBE: Record<string, { warm: string; kuehl: string }> = {
  seifenspender: { warm: "#D8C3A5", kuehl: "#C9CDD2" },
  zahnputzbecher: { warm: "#E3D5C0", kuehl: "#BFD3D9" },
  handtuchstapel: { warm: "#E8DCC8", kuehl: "#CBD6DD" },
  ablagetray: { warm: "#B9906B", kuehl: "#8C8F94" },
  badpflanze: { warm: "#6F8F6A", kuehl: "#7C948C" },
  // Wohnen-Deko
  buecherstapel: { warm: "#9C6B4A", kuehl: "#6E7A82" },
  vase: { warm: "#D9C7B0", kuehl: "#C2CBD0" },
  kerzenstaender: { warm: "#B8975B", kuehl: "#A9AEB2" },
  dekoschale: { warm: "#C2A579", kuehl: "#9BA1A6" },
  plaid: { warm: "#D8C4A0", kuehl: "#B7C2C8" },
  zimmerpflanze: { warm: "#5F8457", kuehl: "#6E877D" },
};
const DRESSING_FARBE_FALLBACK = { warm: "#C9A38A", kuehl: "#AEB4B8" };

/** Aus Deko-Achsen + Stilprofil eine Variante (warm/kühl) ableiten. Ohne Profil
 *  oder ohne gemeinsame Achse gilt die neutrale Warm-Variante. */
function waehleVariante(item: DressingItem, styleProfile: StilprofilLike | null): DressingVariante {
  const naehe = styleProfile ? stilNaehe(styleProfile.styleVector, item.achsenTags) : null;
  return (naehe ?? 0.5) >= 0.5 ? "warm" : "kuehl";
}

function farbeFuer(funktionsTyp: string, variante: DressingVariante): string {
  return (DRESSING_FARBE[funktionsTyp] ?? DRESSING_FARBE_FALLBACK)[variante];
}

/** Nur der vom Engine gelesene Teil eines Stilprofils. */
interface StilprofilLike {
  styleVector: Record<string, number>;
}

// ── Geometrie-Helfer ──────────────────────────────────────────────────────────
type Masse = { w: number; d: number; h: number };

/** Rotationsrichtungen eines Objekts: Front = lokal +z, rechts = Front um −90°. */
function achsen(yawDeg: number): { front: Vec2; rechts: Vec2 } {
  const r = (yawDeg * Math.PI) / 180;
  // frontDir wie im Regel-Interpreter: rotateY([0,1], yaw) = (sin, cos).
  const front: Vec2 = [Math.sin(r), Math.cos(r)];
  const rechts: Vec2 = [front[1], -front[0]];
  return { front, rechts };
}

/** Einheits-Innennormale einer Wand (zeigt ins Rauminnere). */
function innenNormale(a: Vec2, b: Vec2, floor: Vec2[]): Vec2 {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len;
  const uz = dz / len;
  const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  for (const s of [1, -1]) {
    const n: Vec2 = [-uz * s, ux * s];
    if (pointInPolygon([mid[0] + n[0] * 0.1, mid[1] + n[1] * 0.1], floor)) return n;
  }
  return [-uz, ux];
}

/** Ein aus dem Plan abgeleiteter Anker (Möbel-Oberfläche/Standfläche). */
interface MoebelAnker {
  placementId: string;
  funktionsTyp: string;
  center: Vec2;
  masse: Masse;
  yawDeg: number;
  mountHeight: number;
  /** Oberkante des Möbels (Weltnhöhe) = mountHeight + Höhe. */
  topY: number;
  fp: Quad;
}

/** Freie Raumecke als Anker (Boden). */
interface EckAnker {
  index: number;
  ecke: Vec2;
  /** Einheitsrichtung ins Rauminnere (Winkelhalbierende). */
  innen: Vec2;
}

/** Wandanker (für an_wand). */
interface WandAnker {
  wallId: string;
  center: Vec2;
  innen: Vec2;
  laenge: number;
  yawDeg: number;
}

function katalogKarte(catalog: KatalogItem[]): Map<string, KatalogItem> {
  return new Map(catalog.map((c) => [c.id, c]));
}

/** Alle Möbel-Anker aus dem Plan (per Katalog aufgelöst). */
function moebelAnker(placements: Placement[], byId: Map<string, KatalogItem>): MoebelAnker[] {
  const anker: MoebelAnker[] = [];
  for (const p of placements) {
    const item = byId.get(p.catalogItemId);
    if (!item) continue;
    const center: Vec2 = [p.pose.pos[0], p.pose.pos[1]];
    const mountHeight = p.mountHeight ?? 0;
    anker.push({
      placementId: p.id,
      funktionsTyp: item.funktionsTyp,
      center,
      masse: item.masse,
      yawDeg: p.pose.yawDeg,
      mountHeight,
      topY: mountHeight + item.masse.h,
      fp: footprint(center, item.masse.w, item.masse.d, p.pose.yawDeg),
    });
  }
  return anker;
}

/** Footprints aller Möbel im Plan (Hindernisse für Klasse-B-Kollision). */
function planFootprints(placements: Placement[], byId: Map<string, KatalogItem>): Quad[] {
  const quads: Quad[] = [];
  for (const p of placements) {
    const item = byId.get(p.catalogItemId);
    if (!item) continue;
    quads.push(
      footprint([p.pose.pos[0], p.pose.pos[1]], item.masse.w, item.masse.d, p.pose.yawDeg),
    );
  }
  return quads;
}

/** Tür-Zugangszonen (Rechtecke vor Türen) als zusätzliche Hindernisse. */
function tuerZonen(room: Room): Quad[] {
  const zonen: Quad[] = [];
  const floor = room.shell.floor.polygon as Vec2[];
  const wallById = new Map(room.shell.walls.map((w) => [w.id, w]));
  for (const o of room.openings) {
    if (o.type !== "door") continue;
    const wall = wallById.get(o.hostWall);
    if (!wall) continue;
    const a = wall.start as Vec2;
    const b = wall.end as Vec2;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) || 1;
    const u: Vec2 = [dx / len, dz / len];
    const n = innenNormale(a, b, floor);
    const mitte = o.offset + o.width / 2;
    const zentrum: Vec2 = [a[0] + u[0] * mitte, a[1] + u[1] * mitte];
    const halbBreite = o.width / 2 + 0.2;
    const tiefe = 0.6;
    // Rechteck an der Wand, tiefe nach innen (4 Ecken).
    const c1: Vec2 = [zentrum[0] - u[0] * halbBreite, zentrum[1] - u[1] * halbBreite];
    const c2: Vec2 = [zentrum[0] + u[0] * halbBreite, zentrum[1] + u[1] * halbBreite];
    const c3: Vec2 = [c2[0] + n[0] * tiefe, c2[1] + n[1] * tiefe];
    const c4: Vec2 = [c1[0] + n[0] * tiefe, c1[1] + n[1] * tiefe];
    zonen.push([c1, c2, c3, c4]);
  }
  return zonen;
}

/** Freie Ecken des Raumpolygons (Winkelhalbierende zeigt nach innen). */
function eckAnker(room: Room): EckAnker[] {
  const poly = room.shell.floor.polygon as Vec2[];
  const n = poly.length;
  const anker: EckAnker[] = [];
  for (let i = 0; i < n; i++) {
    const curr = poly[i] as Vec2;
    const prev = poly[(i - 1 + n) % n] as Vec2;
    const next = poly[(i + 1) % n] as Vec2;
    const toPrev = norm([prev[0] - curr[0], prev[1] - curr[1]]);
    const toNext = norm([next[0] - curr[0], next[1] - curr[1]]);
    let innen = norm([toPrev[0] + toNext[0], toPrev[1] + toNext[1]]);
    // Degenerierte (kollineare) Ecke: Normale einer Kante nach innen nehmen.
    if (innen[0] === 0 && innen[1] === 0) innen = innenNormale(prev, curr, poly);
    anker.push({ index: i, ecke: curr, innen });
  }
  return anker;
}

/** Wandanker (Wandmitte, Innennormale) für an_wand-Deko. */
function wandAnker(room: Room): WandAnker[] {
  const floor = room.shell.floor.polygon as Vec2[];
  return room.shell.walls.map((w) => {
    const a = w.start as Vec2;
    const b = w.end as Vec2;
    const center: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const innen = innenNormale(a, b, floor);
    const laenge = Math.hypot(b[0] - a[0], b[1] - a[1]);
    // Yaw so, dass Front (+z) = Innennormale: yaw = atan2(front.x, front.z).
    const yawDeg = (Math.atan2(innen[0], innen[1]) * 180) / Math.PI;
    return { wallId: w.id, center, innen, laenge, yawDeg };
  });
}

function norm(v: Vec2): Vec2 {
  const l = Math.hypot(v[0], v[1]);
  return l < 1e-9 ? [0, 0] : [v[0] / l, v[1] / l];
}

/** Kollidiert das Deko-Footprint mit einem der Hindernisse (Überlappung)? */
function kollidiert(fp: Quad, hindernisse: Quad[]): boolean {
  return hindernisse.some((h) => overlapDepth(fp, h) !== null);
}

/** Liegt das ganze Footprint im Raumpolygon? */
function imRaum(fp: Quad, floor: Vec2[]): boolean {
  return fp.every((ecke) => pointInPolygon(ecke, floor));
}

/**
 * Scene-Dressing für einen Raum. Deterministisch aus (room, plan, catalog,
 * styleProfile, seed). Verändert den übergebenen Plan NICHT (nur lesend).
 *
 * @param seed Wird aus `plan.meta.seed` gespeist (vom Aufrufer), damit das
 *   Dressing an denselben Plan-Seed gekoppelt ist – gleiche Deko je Plan.
 */
export function sceneDressing(
  room: Room,
  plan: Plan,
  catalog: KatalogItem[],
  styleProfile: StilprofilLike | null,
  dressingItems: DressingItem[],
  seed: number,
): DressingPlatzierung[] {
  const rng = mulberry32(seed);
  const byId = katalogKarte(catalog);
  const anker = moebelAnker(plan.placements, byId);
  const floor = room.shell.floor.polygon as Vec2[];
  const hindernisse = [...planFootprints(plan.placements, byId), ...tuerZonen(room)];
  const ecken = eckAnker(room);
  const waende = wandAnker(room);

  // Wie viele Deko-Objekte schon auf einem Möbel-Anker sitzen (zum Verteilen).
  const belegung = new Map<string, number>();
  // Bereits belegte Ecken (jede Ecke max. 1 Bodenobjekt).
  const eckenBelegt = new Set<number>();
  const ergebnis: DressingPlatzierung[] = [];

  for (const item of dressingItems) {
    if (!item.roomTypes.includes(room.roomType)) continue;
    const variante = waehleVariante(item, styleProfile);
    const farbe = farbeFuer(item.funktionsTyp, variante);
    const platz =
      item.platzierung === "freie_ecke"
        ? platziereEcke(item, ecken, eckenBelegt, hindernisse, floor, rng)
        : item.platzierung === "an_wand"
          ? platziereWand(item, waende, rng)
          : platziereMoebel(item, anker, belegung, floor, rng);
    if (!platz) continue; // Kein passender Anker → weglassen (nie erzwingen).
    ergebnis.push({
      id: `${item.id}:${platz.ankerRef}`,
      dressingItemId: item.id,
      funktionsTyp: item.funktionsTyp,
      modell3d: item.modell3d,
      pos: platz.pos,
      yawDeg: platz.yawDeg,
      masse: item.masse,
      farbe,
      variante,
      klasse: item.klasse,
      assetStatus: item.assetStatus,
      gltfRef: item.gltfRef,
    });
  }
  return ergebnis;
}

interface Platzierungsergebnis {
  pos: [number, number, number];
  yawDeg: number;
  ankerRef: string;
}

/** Deko auf/an einem Möbel (auf_oberflaeche = auf Oberkante, an_moebel = daneben). */
function platziereMoebel(
  item: DressingItem,
  anker: MoebelAnker[],
  belegung: Map<string, number>,
  floor: Vec2[],
  rng: () => number,
): Platzierungsergebnis | null {
  const kandidaten = anker.filter((a) => item.anchorTypes.includes(a.funktionsTyp));
  if (kandidaten.length === 0) return null;
  const a = kandidaten[Math.floor(rng() * kandidaten.length)] as MoebelAnker;
  const { front, rechts } = achsen(a.yawDeg);

  if (item.platzierung === "an_moebel") {
    // Bodenobjekt seitlich neben dem Möbel; Seite/kleine Streuung aus RNG.
    const seite = rng() < 0.5 ? 1 : -1;
    const gap = 0.04 + rng() * 0.04;
    const dist = a.masse.w / 2 + item.masse.w / 2 + gap;
    const pos: Vec2 = [
      a.center[0] + rechts[0] * dist * seite,
      a.center[1] + rechts[1] * dist * seite,
    ];
    // Muss im Raum liegen; sonst andere Seite versuchen.
    const fp = footprint(pos, item.masse.w, item.masse.d, a.yawDeg);
    if (!imRaum(fp, floor)) {
      const pos2: Vec2 = [
        a.center[0] - rechts[0] * dist * seite,
        a.center[1] - rechts[1] * dist * seite,
      ];
      if (!imRaum(footprint(pos2, item.masse.w, item.masse.d, a.yawDeg), floor)) return null;
      return {
        pos: [pos2[0], item.masse.h / 2, pos2[1]],
        yawDeg: a.yawDeg,
        ankerRef: a.placementId,
      };
    }
    return { pos: [pos[0], item.masse.h / 2, pos[1]], yawDeg: a.yawDeg, ankerRef: a.placementId };
  }

  // auf_oberflaeche: auf die Oberkante, seitlich verteilt (mehrere Objekte je Möbel).
  const idx = belegung.get(a.placementId) ?? 0;
  belegung.set(a.placementId, idx + 1);
  const spielraumSeit = Math.max(0, a.masse.w / 2 - item.masse.w / 2 - 0.02);
  const spielraumTief = Math.max(0, a.masse.d / 2 - item.masse.d / 2 - 0.02);
  // Verteilung: 1. Objekt Mitte, danach abwechselnd nach rechts/links gestaffelt.
  const stufe = Math.ceil(idx / 2) * 0.12 * (idx % 2 === 0 ? 1 : -1);
  const seit = Math.max(-spielraumSeit, Math.min(spielraumSeit, stufe + (rng() - 0.5) * 0.03));
  const tief = (rng() - 0.5) * 2 * spielraumTief * 0.4;
  const pos: Vec2 = [
    a.center[0] + rechts[0] * seit + front[0] * tief,
    a.center[1] + rechts[1] * seit + front[1] * tief,
  ];
  const yawDeg = a.yawDeg + (rng() - 0.5) * 20;
  return {
    pos: [pos[0], a.topY + item.masse.h / 2, pos[1]],
    yawDeg,
    ankerRef: `${a.placementId}#${idx}`,
  };
}

/** Deko in einer freien Raumecke (Boden, Klasse B → Kollisionsprüfung). */
function platziereEcke(
  item: DressingItem,
  ecken: EckAnker[],
  eckenBelegt: Set<number>,
  hindernisse: Quad[],
  floor: Vec2[],
  rng: () => number,
): Platzierungsergebnis | null {
  if (!item.anchorTypes.includes("ecke")) return null;
  // Ecken in deterministisch gemischter Reihenfolge durchprobieren.
  const reihenfolge = mischeIndex(ecken.length, rng);
  const halbDiag = Math.hypot(item.masse.w, item.masse.d) / 2;
  for (const i of reihenfolge) {
    const e = ecken[i] as EckAnker;
    if (eckenBelegt.has(e.index)) continue;
    // Yaw: Front zeigt aus der Ecke ins Rauminnere.
    const yawDeg = (Math.atan2(e.innen[0], e.innen[1]) * 180) / Math.PI;
    // Entlang der Winkelhalbierenden nach innen schieben, bis der (rotierte)
    // Footprint ganz im Raum liegt UND frei ist. Der Startabstand deckt einen
    // rechten Winkel nur knapp; bei spitzen Ecken/grossen Objekten poken die
    // Ecken sonst durch die Wand – darum inkrementell weiter reinrücken.
    let platz: { pos: Vec2; fp: Quad } | null = null;
    for (let dist = halbDiag + 0.06; dist <= halbDiag + 0.5; dist += 0.04) {
      const pos: Vec2 = [e.ecke[0] + e.innen[0] * dist, e.ecke[1] + e.innen[1] * dist];
      const fp = footprint(pos, item.masse.w, item.masse.d, yawDeg);
      if (!imRaum(fp, floor)) continue;
      if (kollidiert(fp, hindernisse)) continue;
      platz = { pos, fp };
      break;
    }
    if (!platz) continue;
    eckenBelegt.add(e.index);
    hindernisse.push(platz.fp); // belegt die Fläche für spätere Bodenobjekte
    return {
      pos: [platz.pos[0], item.masse.h / 2, platz.pos[1]],
      yawDeg,
      ankerRef: `ecke${e.index}`,
    };
  }
  return null;
}

/** Wandmontierte Deko (an_wand); Default-Montagehöhe, mittig an einer Wand. */
function platziereWand(
  item: DressingItem,
  waende: WandAnker[],
  rng: () => number,
): Platzierungsergebnis | null {
  if (!item.anchorTypes.includes("wand")) return null;
  const nutzbar = waende.filter((w) => w.laenge >= item.masse.w + 0.1);
  if (nutzbar.length === 0) return null;
  const w = nutzbar[Math.floor(rng() * nutzbar.length)] as WandAnker;
  const mountHeight = 1.1; // typische Accessoire-Höhe (Unterkante-Näherung)
  // Objekt bündig an die Wand-Innenseite (halbe Tiefe nach innen).
  const pos: Vec2 = [
    w.center[0] + w.innen[0] * (item.masse.d / 2),
    w.center[1] + w.innen[1] * (item.masse.d / 2),
  ];
  return {
    pos: [pos[0], mountHeight + item.masse.h / 2, pos[1]],
    yawDeg: w.yawDeg,
    ankerRef: `wand-${w.wallId}`,
  };
}

/** Deterministische Permutation [0..n) aus dem RNG (Fisher-Yates). */
function mischeIndex(n: number, rng: () => number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j] as number, arr[i] as number];
  }
  return arr;
}
