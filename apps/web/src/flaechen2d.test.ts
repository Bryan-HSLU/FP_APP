import { describe, expect, it } from "vitest";
import { loeseFlaechen2D } from "./flaechen2d";
import {
  bodenSpezAusSlug,
  leiteOberflaechen,
  loeseBodenSpez,
  loeseWandZonen,
  wendeVariantenAn,
  type FlaechenKonzept,
} from "./oberflaechen";

describe("loeseFlaechen2D – dieselbe Quelle wie der 3D-Viewer", () => {
  it("ohne Konzept: Boden/Wände = reine Stil-Ableitung (kein Abweichen vom 3D)", () => {
    const f = loeseFlaechen2D("bad", null, null, null, 4);
    const spez = leiteOberflaechen(null, "bad");
    expect(f.boden.spez).toEqual(loeseBodenSpez(spez.boden, null));
    const zonen = loeseWandZonen(spez.wand, null, 4);
    expect(f.waende).toHaveLength(4);
    // Wandton = Zone (falls vorhanden) sonst Basis – identisch zur 3D-Auflösung.
    for (const [i, w] of f.waende.entries()) {
      const z = zonen[i]!;
      expect(w.farbe).toBe((z.zone ? z.zone.look : z.basis).farbe);
    }
  });

  it("Kurator-/manuelles Konzept schlägt die Stil-Optik (Boden + Einzelwand)", () => {
    const konzept: FlaechenKonzept = {
      boden: { material: "fliesen-anthrazit" },
      waende: [{ wandIndex: 1, material: "fliesen-gruen", bereich: "halbhoch", akzent: true }],
    };
    const f = loeseFlaechen2D("bad", null, null, konzept, 4);
    expect(f.boden.spez).toEqual(bodenSpezAusSlug("fliesen-anthrazit"));
    expect(f.boden.label).toBe("Fliesen anthrazit");
    expect(f.waende[1]!.label).toBe("Fliesen grün");
    expect(f.waende[1]!.akzent).toBe(true);
    // Wände ohne Eintrag bleiben Stil-Fallback (deutsches Muster-Label).
    expect(f.waende[0]!.akzent).toBe(false);
  });

  it("Oberflächen-Variantenwahl fliesst in den Fallback ein (wie 3D)", () => {
    const wahl = { boden: "fliesen-dunkel", wand: null };
    const f = loeseFlaechen2D("bad", null, wahl, null, 4);
    const spez = wendeVariantenAn(leiteOberflaechen(null, "bad"), "bad", wahl);
    expect(f.boden.spez).toEqual(loeseBodenSpez(spez.boden, null));
  });

  it("Legende: eindeutige Material-Namen, Boden zuerst, Akzent ausgewiesen", () => {
    const konzept: FlaechenKonzept = {
      boden: { material: "parkett-eiche" },
      waende: [
        { wandIndex: 0, material: "putz-weiss", bereich: "voll" },
        { wandIndex: 1, material: "putz-weiss", bereich: "voll" },
        { wandIndex: 2, material: "fliesen-gruen", bereich: "voll", akzent: true },
      ],
    };
    const f = loeseFlaechen2D("wohnen", null, null, konzept, 4);
    const labels = f.legende.map((l) => l.label);
    expect(labels[0]).toBe("Boden: Parkett Eiche");
    expect(labels).toContain("Wand: Putz weiss");
    expect(labels).toContain("Wand: Fliesen grün (Akzent)");
    // dedupliziert: «Putz weiss» erscheint trotz zweier Wände nur einmal.
    expect(new Set(labels).size).toBe(labels.length);
    for (const l of f.legende) expect(l.farbe).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("deterministisch: gleicher Input ⇒ gleiches Ergebnis", () => {
    const konzept: FlaechenKonzept = { boden: { material: "naturstein" } };
    expect(loeseFlaechen2D("kueche", null, null, konzept, 4)).toEqual(
      loeseFlaechen2D("kueche", null, null, konzept, 4),
    );
  });
});
