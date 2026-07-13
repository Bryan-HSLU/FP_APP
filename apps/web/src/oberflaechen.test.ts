import { describe, expect, it } from "vitest";
import {
  akzentLook,
  bodenSpezAusSlug,
  hslZuHex,
  leiteOberflaechen,
  loeseBodenSpez,
  loeseWandZonen,
  materialLook,
  variantenFuer,
  wandSpezZuZonen,
  wendeVariantenAn,
  type FlaechenKonzept,
  type MaterialSlug,
  type StilprofilSicht,
  type WandSpez,
} from "./oberflaechen";

const profil = (styleVector: Record<string, number>): StilprofilSicht => ({ styleVector });

describe("hslZuHex", () => {
  it("liefert gültige #rrggbb-Werte und ist deterministisch", () => {
    const a = hslZuHex(30, 20, 60);
    expect(a).toMatch(/^#[0-9a-f]{6}$/);
    expect(hslZuHex(30, 20, 60)).toBe(a);
  });
});

describe("leiteOberflaechen – Muster je Raumtyp", () => {
  it("bad → Fliesenboden + Wandfliesen mit fliesenHoehe", () => {
    const o = leiteOberflaechen(profil({}), "bad");
    expect(o.boden.muster).toBe("fliesen");
    expect(o.wand.muster).toBe("fliesen");
    expect(o.wand.fliesenHoehe_m).toBe(1.2);
  });

  it("wohnen → Parkettboden + Uni-Wand", () => {
    const o = leiteOberflaechen(profil({}), "wohnen");
    expect(o.boden.muster).toBe("parkett");
    expect(o.wand.muster).toBe("uni");
  });

  it("kueche → Steinboden bei natürlicher Materialität, sonst Fliesen", () => {
    expect(leiteOberflaechen(profil({ materialitaet: 0.8 }), "kueche").boden.muster).toBe("stein");
    expect(leiteOberflaechen(profil({ materialitaet: -0.8 }), "kueche").boden.muster).toBe(
      "fliesen",
    );
  });

  it("ohne Stilprofil → heutige neutrale Defaults", () => {
    const o = leiteOberflaechen(null, "bad");
    expect(o.boden.muster).toBe("uni");
    expect(o.boden.grundfarbe).toBe("#e8e2d6");
    expect(o.wand.muster).toBe("uni");
    expect(o.wand.farbe).toBe("#d8d2c4");
  });
});

describe("leiteOberflaechen – Achsen ändern die Farbe deterministisch", () => {
  it("helligkeit hell vs. dunkel ergibt unterschiedliche Grundfarben", () => {
    const hell = leiteOberflaechen(profil({ helligkeit: 1 }), "bad").boden.grundfarbe;
    const dunkel = leiteOberflaechen(profil({ helligkeit: -1 }), "bad").boden.grundfarbe;
    expect(hell).not.toBe(dunkel);
  });

  it("temperatur warm vs. kühl ergibt unterschiedliche Grundfarben", () => {
    const warm = leiteOberflaechen(profil({ temperatur: 1 }), "wohnen").boden.grundfarbe;
    const kuehl = leiteOberflaechen(profil({ temperatur: -1 }), "wohnen").boden.grundfarbe;
    expect(warm).not.toBe(kuehl);
  });

  it("gleicher Input ⇒ gleicher Output (rein/deterministisch)", () => {
    const sv = { temperatur: 0.4, helligkeit: -0.2, materialitaet: 0.6, farbigkeit: 0.3 };
    expect(leiteOberflaechen(profil(sv), "wohnen")).toEqual(
      leiteOberflaechen(profil(sv), "wohnen"),
    );
  });

  it("Fugenfarbe ist dunkler als die Grundfarbe", () => {
    const b = leiteOberflaechen(profil({ helligkeit: 0.5 }), "bad").boden;
    const summe = (hex: string) =>
      Number.parseInt(hex.slice(1, 3), 16) +
      Number.parseInt(hex.slice(3, 5), 16) +
      Number.parseInt(hex.slice(5, 7), 16);
    expect(summe(b.fugenfarbe)).toBeLessThan(summe(b.grundfarbe));
  });
});

describe("variantenFuer – wählbare Oberflächen je Raumtyp", () => {
  it("bad bietet Wandfliesen und Bodenfliesen/Stein", () => {
    const v = variantenFuer("bad");
    expect(v.boden.length).toBeGreaterThanOrEqual(3);
    expect(v.wand.some((w) => w.spez.muster === "fliesen")).toBe(true);
  });

  it("wohnen bietet Parkett-Varianten", () => {
    const v = variantenFuer("wohnen");
    expect(v.boden.some((b) => b.spez.muster === "parkett")).toBe(true);
  });

  it("Variant-IDs sind je Fläche eindeutig", () => {
    const v = variantenFuer("kueche");
    const ids = [...v.boden, ...v.wand].map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("wendeVariantenAn – Nutzerwahl überschreibt die Stil-Spez", () => {
  const basis = leiteOberflaechen(profil({}), "bad");

  it("ohne Wahl bleibt die Basis unverändert", () => {
    expect(wendeVariantenAn(basis, "bad", null)).toEqual(basis);
    expect(wendeVariantenAn(basis, "bad", { boden: null, wand: null })).toEqual(basis);
  });

  it("gewählte Bodenvariante überschreibt nur den Boden", () => {
    const wahlId = variantenFuer("bad").boden[1]!.id;
    const out = wendeVariantenAn(basis, "bad", { boden: wahlId, wand: null });
    expect(out.boden).toEqual(variantenFuer("bad").boden[1]!.spez);
    expect(out.wand).toEqual(basis.wand);
  });

  it("unbekannte Variant-ID fällt auf die Basis zurück", () => {
    const out = wendeVariantenAn(basis, "bad", { boden: "gibt-es-nicht", wand: null });
    expect(out.boden).toEqual(basis.boden);
  });
});

// ── Flächen-Konzept des Kurators (slug → Look, Zonen, Fallback) ──────────────

const ALLE_SLUGS: MaterialSlug[] = [
  "fliesen-hell",
  "fliesen-gruen",
  "fliesen-anthrazit",
  "putz-weiss",
  "putz-warm",
  "holz-hell",
  "holz-dunkel",
  "parkett-eiche",
  "beton",
  "naturstein",
  "tapete-hell",
  "taefer-holz",
];
const istHex = (s: string) => /^#[0-9a-f]{6}$/i.test(s);
const summe = (hex: string) =>
  Number.parseInt(hex.slice(1, 3), 16) +
  Number.parseInt(hex.slice(3, 5), 16) +
  Number.parseInt(hex.slice(5, 7), 16);

describe("materialLook / bodenSpezAusSlug – alle 10 Slugs liefern gültige Specs", () => {
  it("jeder Slug → FlaechenLook mit gültigen Feldern", () => {
    for (const slug of ALLE_SLUGS) {
      const l = materialLook(slug);
      expect(["fliesen", "parkett", "holz", "stein", "uni"]).toContain(l.muster);
      expect(istHex(l.farbe)).toBe(true);
      expect(istHex(l.fugenfarbe)).toBe(true);
      expect(l.masse_m).toBeGreaterThan(0);
    }
  });

  it("jeder Slug → gültige BodenSpez (holz-Slugs werden zu parkett-Muster)", () => {
    for (const slug of ALLE_SLUGS) {
      const b = bodenSpezAusSlug(slug);
      expect(["fliesen", "parkett", "stein", "uni"]).toContain(b.muster);
      expect(istHex(b.grundfarbe)).toBe(true);
      expect(b.masse_m).toBeGreaterThan(0);
    }
    expect(bodenSpezAusSlug("holz-hell").muster).toBe("parkett");
    expect(bodenSpezAusSlug("parkett-eiche").muster).toBe("parkett");
    expect(bodenSpezAusSlug("fliesen-gruen").muster).toBe("fliesen");
  });

  it("neue Bekleidungs-Slugs: tapete-hell = uni-Wandton, taefer-holz = Holzlamellen", () => {
    const tapete = materialLook("tapete-hell");
    expect(tapete.muster).toBe("uni");
    expect(istHex(tapete.farbe)).toBe(true);
    const taefer = materialLook("taefer-holz");
    expect(taefer.muster).toBe("holz");
    // Wandbekleidung degradiert sinnvoll als Boden-Slug (taefer → parkett, tapete → uni).
    expect(bodenSpezAusSlug("taefer-holz").muster).toBe("parkett");
    expect(bodenSpezAusSlug("tapete-hell").muster).toBe("uni");
  });

  it("materialLook liefert eine Kopie (Mutation färbt das Original nicht)", () => {
    const a = materialLook("fliesen-hell");
    a.farbe = "#000000";
    expect(materialLook("fliesen-hell").farbe).not.toBe("#000000");
  });

  it("akzentLook dunkelt die Farbe ab (dezent), Muster/Mass bleiben", () => {
    const roh = materialLook("fliesen-gruen");
    const ak = akzentLook(roh);
    expect(summe(ak.farbe)).toBeLessThan(summe(roh.farbe));
    expect(ak.muster).toBe(roh.muster);
    expect(ak.masse_m).toBe(roh.masse_m);
  });
});

describe("loeseBodenSpez – Kurator-Material schlägt den Fallback", () => {
  const fallback = leiteOberflaechen(profil({}), "bad").boden;

  it("ohne flaechen → exakt der Fallback (identisches Verhalten)", () => {
    expect(loeseBodenSpez(fallback, null)).toEqual(fallback);
    expect(loeseBodenSpez(fallback, undefined)).toEqual(fallback);
    expect(loeseBodenSpez(fallback, {})).toEqual(fallback);
    expect(loeseBodenSpez(fallback, { boden: {} })).toEqual(fallback);
  });

  it("boden.material überschreibt den Boden mit dem Slug-Look", () => {
    const out = loeseBodenSpez(fallback, { boden: { material: "fliesen-anthrazit" } });
    expect(out).toEqual(bodenSpezAusSlug("fliesen-anthrazit"));
  });
});

describe("loeseWandZonen – Bereich → Höhenzonen", () => {
  const fallback: WandSpez = { muster: "uni", farbe: "#d8d2c4" };

  it("ohne flaechen → jede Wand = Fallback-Zonen (identisches Verhalten)", () => {
    const zonen = loeseWandZonen(fallback, null, 4);
    expect(zonen).toHaveLength(4);
    for (const z of zonen) expect(z).toEqual(wandSpezZuZonen(fallback));
  });

  it("Wände ohne Eintrag bleiben Fallback, nur die genannte Wand ändert sich", () => {
    const fl: FlaechenKonzept = { waende: [{ wandIndex: 1, material: "fliesen-gruen" }] };
    const zonen = loeseWandZonen(fallback, fl, 3);
    expect(zonen[0]).toEqual(wandSpezZuZonen(fallback));
    expect(zonen[2]).toEqual(wandSpezZuZonen(fallback));
    expect(zonen[1]!.zone).not.toBeNull();
  });

  it("voll → Zone deckt (praktisch) die ganze Wand, Basis dahinter", () => {
    const fl: FlaechenKonzept = {
      waende: [{ wandIndex: 0, material: "fliesen-gruen", bereich: "voll" }],
    };
    const z = loeseWandZonen(fallback, fl, 1)[0]!;
    expect(z.zone).not.toBeNull();
    expect(z.zone!.hoeheM).toBeGreaterThanOrEqual(100);
    expect(z.zone!.look.muster).toBe("fliesen");
  });

  it("halbhoch nutzt hoeheM (Default 1.2), Basis = Fallback-Look darüber", () => {
    const mitHoehe: FlaechenKonzept = {
      waende: [{ wandIndex: 0, material: "fliesen-hell", bereich: "halbhoch", hoeheM: 1.5 }],
    };
    const ohneHoehe: FlaechenKonzept = {
      waende: [{ wandIndex: 0, material: "fliesen-hell", bereich: "halbhoch" }],
    };
    expect(loeseWandZonen(fallback, mitHoehe, 1)[0]!.zone!.hoeheM).toBe(1.5);
    expect(loeseWandZonen(fallback, ohneHoehe, 1)[0]!.zone!.hoeheM).toBe(1.2);
    expect(loeseWandZonen(fallback, ohneHoehe, 1)[0]!.basis).toEqual(
      wandSpezZuZonen(fallback).basis,
    );
  });

  it("sockel → Default-Höhe 0.1 m", () => {
    const fl: FlaechenKonzept = {
      waende: [{ wandIndex: 0, material: "naturstein", bereich: "sockel" }],
    };
    expect(loeseWandZonen(fallback, fl, 1)[0]!.zone!.hoeheM).toBe(0.1);
  });

  it("akzent variiert die Zonenfarbe (dunkler als ohne Akzent)", () => {
    const ohne: FlaechenKonzept = {
      waende: [{ wandIndex: 0, material: "fliesen-gruen", bereich: "voll" }],
    };
    const mit: FlaechenKonzept = {
      waende: [{ wandIndex: 0, material: "fliesen-gruen", bereich: "voll", akzent: true }],
    };
    const f1 = loeseWandZonen(fallback, ohne, 1)[0]!.zone!.look.farbe;
    const f2 = loeseWandZonen(fallback, mit, 1)[0]!.zone!.look.farbe;
    expect(f2).not.toBe(f1);
    expect(summe(f2)).toBeLessThan(summe(f1));
  });

  it("fehlendes bereich → voll (Default)", () => {
    const fl: FlaechenKonzept = { waende: [{ wandIndex: 0, material: "beton" }] };
    expect(loeseWandZonen(fallback, fl, 1)[0]!.zone!.hoeheM).toBeGreaterThanOrEqual(100);
  });
});

describe("wandSpezZuZonen – Fallback-Konvertierung erhält die Bad-Sockel-Optik", () => {
  it("uni-Wand → nur Basis, keine Zone", () => {
    const z = wandSpezZuZonen({ muster: "uni", farbe: "#d8d2c4" });
    expect(z.zone).toBeNull();
    expect(z.basis.muster).toBe("uni");
    expect(z.basis.farbe).toBe("#d8d2c4");
  });

  it("fliesen-Wand → Basis uni + Fliesenzone bis fliesenHoehe", () => {
    const z = wandSpezZuZonen({ muster: "fliesen", farbe: "#dfe3e6", fliesenHoehe_m: 1.2 });
    expect(z.basis.muster).toBe("uni");
    expect(z.zone).not.toBeNull();
    expect(z.zone!.look.muster).toBe("fliesen");
    expect(z.zone!.hoeheM).toBe(1.2);
  });
});
