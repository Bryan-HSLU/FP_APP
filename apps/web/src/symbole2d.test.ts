import { describe, expect, it } from "vitest";
import type { Vec2 } from "@fp/shared/rules";
import { computeTransform } from "./plan2d.ts";
import { hatSymbol, symbolScreenPrims } from "./symbole2d.ts";

const RAUM: Vec2[] = [
  [0, 0],
  [3, 0],
  [3, 2.4],
  [0, 2.4],
];
const T = computeTransform(RAUM, 1000, 40);

// Alle im Katalog verwendeten funktionsTypen (data/catalog/*.json) – jeder MUSS
// ein 2D-Symbol haben, damit kein Objekt auf die reine Box zurückfällt.
const KATALOG_TYPEN = [
  // bad
  "badmoebel",
  "badteppich",
  "dusche",
  "handtuchheizung",
  "handtuchstange",
  "hochschrank",
  "lavabo",
  "pflanze",
  "regal",
  "spiegel",
  "wandleuchte",
  "wc",
  // kueche
  "deko",
  "dunstabzug",
  "eckschrank",
  "fuellstueck",
  "geschirrspueler",
  "haengeschrank",
  "kochfeld",
  "kuehlschrank",
  "spuele",
  "unterschrank",
  // wohnen
  "beistelltisch",
  "couchtisch",
  "esstisch",
  "sideboard",
  "sofa",
  "stehleuchte",
  "teppich",
  "tvmoebel",
  "wandbild",
];

describe("hatSymbol / Katalog-Abdeckung", () => {
  it("deckt alle Katalog-funktionsTypen ab (kein Box-Fallback)", () => {
    for (const typ of KATALOG_TYPEN) {
      expect(hatSymbol(typ), `Symbol fehlt für ${typ}`).toBe(true);
    }
  });

  it("unbekannter Typ hat kein Symbol → Fallback", () => {
    expect(hatSymbol("gibtsnicht")).toBe(false);
    expect(symbolScreenPrims("gibtsnicht", [1, 1], 0.5, 0.5, 0, T)).toBeNull();
  });
});

describe("symbolScreenPrims", () => {
  it("liefert für ein WC mehrere projizierte Primitive", () => {
    const prims = symbolScreenPrims("wc", [1.5, 1.2], 0.4, 0.6, 0, T);
    expect(prims).not.toBeNull();
    expect(prims!.length).toBeGreaterThanOrEqual(2);
    // enthält Spülkasten (poly), Schüssel (poly/ellipse) und Abfluss (circle)
    expect(prims!.some((p) => p.kind === "circle")).toBe(true);
    expect(prims!.some((p) => p.kind === "poly")).toBe(true);
  });

  it("kochfeld hat vier Kreise (Kochzonen)", () => {
    const prims = symbolScreenPrims("kochfeld", [1.5, 1.2], 0.6, 0.6, 0, T);
    expect(prims!.filter((p) => p.kind === "circle")).toHaveLength(4);
  });

  it("teppich ist gestrichelt", () => {
    const prims = symbolScreenPrims("teppich", [1.5, 1.2], 1.2, 0.8, 0, T);
    expect(prims!.every((p) => p.dash)).toBe(true);
  });

  it("Rotation verschiebt die projizierten Punkte (yaw 0 ≠ yaw 90)", () => {
    const a = symbolScreenPrims("sofa", [1.5, 1.2], 1.6, 0.9, 0, T);
    const b = symbolScreenPrims("sofa", [1.5, 1.2], 1.6, 0.9, 90, T);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("bleibt innerhalb der bbox (Symbolpunkte im Footprint-Screen-Rechteck)", () => {
    // Achsparalleles Objekt: alle Symbolpunkte liegen im Screen-Rechteck des
    // Footprints (mit kleiner Toleranz für Strichbreite/Rundung).
    const w = 0.8;
    const d = 0.6;
    const center: Vec2 = [1.5, 1.2];
    const halbBreite = (w / 2) * T.scale;
    const halbTiefe = (d / 2) * T.scale;
    const [cx, cy] = [center[0] * T.scale + T.offsetX, center[1] * T.scale + T.offsetY];
    const prims = symbolScreenPrims("badewanne", center, w, d, 0, T)!;
    const punkte: [number, number][] = [];
    for (const p of prims) {
      if (p.kind === "circle") {
        punkte.push([p.cx - p.r, p.cy - p.r], [p.cx + p.r, p.cy + p.r]);
      } else if (p.kind === "line") {
        punkte.push([p.x1, p.y1], [p.x2, p.y2]);
      } else {
        for (const paar of p.points.split(" ")) {
          const [x, y] = paar.split(",").map(Number);
          punkte.push([x!, y!]);
        }
      }
    }
    const tol = 0.5;
    for (const [x, y] of punkte) {
      expect(x).toBeGreaterThanOrEqual(cx - halbBreite - tol);
      expect(x).toBeLessThanOrEqual(cx + halbBreite + tol);
      expect(y).toBeGreaterThanOrEqual(cy - halbTiefe - tol);
      expect(y).toBeLessThanOrEqual(cy + halbTiefe + tol);
    }
  });
});
