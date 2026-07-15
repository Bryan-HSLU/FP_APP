import { describe, expect, it } from "vitest";
import type { Room } from "./api";
import type { FlaechenKonzept } from "./oberflaechen";
import { beschreibeWaende, setzeAlleWaende, setzeWandMaterial, wandEintrag } from "./wandauswahl";

// Minimaler Raum mit Tür (Wand 0), Fenster (Wand 2) und Wasser-Anschluss (Wand 1).
const room = {
  shell: {
    walls: [
      { id: "w1", start: [0, 0], end: [3, 0], kind: "massiv", thickness: 0.12 },
      { id: "w2", start: [3, 0], end: [3, 2.4], kind: "massiv", thickness: 0.12 },
      { id: "w3", start: [3, 2.4], end: [0, 2.4], kind: "massiv", thickness: 0.12 },
      { id: "w4", start: [0, 2.4], end: [0, 0], kind: "leicht", thickness: 0 },
    ],
    floor: {
      polygon: [
        [0, 0],
        [3, 0],
        [3, 2.4],
        [0, 2.4],
      ],
    },
  },
  openings: [
    { id: "d1", type: "door", hostWall: "w1", offset: 1.9, width: 0.8 },
    { id: "f1", type: "window", hostWall: "w3", offset: 1.0, width: 1.2 },
  ],
  fixpoints: [
    { id: "fp1", type: "wasser", wall: "w2", position: [3, 1] },
    { id: "fp2", type: "abwasser", wall: "w2", position: [3, 1.2] },
  ],
} as unknown as Room;

describe("beschreibeWaende – Wand-Zeilen aus dem Raummodell", () => {
  const infos = beschreibeWaende(room);

  it("liefert je Wand Index, Länge, Öffnungen und Anschlüsse", () => {
    expect(infos).toHaveLength(4);
    expect(infos[0]).toMatchObject({ index: 0, oeffnungen: ["Tür"], anschluesse: [] });
    expect(infos[0]!.laengeM).toBeCloseTo(3.0);
    expect(infos[1]).toMatchObject({ index: 1, anschluesse: ["abwasser", "wasser"] });
    expect(infos[1]!.laengeM).toBeCloseTo(2.4);
    expect(infos[2]!.oeffnungen).toEqual(["Fenster"]);
  });

  it("markiert offene Seiten (thickness 0)", () => {
    expect(infos[3]!.offen).toBe(true);
    expect(infos[0]!.offen).toBe(false);
  });
});

describe("setzeWandMaterial – Einzelwand schlägt Kurator je wandIndex", () => {
  // Kurator-Konzept: Wand 0 Akzent-Fliesen, Wand 2 Putz.
  const kurator: FlaechenKonzept = {
    boden: { material: "fliesen-hell" },
    waende: [
      { wandIndex: 0, material: "fliesen-gruen", bereich: "voll", akzent: true },
      { wandIndex: 2, material: "putz-weiss", bereich: "voll" },
    ],
  };

  it("überschreibt NUR die genannte Wand, andere Kurator-Einträge bleiben", () => {
    const neu = setzeWandMaterial(kurator, 2, "taefer-holz", "halbhoch");
    expect(neu.waende).toEqual([
      { wandIndex: 0, material: "fliesen-gruen", bereich: "voll", akzent: true },
      { wandIndex: 2, material: "taefer-holz", bereich: "halbhoch" },
    ]);
    // Boden und Original unangetastet (unveränderlich).
    expect(neu.boden).toEqual(kurator.boden);
    expect(kurator.waende![1]).toMatchObject({ material: "putz-weiss" });
  });

  it("ergänzt eine Wand ohne Kurator-Eintrag (sortiert nach wandIndex)", () => {
    const neu = setzeWandMaterial(kurator, 1, "putz-warm");
    expect(neu.waende!.map((w) => w.wandIndex)).toEqual([0, 1, 2]);
    expect(neu.waende![1]).toEqual({ wandIndex: 1, material: "putz-warm", bereich: "voll" });
  });

  it("wandIndex-spezifischer Override schlägt eine globale «Alle Wände»-Wahl", () => {
    const global = setzeAlleWaende({}, 4, "putz-weiss");
    const einzel = setzeWandMaterial(global, 3, "fliesen-anthrazit", "sockel");
    expect(wandEintrag(einzel, 3)).toEqual({ material: "fliesen-anthrazit", bereich: "sockel" });
    // Die übrigen Wände behalten die globale Wahl.
    for (const i of [0, 1, 2]) {
      expect(wandEintrag(einzel, i)).toEqual({ material: "putz-weiss", bereich: "voll" });
    }
  });
});

describe("setzeAlleWaende – Schnellwahl ersetzt sämtliche Einträge", () => {
  it("erzeugt genau wandAnzahl Einträge mit Material + Bereich", () => {
    const basis: FlaechenKonzept = {
      waende: [{ wandIndex: 1, material: "fliesen-gruen", bereich: "halbhoch" }],
    };
    const neu = setzeAlleWaende(basis, 3, "holz-hell", "voll");
    expect(neu.waende).toEqual([
      { wandIndex: 0, material: "holz-hell", bereich: "voll" },
      { wandIndex: 1, material: "holz-hell", bereich: "voll" },
      { wandIndex: 2, material: "holz-hell", bereich: "voll" },
    ]);
  });
});

describe("wandEintrag – aktive Werte fürs Panel", () => {
  it("ohne Eintrag: kein Material, Bereich-Default «voll»", () => {
    expect(wandEintrag(null, 0)).toEqual({ material: undefined, bereich: "voll" });
    expect(wandEintrag({}, 2)).toEqual({ material: undefined, bereich: "voll" });
  });
});
