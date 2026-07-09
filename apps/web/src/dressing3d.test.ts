import { describe, expect, it } from "vitest";
import { dressingBauteile, DRESSING_TYPEN } from "./dressing3d-kits";
import { passtInBbox } from "./moebel3d.tsx";

// Reale Deko-Masse (Meter) aus data/dressing/bad.json + extreme Seitenverhältnisse.
const MASSE: [number, number, number][] = [
  [0.07, 0.07, 0.18], // Seifenspender
  [0.08, 0.08, 0.11], // Zahnputzbecher
  [0.3, 0.22, 0.14], // Handtuchstapel (flach, breit)
  [0.28, 0.16, 0.2], // Ablage-Tray
  [0.24, 0.24, 0.55], // Zimmerpflanze (schmal, hoch)
  [0.5, 0.5, 0.5], // Würfel-Kontrolle
];

describe("dressingBauteile – bbox-Treue", () => {
  it("hält jeden Deko-Bausatz vollständig innerhalb der bbox w×d×h", () => {
    for (const typ of DRESSING_TYPEN) {
      for (const [w, d, h] of MASSE) {
        const teile = dressingBauteile(typ, w, d, h);
        expect(teile.length, `${typ} liefert Bauteile`).toBeGreaterThan(0);
        expect(passtInBbox(teile, w, d, h), `${typ} bleibt in bbox`).toBe(true);
      }
    }
  });

  it("formt bekannte Deko-Typen mehrteilig (nicht als nackte Box)", () => {
    for (const typ of DRESSING_TYPEN) {
      expect(dressingBauteile(typ, 0.3, 0.2, 0.4).length, `${typ} ist mehrteilig`).toBeGreaterThan(
        1,
      );
    }
  });
});

describe("dressingBauteile – Fallback", () => {
  it("gibt für unbekannte Typen genau die volle Box zurück", () => {
    expect(dressingBauteile("gibtsnicht", 0.2, 0.3, 0.4)).toEqual([
      { form: "box", groesse: [0.2, 0.4, 0.3], pos: [0, 0, 0], rolle: "koerper" },
    ]);
  });
});
