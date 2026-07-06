import { describe, expect, it } from "vitest";
import { bauteile, mischen, passtInBbox, rolleFarbe } from "./moebel3d.tsx";

// Alle im Katalog vorkommenden funktionsTypen (data/catalog/*.json).
const KATALOG_TYPEN = [
  "wc",
  "lavabo",
  "dusche",
  "badewanne",
  "spiegel",
  "schrank",
  "handtuchstange",
  "handtuchheizung",
  "badmoebel",
  "badteppich",
  "sofa",
  "esstisch",
  "couchtisch",
  "beistelltisch",
  "regal",
  "sideboard",
  "stehleuchte",
  "teppich",
  "pflanze",
  "wandbild",
  "wandleuchte",
  "tvmoebel",
  "deko",
  "unterschrank",
  "hochschrank",
  "haengeschrank",
  "spuele",
  "kochfeld",
  "kuehlschrank",
  "geschirrspueler",
  "dunstabzug",
  "eckschrank",
  "fuellstueck",
];

// Repräsentative Katalog-Grössen (Meter), inkl. extremer Seitenverhältnisse.
const MASSE: [number, number, number][] = [
  [0.37, 0.54, 0.4], // WC-kompakt
  [2.1, 0.9, 0.85], // Sofa
  [0.6, 0.6, 2.0], // Hochschrank
  [1.2, 0.05, 0.02], // flacher Teppich
  [0.9, 0.9, 0.9], // Würfel
];

describe("bauteile – bbox-Treue (Norm-Ampel)", () => {
  it("hält jeden Bausatz vollständig innerhalb der bbox w×d×h", () => {
    for (const typ of KATALOG_TYPEN) {
      for (const [w, d, h] of MASSE) {
        const teile = bauteile(typ, w, d, h);
        expect(teile.length, `${typ} liefert Bauteile`).toBeGreaterThan(0);
        expect(passtInBbox(teile, w, d, h), `${typ} bleibt in bbox`).toBe(true);
      }
    }
  });

  it("formt bekannte Typen aus mehreren Primitiven, nicht als nackte Box", () => {
    for (const typ of KATALOG_TYPEN) {
      expect(bauteile(typ, 1, 1, 1).length, `${typ} ist mehrteilig`).toBeGreaterThan(1);
    }
  });
});

describe("bauteile – Fallback", () => {
  it("gibt für unbekannte Typen genau die bisherige volle Box zurück", () => {
    const teile = bauteile("gibtsnicht", 0.8, 0.6, 1.2);
    expect(teile).toEqual([
      { form: "box", groesse: [0.8, 1.2, 0.6], pos: [0, 0, 0], rolle: "koerper" },
    ]);
  });
});

describe("Farbableitung – Ampel bleibt führend", () => {
  it("nutzt für den Hauptkörper exakt die übergebene Ampelfarbe", () => {
    expect(rolleFarbe("koerper", "#c96f2e")).toBe("#c96f2e");
  });

  it("leitet Akzente nur heller/dunkler ab und lässt Ungültiges unverändert", () => {
    expect(mischen("#808080", 1)).toBe("#ffffff");
    expect(mischen("#808080", -1)).toBe("#000000");
    expect(mischen("#808080", 0)).toBe("#808080");
    expect(mischen("keinhex", 0.5)).toBe("keinhex");
  });
});
