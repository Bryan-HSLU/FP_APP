import { describe, expect, it } from "vitest";
import { hslZuHex, leiteOberflaechen, type StilprofilSicht } from "./oberflaechen";

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
