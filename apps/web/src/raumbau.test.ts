/** Tests der reinen Raum-Bau-Logik (raumbau.ts).
 *
 *  Zwei Ebenen: (1) Geometrie/Validierung als Einheit-Tests, (2) die erzeugten
 *  Raummodelle validieren gegen den echten Vertrag
 *  (packages/shared/schemas/raummodell.schema.json) via createValidator aus
 *  @fp/shared – so ist bewiesen, dass die Handeingabe schema-valide Räume liefert.
 */
import { createValidator } from "@fp/shared";
import { describe, expect, it } from "vitest";
import {
  baueRaummodell,
  fehlendeAnschluesse,
  grundrissPunkte,
  pruefeOeffnung,
  shoelaceFlaeche,
  wandLaenge,
  type LFormParams,
  type RaumbauEingabe,
} from "./raumbau";

const RECHTECK: LFormParams = {
  breite: 3,
  tiefe: 2,
  ausschnittBreite: 0,
  ausschnittTiefe: 0,
};

// Masse wie das R1-WC-Fixture (L-förmig, 1.56 m²).
const R1_LFORM: LFormParams = {
  breite: 1.0,
  tiefe: 1.8,
  ausschnittBreite: 0.3,
  ausschnittTiefe: 0.8,
};

const basisEingabe = (over: Partial<RaumbauEingabe> = {}): RaumbauEingabe => ({
  name: "Testraum",
  roomType: "bad",
  form: "rechteck",
  params: RECHTECK,
  raumhoehe: 2.5,
  oeffnungen: [],
  fixpunkte: [],
  ...over,
});

describe("Grundriss & Fläche", () => {
  it("Rechteck: 4 Ecken, Fläche B×T", () => {
    const p = grundrissPunkte("rechteck", RECHTECK);
    expect(p).toHaveLength(4);
    expect(shoelaceFlaeche(p)).toBeCloseTo(6, 6);
  });

  it("L-Form (R1-Masse): 6 Ecken, Fläche = B×T − Ausschnitt = 1.56", () => {
    const p = grundrissPunkte("l-form", R1_LFORM);
    expect(p).toHaveLength(6);
    // 1.0 × 1.8 − 0.3 × 0.8 = 1.8 − 0.24 = 1.56
    expect(shoelaceFlaeche(p)).toBeCloseTo(1.56, 6);
  });

  it("wandLaenge misst euklidisch", () => {
    expect(wandLaenge([0, 0], [3, 0])).toBeCloseTo(3, 6);
    expect(wandLaenge([0, 0], [3, 4])).toBeCloseTo(5, 6);
  });
});

describe("Öffnungs-Validierung", () => {
  const spec = { wandIndex: 0, type: "door" as const, offset: 0.5, width: 0.8, height: 2, sill: 0 };

  it("passt in die Wand → null", () => {
    expect(pruefeOeffnung(spec, 3)).toBeNull();
  });

  it("ragt über die Wand hinaus → Fehlertext", () => {
    expect(pruefeOeffnung({ ...spec, offset: 2.8 }, 3)).toMatch(/hinaus/);
  });

  it("negativer Offset → Fehlertext", () => {
    expect(pruefeOeffnung({ ...spec, offset: -0.1 }, 3)).toMatch(/negativ/);
  });
});

describe("fehlendeAnschluesse", () => {
  it("Bad ohne Wasser/Abwasser meldet beide", () => {
    expect(fehlendeAnschluesse("bad", [])).toEqual(["wasser", "abwasser"]);
  });

  it("Bad mit Wasser+Abwasser meldet nichts", () => {
    expect(fehlendeAnschluesse("bad", ["wasser", "abwasser"])).toEqual([]);
  });

  it("Wohnen hat keine Pflicht-Anschlüsse", () => {
    expect(fehlendeAnschluesse("wohnen", [])).toEqual([]);
  });
});

describe("baueRaummodell", () => {
  it("Rechteck: 4 Wände, geometryConfirmed true, source manuell, Meta korrekt", () => {
    const r = baueRaummodell(basisEingabe());
    expect(r.shell.walls).toHaveLength(4);
    expect(r.shell.floor.area).toBeCloseTo(6, 6);
    expect(r.meta.geometryConfirmed).toBe(true);
    expect(r.meta.estimatedError_cm).toBe(0);
    expect(r.source).toBe("manuell");
    expect(r.units).toBe("m");
    expect(r.schemaVersion).toBe("0.1.0");
    // Umlauf geschlossen: Ende der letzten Wand = Start der ersten.
    expect(r.shell.walls.at(-1)?.end).toEqual(r.shell.walls[0]?.start);
  });

  it("R1-ähnliche L-Form ergibt 6 Wände und Fläche 1.56", () => {
    const r = baueRaummodell(basisEingabe({ form: "l-form", params: R1_LFORM }));
    expect(r.shell.walls).toHaveLength(6);
    expect(r.shell.floor.area).toBeCloseTo(1.56, 6);
  });

  it("leerer Name → Default «Mein Raum»", () => {
    expect(baueRaummodell(basisEingabe({ name: "  " })).name).toBe("Mein Raum");
  });

  it("Öffnung pflegt Rückverweis Wand → Öffnung", () => {
    const r = baueRaummodell(
      basisEingabe({
        oeffnungen: [{ wandIndex: 0, type: "door", offset: 0.5, width: 0.8, height: 2, sill: 0 }],
      }),
    );
    expect(r.openings).toHaveLength(1);
    expect(r.shell.walls[0]?.openings).toContain(r.openings[0]?.id);
    expect(r.openings[0]?.hostWall).toBe(r.shell.walls[0]?.id);
  });

  it("Fixpunkt liegt auf der Wand, mount/origin/zone gesetzt", () => {
    const r = baueRaummodell(
      basisEingabe({
        fixpunkte: [{ wandIndex: 0, type: "wasser", offset: 1.5, heightFromFloor: 0.3 }],
      }),
    );
    expect(r.fixpoints).toHaveLength(1);
    const fp = r.fixpoints[0];
    expect(fp).toBeDefined();
    expect(fp?.mount).toBe("wand");
    expect(fp?.origin).toBe("manuell");
    expect(fp?.zone).toBeNull();
    // Wand 0 verläuft (0,0)→(3,0); Offset 1.5 → Punkt (1.5, 0).
    expect(fp?.position).toEqual([1.5, 0]);
  });

  it("Öffnung/Fixpunkt mit ungültigem Wand-Index wird übersprungen", () => {
    const r = baueRaummodell(
      basisEingabe({
        oeffnungen: [{ wandIndex: 99, type: "door", offset: 0, width: 0.8, height: 2, sill: 0 }],
        fixpunkte: [{ wandIndex: 99, type: "wasser", offset: 0, heightFromFloor: 0.3 }],
      }),
    );
    expect(r.openings).toHaveLength(0);
    expect(r.fixpoints).toHaveLength(0);
  });
});

describe("Vertrag: erzeugte Raummodelle validieren gegen raummodell.schema.json", () => {
  const validator = createValidator();

  it("Rechteck-Raum ist schema-valide", () => {
    const r = baueRaummodell(
      basisEingabe({
        oeffnungen: [
          { wandIndex: 2, type: "window", offset: 0.5, width: 1.2, height: 1.0, sill: 0.9 },
        ],
        fixpunkte: [
          { wandIndex: 0, type: "wasser", offset: 1.0, heightFromFloor: 0.3 },
          { wandIndex: 0, type: "abwasser", offset: 1.0, heightFromFloor: 0.2 },
        ],
      }),
    );
    const res = validator.validate("raummodell", r);
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it("L-Form-Raum (R1-Masse) ist schema-valide", () => {
    const r = baueRaummodell(
      basisEingabe({
        roomType: "kueche",
        form: "l-form",
        params: R1_LFORM,
        fixpunkte: [
          { wandIndex: 1, type: "wasser", offset: 0.5, heightFromFloor: 0.55 },
          { wandIndex: 1, type: "abwasser", offset: 0.5, heightFromFloor: 0.4 },
          { wandIndex: 4, type: "starkstrom", offset: 0.3, heightFromFloor: 0.3 },
          { wandIndex: 4, type: "elektro", offset: 0.5, heightFromFloor: 0.3 },
        ],
      }),
    );
    const res = validator.validate("raummodell", r);
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });
});
