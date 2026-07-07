import { describe, expect, it } from "vitest";
import type { Vec2 } from "@fp/shared/rules";
import {
  AUGENHOEHE,
  begehungStart,
  bewegungsDelta,
  blickRichtung,
  presetKamera,
  raumBBox,
} from "./viewer3d-logik";

// Rechteckraum 4×3 m, Ursprung verschoben – testet Zentrum/Spannen unabhängig
// von der Lage im Weltkoordinatensystem.
const RECHTECK: Vec2[] = [
  [1, 1],
  [5, 1],
  [5, 4],
  [1, 4],
];

describe("raumBBox", () => {
  it("liefert Min/Max, Zentrum und Spannen eines Rechtecks", () => {
    const b = raumBBox(RECHTECK);
    expect(b).toMatchObject({ minX: 1, maxX: 5, minZ: 1, maxZ: 4, breite: 4, tiefe: 3 });
    expect(b.cx).toBe(3);
    expect(b.cz).toBe(2.5);
  });

  it("leeres Polygon → Nullbox (kein Absturz)", () => {
    expect(raumBBox([])).toMatchObject({ cx: 0, cz: 0, breite: 0, tiefe: 0 });
  });
});

describe("presetKamera", () => {
  const b = raumBBox(RECHTECK);

  it("Draufsicht: senkrecht über dem Zentrum, Ziel im Zentrum", () => {
    const p = presetKamera(b, "draufsicht");
    expect(p.position[0]).toBeCloseTo(b.cx, 6);
    expect(p.position[1]).toBeGreaterThan(2); // deutlich über dem Raum
    expect(p.position[2]).toBeCloseTo(b.cz, 2);
    expect(p.target).toEqual([b.cx, 0, b.cz]);
    // Der z-Versatz gegen die Gimbal-Entartung ist winzig, aber vorhanden.
    expect(p.position[2]).not.toBe(b.cz);
  });

  it("Front: Kamera auf der +z-Seite, achsparallel, Ziel auf halber Höhe", () => {
    const p = presetKamera(b, "front", 2.4);
    expect(p.position[0]).toBeCloseTo(b.cx, 6);
    expect(p.position[2]).toBeGreaterThan(b.maxZ);
    expect(p.target).toEqual([b.cx, 1.2, b.cz]);
  });

  it("Seite: Kamera auf der +x-Seite, Ziel im Zentrum", () => {
    const p = presetKamera(b, "seite", 2.4);
    expect(p.position[0]).toBeGreaterThan(b.maxX);
    expect(p.position[2]).toBeCloseTo(b.cz, 6);
    expect(p.target).toEqual([b.cx, 1.2, b.cz]);
  });

  it("Perspektive: erhöhte Schrägsicht, Ziel im Zentrum (deterministisch)", () => {
    const p = presetKamera(b, "perspektive");
    expect(p.position[1]).toBeGreaterThan(0);
    expect(p.target[0]).toBe(b.cx);
    expect(p.target[2]).toBe(b.cz);
    expect(presetKamera(b, "perspektive")).toEqual(p);
  });
});

describe("begehungStart", () => {
  it("startet im Raumzentrum auf Augenhöhe", () => {
    const p = begehungStart(raumBBox(RECHTECK));
    expect(p.position[0]).toBe(3);
    expect(p.position[1]).toBe(AUGENHOEHE);
    expect(p.position[2]).toBe(2.5);
  });
});

describe("bewegungsDelta", () => {
  it("Blick nach −z: vorwärts bewegt nach −z", () => {
    expect(bewegungsDelta([0, -1], 1, 0, 0.5)).toEqual([0, -0.5]);
  });

  it("Blick nach −z: rechts (seit=+1) bewegt nach +x (Osten)", () => {
    const [dx, dz] = bewegungsDelta([0, -1], 0, 1, 0.5);
    expect(dx).toBeCloseTo(0.5, 6);
    expect(dz).toBeCloseTo(0, 6);
  });

  it("normiert die Blickrichtung (Länge egal)", () => {
    const a = bewegungsDelta([0, -2], 1, 0, 1);
    expect(a[0]).toBeCloseTo(0, 6);
    expect(a[1]).toBeCloseTo(-1, 6);
  });

  it("stillstehende Blickrichtung → kein Versatz", () => {
    expect(bewegungsDelta([0, 0], 1, 1, 1)).toEqual([0, 0]);
  });
});

describe("blickRichtung", () => {
  it("Yaw 0 blickt nach −z", () => {
    const [x, z] = blickRichtung(0);
    expect(x).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(-1, 6);
  });

  it("Yaw +90° dreht nach rechts (+x)", () => {
    const [x, z] = blickRichtung(Math.PI / 2);
    expect(x).toBeCloseTo(1, 6);
    expect(z).toBeCloseTo(0, 6);
  });
});
