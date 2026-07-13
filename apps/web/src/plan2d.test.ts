import { describe, expect, it } from "vitest";
import { footprint, type Vec2 } from "@fp/shared/rules";
import {
  aussenPolygon,
  clearanceRect,
  computeTransform,
  distanz,
  footprintPoints,
  innwardNormal,
  naechsteEcke,
  rasten,
  toScreen,
  toWorld,
  wallQuad,
  wandBaender,
  wandEcken,
  wandLuecken,
  yawAusZeiger,
} from "./plan2d.ts";

const RAUM: Vec2[] = [
  [0, 0],
  [3, 0],
  [3, 2.4],
  [0, 2.4],
];

describe("computeTransform / toScreen", () => {
  it("füllt die längere Achse randbündig und hält gleichen Massstab", () => {
    const t = computeTransform(RAUM, 1000, 40);
    expect(t.scale).toBeCloseTo(920 / 3, 6); // 3 m ist die längere Achse
    // x-Spanne nutzt die volle Innenbreite [40, 960]
    expect(toScreen([0, 0], t)[0]).toBeCloseTo(40, 6);
    expect(toScreen([3, 0], t)[0]).toBeCloseTo(960, 6);
    // alle Ecken liegen im Rahmen
    for (const ecke of RAUM) {
      const [sx, sy] = toScreen(ecke, t);
      expect(sx).toBeGreaterThanOrEqual(40 - 1e-6);
      expect(sx).toBeLessThanOrEqual(960 + 1e-6);
      expect(sy).toBeGreaterThanOrEqual(40 - 1e-6);
      expect(sy).toBeLessThanOrEqual(960 + 1e-6);
    }
  });

  it("ist linear (gleicher Massstab in x und z)", () => {
    const t = computeTransform(RAUM, 1000, 40);
    const o = toScreen([0, 0], t);
    const p = toScreen([1, 1], t);
    expect(p[0] - o[0]).toBeCloseTo(t.scale, 6);
    expect(p[1] - o[1]).toBeCloseTo(t.scale, 6);
  });

  it("toWorld ist die exakte Umkehrung von toScreen", () => {
    const t = computeTransform(RAUM, 1000, 40);
    for (const welt of [
      [0, 0],
      [1.5, 1.2],
      [3, 2.4],
    ] as Vec2[]) {
      const zurueck = toWorld(toScreen(welt, t), t);
      expect(zurueck[0]).toBeCloseTo(welt[0], 9);
      expect(zurueck[1]).toBeCloseTo(welt[1], 9);
    }
  });
});

describe("footprintPoints", () => {
  it("achsparalleles Objekt (yaw 0) → achsparalleles Rechteck der Breite w·scale", () => {
    const t = computeTransform(RAUM, 1000, 40);
    const pts: [number, number][] = footprintPoints([1, 1], 0.4, 0.6, 0, t)
      .split(" ")
      .map((s) => {
        const teile = s.split(",");
        return [Number(teile[0]), Number(teile[1])];
      });
    expect(pts).toHaveLength(4);
    const [a, b, c] = pts as [[number, number], [number, number], [number, number]];
    // Ecken 0/1 teilen eine y-Kante, 1/2 eine x-Kante (achsparallel)
    expect(a[1]).toBeCloseTo(b[1], 6);
    expect(b[0]).toBeCloseTo(c[0], 6);
    expect(Math.abs(b[0] - a[0])).toBeCloseTo(0.4 * t.scale, 1);
    expect(Math.abs(c[1] - b[1])).toBeCloseTo(0.6 * t.scale, 1);
  });

  it("nutzt exakt die footprint()-Konvention von @fp/shared/rules", () => {
    const t = computeTransform(RAUM, 1000, 40);
    const erwartet = footprint([1.5, 1.2], 0.5, 0.3, 90)
      .map((e) =>
        toScreen(e, t)
          .map((n) => Math.round(n * 100) / 100)
          .join(","),
      )
      .join(" ");
    expect(footprintPoints([1.5, 1.2], 0.5, 0.3, 90, t)).toBe(erwartet);
  });
});

describe("innwardNormal", () => {
  it("zeigt von einer Wand ins Rauminnere", () => {
    // untere Wand [0,0]→[3,0]: Innenseite ist +z
    expect(innwardNormal([0, 0], [3, 0], RAUM)).toEqual([0, 1]);
    // obere Wand [3,2.4]→[0,2.4]: Innenseite ist −z
    expect(innwardNormal([3, 2.4], [0, 2.4], RAUM)).toEqual([0, -1]);
  });
});

describe("wallQuad", () => {
  it("erzeugt ein Rechteck der Länge×Dicke, mittig auf der Wandachse", () => {
    const q = wallQuad([0, 0], [3, 0], 0.1);
    expect(q).toHaveLength(4);
    // Dicke 0.1 → je 0.05 nach ±z
    expect(q).toEqual([
      [0, 0.05],
      [3, 0.05],
      [3, -0.05],
      [0, -0.05],
    ]);
  });

  it("steht senkrecht auf einer vertikalen Wand", () => {
    const q = wallQuad([0, 0], [0, 2], 0.2);
    // Wand entlang +z → Dicke entlang x (±0.1)
    for (const p of q) expect(Math.abs(p[0])).toBeCloseTo(0.1, 9);
  });
});

describe("aussenPolygon (CAD-Wände: Polygon = Innenkante, Stärke nach aussen)", () => {
  it("versetzt jede Ecke gehrungsgenau nach aussen (Rechteck)", () => {
    const outer = aussenPolygon(RAUM, 0.12);
    expect(outer).toHaveLength(4);
    // 3.0×2.4-Raum plus 0.12 rundum → [-0.12,-0.12] … [3.12,2.52]
    const erwartet: Vec2[] = [
      [-0.12, -0.12],
      [3.12, -0.12],
      [3.12, 2.52],
      [-0.12, 2.52],
    ];
    outer.forEach((p, i) => {
      const e = erwartet[i] as Vec2;
      expect(p[0]).toBeCloseTo(e[0], 9);
      expect(p[1]).toBeCloseTo(e[1], 9);
    });
  });

  it("Aussen-Bbox = Polygon + 2×thickness in beiden Dimensionen (Rechteck)", () => {
    const th = 0.12;
    const outer = aussenPolygon(RAUM, th);
    const xs = outer.map((p) => p[0]);
    const zs = outer.map((p) => p[1]);
    // Raum 3.0×2.4 → aussen 3.24×2.64
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(3 + 2 * th, 9);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(2.4 + 2 * th, 9);
  });

  it("das Aussenpolygon liegt vollständig ausserhalb der Kontur (jede Ecke weiter von der Mitte)", () => {
    const outer = aussenPolygon(RAUM, 0.2);
    const mitte: Vec2 = [1.5, 1.2];
    outer.forEach((p, i) => {
      const a = RAUM[i] as Vec2;
      const dAussen = Math.hypot(p[0] - mitte[0], p[1] - mitte[1]);
      const dPoly = Math.hypot(a[0] - mitte[0], a[1] - mitte[1]);
      expect(dAussen).toBeGreaterThan(dPoly);
    });
  });

  it("L-Form: eine einspringende (konkave) Ecke wird ebenfalls sauber versetzt (kein NaN)", () => {
    const L: Vec2[] = [
      [0, 0],
      [3, 0],
      [3, 1.5],
      [1.5, 1.5],
      [1.5, 3],
      [0, 3],
    ];
    const outer = aussenPolygon(L, 0.1);
    expect(outer).toHaveLength(6);
    for (const p of outer) {
      expect(Number.isFinite(p[0])).toBe(true);
      expect(Number.isFinite(p[1])).toBe(true);
    }
  });
});

describe("wandBaender (Wand-Band mit Innenkante auf der Polygon-Linie)", () => {
  const outer = aussenPolygon(RAUM, 0.12);
  const eck = new Map(RAUM.map((p, i) => [`${p[0]},${p[1]}`, outer[i]]));

  it("volle Wand: ein Band, Innenkante exakt auf der Wandachse (= Polygon-Linie)", () => {
    // untere Wand [0,0]→[3,0]; innen = +z ⇒ aussen = −z = [0,-1]
    const baender = wandBaender([0, 0], [3, 0], [0, -1], 0.12, [], eck.get("0,0"), eck.get("3,0"));
    expect(baender).toHaveLength(1);
    // Reihenfolge [innenA, innenB, aussenB, aussenA]
    const [iA, iB, aB, aA] = baender[0] as [Vec2, Vec2, Vec2, Vec2];
    expect(iA).toEqual([0, 0]); // Innenkante auf der Polygon-Linie z=0
    expect(iB).toEqual([3, 0]);
    // Aussenkante = Gehrungs-Ecken (nach aussen versetzt)
    expect(aB[1]).toBeCloseTo(-0.12, 9);
    expect(aA[1]).toBeCloseTo(-0.12, 9);
    // Ecken teilen sich die Aussenpunkte mit dem Aussenpolygon
    expect(aA).toEqual(outer[0]);
    expect(aB).toEqual(outer[1]);
  });

  it("mit Öffnung: zwei Bänder, Laibung senkrecht auf die Aussenkante versetzt", () => {
    const baender = wandBaender(
      [0, 0],
      [3, 0],
      [0, -1],
      0.12,
      [{ offset: 1, width: 0.8 }],
      eck.get("0,0"),
      eck.get("3,0"),
    );
    expect(baender).toHaveLength(2);
    const b0 = baender[0] as [Vec2, Vec2, Vec2, Vec2];
    const b1 = baender[1] as [Vec2, Vec2, Vec2, Vec2];
    // erstes Band bis zur Laibung x=1; [innenA, innenB, aussenB, aussenA]
    expect(b0[1]).toEqual([1, 0]); // Innenkante an der Laibung (auf der Linie)
    expect(b0[2]).toEqual([1, -0.12]); // Aussenkante = reiner Normalversatz
    // zweites Band ab x=1.8
    expect(b1[0]).toEqual([1.8, 0]);
    expect(b1[3]).toEqual([1.8, -0.12]);
  });

  it("benachbarte Wände teilen sich exakt denselben Aussen-Eckpunkt (keine Lücke)", () => {
    const unten = wandBaender([0, 0], [3, 0], [0, -1], 0.12, [], eck.get("0,0"), eck.get("3,0"));
    const rechts = wandBaender(
      [3, 0],
      [3, 2.4],
      [1, 0],
      0.12,
      [],
      eck.get("3,0"),
      eck.get("3,2.4"),
    );
    // Aussenpunkt der unteren Wand am Eck [3,0] == Aussenpunkt der rechten Wand dort
    const u0 = unten[0] as [Vec2, Vec2, Vec2, Vec2];
    const r0 = rechts[0] as [Vec2, Vec2, Vec2, Vec2];
    expect(u0[2]).toEqual(r0[3]); // aussenB (unten) == aussenA (rechts)
  });
});

describe("distanz / wandEcken / naechsteEcke", () => {
  it("misst euklidische Distanz in Metern", () => {
    expect(distanz([0, 0], [3, 4])).toBeCloseTo(5, 9);
  });

  it("sammelt alle Wand-Endpunkte", () => {
    const ecken = wandEcken([
      { start: [0, 0], end: [3, 0] },
      { start: [3, 0], end: [3, 2] },
    ]);
    expect(ecken).toHaveLength(4);
    expect(ecken).toContainEqual([3, 0]);
  });

  it("snappt einen nahen Punkt auf die Ecke, einen fernen nicht", () => {
    const ecken: Vec2[] = [
      [0, 0],
      [3, 0],
    ];
    expect(naechsteEcke([0.1, 0.05], ecken, 0.15)).toEqual([0, 0]); // < 15 cm → snap
    expect(naechsteEcke([1.5, 1], ecken, 0.15)).toEqual([1.5, 1]); // zu weit → unverändert
  });
});

describe("yawAusZeiger", () => {
  it("front lokal +z: Zeiger nach +z ⇒ 0°, nach +x ⇒ 90°", () => {
    const c: Vec2 = [1, 1];
    expect(yawAusZeiger(c, [1, 2], 15)).toBe(0); // +z
    expect(yawAusZeiger(c, [2, 1], 15)).toBe(90); // +x
    expect(yawAusZeiger(c, [1, 0], 15)).toBe(180); // −z
    expect(yawAusZeiger(c, [0, 1], 15)).toBe(270); // −x
  });

  it("rastet auf 15°-Schritte und normalisiert auf [0,360)", () => {
    const y = yawAusZeiger(
      [0, 0],
      [Math.sin((100 * Math.PI) / 180), Math.cos((100 * Math.PI) / 180)],
      15,
    );
    expect(y % 15).toBe(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThan(360);
  });
});

describe("rasten", () => {
  it("rundet auf 5-cm-Raster (Default)", () => {
    expect(rasten(1.23)).toBeCloseTo(1.25, 9);
    expect(rasten(1.21)).toBeCloseTo(1.2, 9);
  });
});

describe("clearanceRect", () => {
  it("yaw 0: Rechteck vor der Objekt-Front (+z), richtige Breite/Tiefe", () => {
    // Objekt bei [1,1], Tiefe d=0.6 → Front bei z=1.3; Zone 0.6 breit × 0.6 tief.
    const [c1, c2, c3, c4] = clearanceRect([1, 1], 0.6, 0, 0.6, 0.6);
    expect(c1).toEqual([0.7, 1.3]); // linke vordere Kante an der Front
    expect(c2).toEqual([1.3, 1.3]); // rechte vordere Kante an der Front
    expect(c3).toEqual([1.3, 1.9]); // rechte ferne Kante (0.6 m tief nach +z)
    expect(c4).toEqual([0.7, 1.9]);
    const xs = [c1, c2, c3, c4].map((p) => p[0]);
    const zs = [c1, c2, c3, c4].map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0.6, 9); // Breite
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(0.6, 9); // Tiefe
    expect(Math.min(...zs)).toBeGreaterThan(1); // liegt vor dem Zentrum (+z)
  });

  it("yaw 90: Front zeigt +x, die Zone ist entsprechend rotiert", () => {
    const [c1, c2, c3, c4] = clearanceRect([1, 1], 0.6, 90, 0.6, 0.6);
    // Front bei x=1.3; Tiefe erstreckt sich nach +x, Breite entlang z.
    expect(c1).toEqual([1.3, 1.3]);
    expect(c2).toEqual([1.3, 0.7]);
    expect(c3).toEqual([1.9, 0.7]);
    expect(c4).toEqual([1.9, 1.3]);
    const xs = [c1, c2, c3, c4].map((p) => p[0]);
    expect(Math.min(...xs)).toBeGreaterThan(1); // Zone vor dem Zentrum (+x)
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0.6, 9); // Tiefe in x
  });

  it("breite ≠ tiefe wird korrekt zugeordnet (Lavabo 0.7×0.6)", () => {
    const pts = clearanceRect([0, 0], 0.5, 0, 0.6, 0.7);
    const xs = pts.map((p) => p[0]);
    const zs = pts.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0.7, 9); // Breite
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(0.6, 9); // Tiefe
  });
});

describe("wandLuecken", () => {
  it("ohne Öffnung: ein Vollsegment über die ganze Wand", () => {
    const { segmente, luecken } = wandLuecken(3, []);
    expect(luecken).toEqual([]);
    expect(segmente).toEqual([{ a: 0, b: 3 }]);
  });

  it("eine Öffnung: zwei Segmente links/rechts der Lücke", () => {
    const { segmente, luecken } = wandLuecken(3, [{ offset: 1, width: 0.8 }]);
    expect(luecken).toEqual([{ a: 1, b: 1.8 }]);
    expect(segmente).toEqual([
      { a: 0, b: 1 },
      { a: 1.8, b: 3 },
    ]);
  });

  it("überlappende Öffnungen werden zu einer Lücke gemerged", () => {
    const { segmente, luecken } = wandLuecken(3, [
      { offset: 0.5, width: 0.5 },
      { offset: 0.8, width: 0.5 },
    ]);
    expect(luecken).toEqual([{ a: 0.5, b: 1.3 }]);
    expect(segmente).toEqual([
      { a: 0, b: 0.5 },
      { a: 1.3, b: 3 },
    ]);
  });

  it("clampt auf die Wandlänge (Öffnung ragt über das Wandende hinaus)", () => {
    const { segmente, luecken } = wandLuecken(3, [{ offset: 2.8, width: 0.5 }]);
    expect(luecken).toEqual([{ a: 2.8, b: 3 }]);
    expect(segmente).toEqual([{ a: 0, b: 2.8 }]);
  });
});
