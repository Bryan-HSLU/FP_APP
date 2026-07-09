import { footprint, overlapDepth, type Vec2 } from "@fp/shared/rules";
import { describe, expect, it } from "vitest";
import type { DressingItem, KatalogItem, Plan, Room } from "./api";
import { sceneDressing } from "./dressing";

// ── Inline-Fixtures (leichtgewichtig; nur die von der Engine gelesenen Felder) ──
const FLOOR: Vec2[] = [
  [0, 0],
  [3, 0],
  [3, 2.4],
  [0, 2.4],
];

const room = {
  roomType: "bad",
  shell: {
    walls: [
      { id: "w1", start: [0, 0], end: [3, 0] },
      { id: "w2", start: [3, 0], end: [3, 2.4] },
      { id: "w3", start: [3, 2.4], end: [0, 2.4] },
      { id: "w4", start: [0, 2.4], end: [0, 0] },
    ],
    floor: { polygon: FLOOR },
  },
  openings: [{ type: "door", hostWall: "w1", offset: 1.9, width: 0.8 }],
} as unknown as Room;

const lavabo: KatalogItem = {
  id: "lav",
  funktionsTyp: "lavabo",
  masse: { w: 0.6, d: 0.45, h: 0.15 },
} as unknown as KatalogItem;

const blocker: KatalogItem = {
  id: "blk",
  funktionsTyp: "schrank",
  masse: { w: 1.2, d: 1.2, h: 0.5 },
} as unknown as KatalogItem;

const catalog = [lavabo, blocker];

/** Plan mit zwei Lavabos an der Rückwand (Anker für Oberflächen-Deko). */
const plan = {
  placements: [
    { id: "p1", catalogItemId: "lav", pose: { pos: [0.7, 2.15], yawDeg: 180 }, mountHeight: 0.8 },
    { id: "p2", catalogItemId: "lav", pose: { pos: [2.3, 2.15], yawDeg: 180 }, mountHeight: 0.8 },
  ],
  meta: { seed: 1 },
} as unknown as Plan;

/** Plan, dessen vier grosse Objekte alle Raumecken belegen (Kollisions-Test). */
const planEckenVoll = {
  placements: [
    { id: "b1", catalogItemId: "blk", pose: { pos: [0.6, 0.6], yawDeg: 0 } },
    { id: "b2", catalogItemId: "blk", pose: { pos: [2.4, 0.6], yawDeg: 0 } },
    { id: "b3", catalogItemId: "blk", pose: { pos: [2.4, 1.8], yawDeg: 0 } },
    { id: "b4", catalogItemId: "blk", pose: { pos: [0.6, 1.8], yawDeg: 0 } },
  ],
  meta: { seed: 1 },
} as unknown as Plan;

const item = (
  id: string,
  funktionsTyp: string,
  anchorTypes: string[],
  platzierung: DressingItem["platzierung"],
  klasse: DressingItem["klasse"],
  masse: { w: number; d: number; h: number },
): DressingItem => ({
  id,
  schemaVersion: "0.1.0",
  name: id,
  roomTypes: ["bad"],
  klasse,
  funktionsTyp,
  anchorTypes,
  platzierung,
  masse,
  achsenTags: { temperatur: 0.4 },
  attributTags: [],
  assetStatus: "placeholder",
});

const seife = item("seife", "seifenspender", ["lavabo"], "auf_oberflaeche", "D", {
  w: 0.07,
  d: 0.07,
  h: 0.18,
});
// Anker "badmoebel" existiert im Plan NICHT → darf nie platziert werden.
const handtuch = item("handtuch", "handtuchstapel", ["badmoebel"], "auf_oberflaeche", "D", {
  w: 0.3,
  d: 0.22,
  h: 0.14,
});
const pflanze = item("pflanze", "badpflanze", ["ecke"], "freie_ecke", "B", {
  w: 0.24,
  d: 0.24,
  h: 0.55,
});
const items = [seife, handtuch, pflanze];

const warm = { styleVector: { temperatur: 1 } };
const kuehl = { styleVector: { temperatur: -1 } };

describe("sceneDressing – Determinismus", () => {
  it("liefert bei gleichem Seed exakt dieselben Platzierungen", () => {
    const a = sceneDressing(room, plan, catalog, warm, items, 1);
    const b = sceneDressing(room, plan, catalog, warm, items, 1);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("variiert die Platzierung mit dem Seed (aber bleibt deterministisch)", () => {
    const varianten = new Set<string>();
    for (let s = 1; s <= 8; s++) {
      varianten.add(JSON.stringify(sceneDressing(room, plan, catalog, warm, items, s)));
    }
    expect(varianten.size).toBeGreaterThan(1);
  });
});

describe("sceneDressing – stilabhängige Auswahl", () => {
  it("kippt Variante & Farbe je nach Stilprofil (warm ↔ kühl)", () => {
    const w = sceneDressing(room, plan, catalog, warm, items, 1).find(
      (p) => p.dressingItemId === "seife",
    );
    const k = sceneDressing(room, plan, catalog, kuehl, items, 1).find(
      (p) => p.dressingItemId === "seife",
    );
    expect(w?.variante).toBe("warm");
    expect(k?.variante).toBe("kuehl");
    expect(w?.farbe).not.toBe(k?.farbe);
  });
});

describe("sceneDressing – Anker-Bindung", () => {
  it("platziert nur Deko mit vorhandenem Anker (badmoebel fehlt → weg)", () => {
    const ids = sceneDressing(room, plan, catalog, warm, items, 1).map((p) => p.dressingItemId);
    expect(ids).toContain("seife");
    expect(ids).toContain("pflanze");
    expect(ids).not.toContain("handtuch");
  });
});

describe("sceneDressing – Klasse-B-Kollision", () => {
  it("überlappt mit Bodenobjekten (Klasse B) kein Möbel-Footprint", () => {
    const placementQuads = plan.placements.map((p) =>
      footprint([p.pose.pos[0], p.pose.pos[1]], lavabo.masse.w, lavabo.masse.d, p.pose.yawDeg),
    );
    // Nur Klasse B (Boden) muss kollisionsfrei sein; Klasse D sitzt bewusst AUF
    // den Möbeln und überlappt sie in der Draufsicht.
    const bodenDeko = sceneDressing(room, plan, catalog, warm, items, 4).filter(
      (p) => p.klasse === "B",
    );
    expect(bodenDeko.length).toBeGreaterThan(0);
    for (const platz of bodenDeko) {
      const fp = footprint(
        [platz.pos[0], platz.pos[2]],
        platz.masse.w,
        platz.masse.d,
        platz.yawDeg,
      );
      for (const q of placementQuads) expect(overlapDepth(fp, q)).toBeNull();
    }
  });

  it("lässt Bodenobjekte weg, wenn alle Ecken belegt sind", () => {
    const ids = sceneDressing(room, planEckenVoll, catalog, warm, [pflanze], 1).map(
      (p) => p.dressingItemId,
    );
    expect(ids).not.toContain("pflanze");
  });
});

describe("sceneDressing – Regressions-Guard (Plan bleibt unberührt)", () => {
  it("verändert den übergebenen Plan nicht (nur lesend)", () => {
    const snapshot = JSON.parse(JSON.stringify(plan));
    sceneDressing(room, plan, catalog, warm, items, 7);
    expect(JSON.parse(JSON.stringify(plan))).toEqual(snapshot);
  });
});
