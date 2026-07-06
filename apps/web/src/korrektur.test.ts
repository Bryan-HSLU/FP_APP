/** Tests der reinen Scan-Korrektur-Logik (korrektur.ts).
 *
 *  Zwei Ebenen: (1) Geometrie (Ecken-Ableitung, Verschieben, Snapping,
 *  Verkettung) als Einheit-Tests, (2) `wendeAn` erzeugt ein schema-valides
 *  Raummodell (packages/shared/schemas/raummodell.schema.json) via createValidator
 *  aus @fp/shared – so ist bewiesen, dass die Korrektur gültige Räume liefert.
 */
import { createValidator } from "@fp/shared";
import { describe, expect, it } from "vitest";
import {
  ecken,
  kettePolygon,
  nachbarPunkte,
  snappe,
  verschiebeEcke,
  wendeAn,
  type KWand,
  type ScanOeffnung,
  type ScanRaum,
} from "./korrektur";

// UUIDs (nötig, weil das Schema format:uuid auf IDs verlangt).
const WID = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
];

/** Rechteck 4×2 als Wand-Segmente, bewusst UNSORTIERT + teils umgedreht –
 *  wie ein Scan sie liefern kann (adapter.py garantiert keine Umlauf-Ordnung). */
function rechteckWaende(): KWand[] {
  return [
    { id: WID[0]!, start: [0, 0], end: [4, 0] }, // untere Kante
    { id: WID[2]!, start: [4, 2], end: [0, 2] }, // obere Kante (umgedreht)
    { id: WID[1]!, start: [4, 0], end: [4, 2] }, // rechte Kante
    { id: WID[3]!, start: [0, 2], end: [0, 0] }, // linke Kante
  ];
}

describe("ecken", () => {
  it("leitet 4 eindeutige Ecken aus unsortiertem Wand-Array ab", () => {
    const es = ecken(rechteckWaende());
    expect(es).toHaveLength(4);
    // Jede Ecke eines geschlossenen Rechtecks trägt genau 2 Wand-Endpunkte.
    for (const e of es) expect(e.enden).toHaveLength(2);
  });

  it("Ecke (0,0) kennt beide anliegenden Wände", () => {
    const es = ecken(rechteckWaende());
    const ecke = es.find((e) => e.position[0] === 0 && e.position[1] === 0);
    expect(ecke).toBeDefined();
    const ids = ecke!.enden.map((x) => x.wallId).sort();
    // (0,0) = Start von W0 und Ende von W3.
    expect(ids).toEqual([WID[0], WID[3]].sort());
  });
});

describe("verschiebeEcke", () => {
  it("verschiebt beide an der Ecke hängenden Wand-Endpunkte", () => {
    const walls = rechteckWaende();
    const ecke = ecken(walls).find((e) => e.position[0] === 4 && e.position[1] === 0)!;
    const neu = verschiebeEcke(walls, ecke, [5, 0]);
    // W0 endet bei (4,0) → jetzt (5,0); W1 startet bei (4,0) → jetzt (5,0).
    expect(neu.find((w) => w.id === WID[0])!.end).toEqual([5, 0]);
    expect(neu.find((w) => w.id === WID[1])!.start).toEqual([5, 0]);
    // Unbeteiligte Endpunkte bleiben.
    expect(neu.find((w) => w.id === WID[3])!.start).toEqual([0, 2]);
  });
});

describe("nachbarPunkte", () => {
  it("liefert das gegenüberliegende Ende jeder anliegenden Wand", () => {
    const walls = rechteckWaende();
    const ecke = ecken(walls).find((e) => e.position[0] === 0 && e.position[1] === 0)!;
    const nach = nachbarPunkte(ecke, walls);
    // Nachbarn von (0,0): (4,0) über W0 und (0,2) über W3.
    expect(nach).toContainEqual([4, 0]);
    expect(nach).toContainEqual([0, 2]);
  });
});

describe("snappe", () => {
  it("Achsen-Snap vor Raster: übernimmt x eines nahen Nachbarn", () => {
    // Nachbar bei x=1.0; Punkt x=1.02 (< 0.07) → x snappt auf 1.0;
    // z=2.13 hat keinen nahen Nachbarn → 5-cm-Raster → 2.15.
    expect(snappe([1.02, 2.13], [[1.0, 5.0]], 0.05, 0.07)).toEqual([1.0, 2.15]);
  });

  it("ausserhalb der Toleranz: nur Raster, kein Snap", () => {
    // Nachbar x=1.0 ist 0.2 entfernt (> 0.07) → kein Snap, nur Raster.
    expect(snappe([1.2, 2.13], [[1.0, 5.0]], 0.05, 0.07)).toEqual([1.2, 2.15]);
  });

  it("ohne Nachbarn: beide Achsen aufs Raster", () => {
    expect(snappe([1.02, 2.13], [], 0.05, 0.07)).toEqual([1.0, 2.15]);
  });
});

describe("kettePolygon", () => {
  it("schliesst den Umlauf eines unsortierten Rechtecks (4 Ecken)", () => {
    const res = kettePolygon(rechteckWaende());
    expect(res.ok).toBe(true);
    expect(res.polygon).toHaveLength(4);
  });

  it("erkennt eine offene Hülle als Fehler statt zu werfen", () => {
    // Rechte Kante fehlt → Kette kann nicht schliessen.
    const offen: KWand[] = [
      { id: WID[0]!, start: [0, 0], end: [4, 0] },
      { id: WID[2]!, start: [4, 2], end: [0, 2] },
      { id: WID[3]!, start: [0, 2], end: [0, 0] },
    ];
    const res = kettePolygon(offen);
    expect(res.ok).toBe(false);
    expect(res.fehler).toMatch(/nicht geschlossen/);
  });
});

// --- wendeAn ---------------------------------------------------------------

const OBJ_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OBJ2_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FIX_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OEFF_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

/** Ein realistisches Scan-Raummodell (Rechteck 4×2, ein Objekt needsReview). */
function scanRaum(): ScanRaum {
  const walls = rechteckWaende();
  return {
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    schemaVersion: "0.1.0",
    name: "Scan-Bad",
    roomType: "bad",
    source: "video",
    units: "m",
    shell: {
      walls: walls.map((w) => ({
        ...w,
        height: 2.5,
        thickness: 0.1,
        kind: "massiv",
      })),
      floor: {
        polygon: [
          [0, 0],
          [4, 0],
          [4, 2],
          [0, 2],
        ],
        area: 8,
      },
      ceiling: { height: 2.5 },
    },
    openings: [],
    zones: [],
    fixpoints: [],
    objects: [
      {
        id: OBJ_ID,
        label: "wc",
        geometry: { repr: "bbox", bbox: { w: 0.4, d: 0.6, h: 0.8 } },
        pose: { pos: [1, 1], yawDeg: 0 },
        movable: true,
        confidence: 0.5,
        needsReview: true,
      },
      {
        id: OBJ2_ID,
        label: "lavabo",
        geometry: { repr: "bbox", bbox: { w: 0.6, d: 0.5, h: 0.9 } },
        pose: { pos: [3, 1], yawDeg: 0 },
        movable: true,
        confidence: 0.5,
        needsReview: true,
      },
    ],
    meta: { captureMethod: "ar", estimatedError_cm: 8.5, geometryConfirmed: false },
  };
}

describe("wendeAn", () => {
  it("setzt geometryConfirmed=true und lässt alle IDs stabil", () => {
    const raum = scanRaum();
    const out = wendeAn(raum, raum.shell.walls, [], [], {});
    expect(out.meta.geometryConfirmed).toBe(true);
    expect(out.id).toBe(raum.id);
    expect(out.shell.walls.map((w) => w.id)).toEqual(raum.shell.walls.map((w) => w.id));
  });

  it("berechnet die Bodenfläche nach dem Verschieben neu", () => {
    const raum = scanRaum();
    // Rechte Kante von x=4 auf x=2 ziehen → Rechteck 2×2 = 4 m².
    const ecke = ecken(raum.shell.walls).find((e) => e.position[0] === 4 && e.position[1] === 0)!;
    let walls = verschiebeEcke(raum.shell.walls, ecke, [2, 0]);
    const ecke2 = ecken(walls).find((e) => e.position[0] === 4 && e.position[1] === 2)!;
    walls = verschiebeEcke(walls, ecke2, [2, 2]);
    const out = wendeAn(raum, walls, [], [], {});
    expect(out.shell.floor.area).toBeCloseTo(4, 6);
  });

  it("clampt den Öffnungs-Offset auf [0, laenge−width]", () => {
    const raum = scanRaum();
    // Öffnung auf die untere Wand (W0, Länge 4), offset zu gross.
    const oeff: ScanOeffnung = {
      id: OEFF_ID,
      type: "door",
      hostWall: WID[0]!,
      offset: 5,
      width: 0.8,
      height: 2,
      sill: 0,
    };
    const out = wendeAn(raum, raum.shell.walls, [oeff], [], {});
    // maxOff = 4 − 0.8 = 3.2.
    expect(out.openings[0]!.offset).toBeCloseTo(3.2, 6);
    // Rückverweis Wand → Öffnung ist gesetzt.
    expect(out.shell.walls.find((w) => w.id === WID[0])!.openings).toContain(OEFF_ID);
  });

  it("erhält die relative Position eines Fixpunkts beim Wand-Schrumpfen", () => {
    const raum = scanRaum();
    // Fixpunkt bei t=0.25 auf W0 ((0,0)→(4,0)) → position (1,0).
    raum.fixpoints = [
      {
        id: FIX_ID,
        type: "wasser",
        position: [1, 0],
        wall: WID[0]!,
        heightFromFloor: 0.3,
        mount: "wand",
        origin: "bestand",
      },
    ];
    // W0 auf halbe Länge ziehen: Ende (4,0) → (2,0).
    const ecke = ecken(raum.shell.walls).find((e) => e.position[0] === 4 && e.position[1] === 0)!;
    const walls = verschiebeEcke(raum.shell.walls, ecke, [2, 0]);
    const out = wendeAn(raum, walls, [], raum.fixpoints, {});
    // t=0.25 bleibt → neue Wand (0,0)→(2,0) → position (0.5,0).
    expect(out.fixpoints[0]!.position).toEqual([0.5, 0]);
  });

  it("bestätigt und entfernt Objekte (needsReview-Übergänge)", () => {
    const raum = scanRaum();
    const out = wendeAn(raum, raum.shell.walls, [], [], {
      [OBJ_ID]: "bestaetigt",
      [OBJ2_ID]: "entfernt",
    });
    expect(out.objects).toHaveLength(1);
    const wc = out.objects[0]!;
    expect(wc.id).toBe(OBJ_ID);
    expect(wc.needsReview).toBe(false);
  });

  it("lässt unberührte Objekte auf needsReview=true", () => {
    const raum = scanRaum();
    const out = wendeAn(raum, raum.shell.walls, [], [], {});
    expect(out.objects.every((o) => o.needsReview === true)).toBe(true);
  });
});

describe("Vertrag: korrigierte Raummodelle validieren gegen raummodell.schema.json", () => {
  const validator = createValidator();

  it("korrigierter Scan-Raum mit Öffnung + Anschlüssen ist schema-valide", () => {
    const raum = scanRaum();
    const oeff: ScanOeffnung = {
      id: OEFF_ID,
      type: "window",
      hostWall: WID[2]!,
      offset: 1,
      width: 1.2,
      height: 1,
      sill: 0.9,
    };
    const fixpunkte = [
      {
        id: FIX_ID,
        type: "wasser" as const,
        position: [1, 0] as [number, number],
        wall: WID[0]!,
        heightFromFloor: 0.3,
        mount: "wand" as const,
        origin: "manuell" as const,
        zone: null,
      },
    ];
    const out = wendeAn(raum, raum.shell.walls, [oeff], fixpunkte, {
      [OBJ_ID]: "bestaetigt" as const,
      [OBJ2_ID]: "entfernt" as const,
    });
    const res = validator.validate("raummodell", out);
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });
});
