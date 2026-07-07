import { describe, expect, it } from "vitest";
import { footprint, type Vec2 } from "@fp/shared/rules";
import {
  computeTransform,
  distanz,
  footprintPoints,
  innwardNormal,
  naechsteEcke,
  rasten,
  toScreen,
  toWorld,
  wallQuad,
  wandEcken,
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
