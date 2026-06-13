import { describe, expect, it } from "vitest";
import { footprint, type Vec2 } from "@fp/shared/rules";
import { computeTransform, footprintPoints, innwardNormal, toScreen } from "./plan2d.ts";

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
