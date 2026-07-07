import { describe, expect, it } from "vitest";
import { clipZone, oeffnungsPose, wandSegmente, type WandOeffnung } from "./raum3d";

const tuer = (offset: number, width = 0.8): WandOeffnung => ({
  type: "door",
  offset,
  width,
  height: 2.0,
  sill: 0,
});
const fenster = (offset: number, width = 1.0): WandOeffnung => ({
  type: "window",
  offset,
  width,
  height: 1.2,
  sill: 0.9,
});

// Ein Quader gilt als «voll» (raumhoch), wenn er von 0 bis hoehe reicht.
const istVoll = (q: { y: number; h: number }, hoehe: number) =>
  Math.abs(q.y - hoehe / 2) < 1e-6 && Math.abs(q.h - hoehe) < 1e-6;

describe("wandSegmente", () => {
  const H = 2.5;

  it("Vollwand ohne Öffnung = genau 1 Segment über die ganze Höhe", () => {
    const segs = wandSegmente(3, H, []);
    expect(segs).toHaveLength(1);
    expect(istVoll(segs[0]!, H)).toBe(true);
    expect(segs[0]!.w).toBeCloseTo(3);
  });

  it("Tür: zwei Vollsegmente + Sturz, KEINE Brüstung", () => {
    const segs = wandSegmente(3, H, [tuer(1.1)]);
    expect(segs).toHaveLength(3);
    const voll = segs.filter((q) => istVoll(q, H));
    expect(voll).toHaveLength(2); // links + rechts der Tür
    // Sturz: über der Tür (unten bei sill+height = 2.0), nichts darunter.
    const sturz = segs.find((q) => !istVoll(q, H))!;
    expect(sturz.y - sturz.h / 2).toBeCloseTo(2.0);
    expect(sturz.y + sturz.h / 2).toBeCloseTo(H);
    // keine Brüstung → kein Segment mit Unterkante 0 und Oberkante < H über der Türbreite
    expect(segs.some((q) => q.y - q.h / 2 < 1e-6 && q.h < H - 1e-6)).toBe(false);
  });

  it("Fenster: zwei Vollsegmente + Sturz + Brüstung", () => {
    const segs = wandSegmente(3, H, [fenster(1.0)]);
    expect(segs).toHaveLength(4);
    expect(segs.filter((q) => istVoll(q, H))).toHaveLength(2);
    const sturz = segs.find((q) => q.y - q.h / 2 > 2.0 - 1e-6 && !istVoll(q, H));
    const bruestung = segs.find((q) => q.y - q.h / 2 < 1e-6 && q.h < H - 1e-6);
    expect(sturz).toBeDefined();
    expect(bruestung).toBeDefined();
    expect(bruestung!.h).toBeCloseTo(0.9); // sill
    expect(sturz!.y - sturz!.h / 2).toBeCloseTo(2.1); // sill+height
  });

  it("zwei getrennte Öffnungen erzeugen drei Vollsegmente", () => {
    const segs = wandSegmente(5, H, [tuer(1.0), fenster(3.0)]);
    expect(segs.filter((q) => istVoll(q, H))).toHaveLength(3); // vor, zwischen, nach
  });

  it("überlappende Öffnungen werden zu einem Bereich gemergt", () => {
    // Tür 1.0–1.8 und Fenster 1.5–2.5 überlappen → ein Loch von 1.0–2.5.
    const segs = wandSegmente(4, H, [tuer(1.0), fenster(1.5)]);
    // Nur zwei Vollsegmente (links von 1.0, rechts von 2.5); dazwischen ein Loch.
    expect(segs.filter((q) => istVoll(q, H))).toHaveLength(2);
    const links = segs.find((q) => istVoll(q, H) && q.x < 1.0)!;
    const rechts = segs.find((q) => istVoll(q, H) && q.x > 2.5)!;
    expect(links.x + links.w / 2).toBeCloseTo(1.0);
    expect(rechts.x - rechts.w / 2).toBeCloseTo(2.5);
    // gemergter Bereich: min(sill)=0 → keine Brüstung über dem ganzen Loch.
    expect(segs.some((q) => q.y - q.h / 2 < 1e-6 && q.h < H - 1e-6)).toBe(false);
  });

  it("Öffnung über das Wandende hinaus wird auf [0,laenge] geclampt", () => {
    const segs = wandSegmente(3, H, [tuer(2.7, 1.0)]); // ginge bis 3.7, Wand nur 3
    // Rechts der Tür bleibt nichts (Loch bis Wandende) → nur ein Vollsegment links.
    expect(segs.filter((q) => istVoll(q, H))).toHaveLength(1);
    const loch = segs.find((q) => !istVoll(q, H))!; // Sturz über der geclampten Tür
    expect(loch.x + loch.w / 2).toBeCloseTo(3);
  });

  it("verwirft degenerierte Öffnungen (Breite ≤ 0)", () => {
    const segs = wandSegmente(3, H, [{ type: "door", offset: 1, width: 0, height: 2, sill: 0 }]);
    expect(segs).toHaveLength(1);
    expect(istVoll(segs[0]!, H)).toBe(true);
  });
});

describe("clipZone", () => {
  it("schneidet Quader auf ein Höhenband und kürzt teilweise Überlappungen", () => {
    const q = [{ x: 1, y: 1.25, w: 2, h: 2.5 }]; // 0..2.5
    const sockel = clipZone(q, 0, 1.2);
    expect(sockel).toHaveLength(1);
    expect(sockel[0]!.y - sockel[0]!.h / 2).toBeCloseTo(0);
    expect(sockel[0]!.y + sockel[0]!.h / 2).toBeCloseTo(1.2);
  });

  it("verwirft Quader ausserhalb des Bandes", () => {
    const q = [{ x: 0, y: 0.4, w: 1, h: 0.8 }]; // 0..0.8
    expect(clipZone(q, 1.2, 2.5)).toHaveLength(0);
  });
});

describe("oeffnungsPose", () => {
  it("Mitte + Yaw für eine achsparallele Wand (entlang +x)", () => {
    const wand = { start: [0, 0] as [number, number], end: [3, 0] as [number, number] };
    const { mitte, yawRad } = oeffnungsPose(wand, tuer(1.9));
    expect(mitte[0]).toBeCloseTo(2.3); // 1.9 + 0.8/2
    expect(mitte[1]).toBeCloseTo(0);
    expect(yawRad).toBeCloseTo(0);
  });

  it("Mitte + Yaw für eine Wand entlang +z", () => {
    const wand = { start: [0, 0] as [number, number], end: [0, 2.4] as [number, number] };
    const { mitte, yawRad } = oeffnungsPose(wand, tuer(0.5, 0.8));
    expect(mitte[0]).toBeCloseTo(0);
    expect(mitte[1]).toBeCloseTo(0.9); // 0.5 + 0.4
    expect(yawRad).toBeCloseTo(Math.PI / 2);
  });

  it("Mitte + Yaw für eine schräge (45°) Wand", () => {
    const wand = { start: [0, 0] as [number, number], end: [2, 2] as [number, number] };
    const { mitte, yawRad } = oeffnungsPose(wand, {
      type: "window",
      offset: 0,
      width: 1.0,
      height: 1,
      sill: 0.9,
    });
    expect(yawRad).toBeCloseTo(Math.PI / 4);
    // Mitte 0.5 m entlang der 45°-Richtung.
    expect(mitte[0]).toBeCloseTo(0.5 * Math.SQRT1_2);
    expect(mitte[1]).toBeCloseTo(0.5 * Math.SQRT1_2);
  });
});
