import { describe, expect, it } from "vitest";
import { istStabil, maxAchsenDifferenz } from "./stilkonvergenz";

/** Baut einen Verlauf aus n gleichen Vektoren (perfekt stabil). */
function konstant(n: number, vektor: Record<string, number>): Record<string, number>[] {
  return Array.from({ length: n }, () => ({ ...vektor }));
}

describe("maxAchsenDifferenz", () => {
  it("nimmt die grösste absolute Achsen-Differenz", () => {
    expect(maxAchsenDifferenz({ a: 0.1, b: 0.5 }, { a: 0.2, b: 0.1 })).toBeCloseTo(0.4);
  });

  it("behandelt eine fehlende Achse defensiv als 0", () => {
    // b fehlt im zweiten Vektor → gilt als 0, Differenz = 0.5.
    expect(maxAchsenDifferenz({ a: 0.1, b: 0.5 }, { a: 0.1 })).toBeCloseTo(0.5);
  });
});

describe("istStabil", () => {
  it("ist stabil nach genug Bewertungen mit kleinen Deltas", () => {
    const verlauf = [
      ...konstant(6, { warm: 0.4, hell: 0.2 }),
      { warm: 0.42, hell: 0.2 }, // Delta 0.02 < 0.06
      { warm: 0.44, hell: 0.21 }, // Delta 0.02 < 0.06
    ];
    expect(verlauf).toHaveLength(8);
    expect(istStabil(verlauf)).toBe(true);
  });

  it("ist NICHT stabil bei grossem Delta im Fenster", () => {
    const verlauf = [
      ...konstant(6, { warm: 0.4, hell: 0.2 }),
      { warm: 0.7, hell: 0.2 }, // Sprung 0.3 im Fenster → instabil
      { warm: 0.71, hell: 0.21 },
    ];
    expect(istStabil(verlauf)).toBe(false);
  });

  it("ist NICHT stabil vor Erreichen von minBewertungen", () => {
    // Nur 7 Einträge, aber alle stabil – trotzdem false, weil < 8.
    const verlauf = konstant(7, { warm: 0.4 });
    expect(istStabil(verlauf)).toBe(false);
    // Mit gesenkter Schwelle greift es dann doch.
    expect(istStabil(verlauf, 7)).toBe(true);
  });

  it("ist NICHT stabil bei leerem oder zu kurzem Verlauf", () => {
    expect(istStabil([])).toBe(false);
    expect(istStabil([{ warm: 0.4 }])).toBe(false);
    // Genug Länge für minBewertungen=2, aber fenster=2 braucht 3 Punkte.
    expect(istStabil(konstant(2, { warm: 0.4 }), 2, 0.06, 2)).toBe(false);
  });

  it("wertet eine in einem Update fehlende Achse defensiv als 0", () => {
    // Letztes Update hat die Achse `hell` verloren; ihr bisheriger Wert 0.2 war
    // klein genug, dass die Differenz (0.2) den Sprung NICHT unter delta hält.
    const verlaufSprung = [...konstant(7, { warm: 0.4, hell: 0.2 }), { warm: 0.41 }];
    expect(istStabil(verlaufSprung)).toBe(false);
    // Fehlt die Achse durchgängig, gibt es keine Differenz → stabil.
    const verlaufOhne = konstant(8, { warm: 0.4 });
    expect(istStabil(verlaufOhne)).toBe(true);
  });
});
