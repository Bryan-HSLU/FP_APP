import { describe, expect, it } from "vitest";
import { FORTSCHRITT_SCHRITTE, schrittZustand } from "./fortschritt";

describe("schrittZustand", () => {
  it("markiert den aktuellen Schritt als aktiv und nicht klickbar", () => {
    expect(schrittZustand(3, 3, 5)).toEqual({ zustand: "aktiv", klickbar: false });
  });

  it("markiert frühere Schritte als erledigt und klickbar", () => {
    expect(schrittZustand(1, 3, 5)).toEqual({ zustand: "erledigt", klickbar: true });
    expect(schrittZustand(2, 3, 5)).toEqual({ zustand: "erledigt", klickbar: true });
  });

  it("markiert erreichte, aber noch nicht abgeschlossene Schritte als verfügbar", () => {
    // Nutzer ist auf Schritt 2 zurückgegangen, hatte aber schon Schritt 4 erreicht.
    expect(schrittZustand(3, 2, 4)).toEqual({ zustand: "verfuegbar", klickbar: true });
    expect(schrittZustand(4, 2, 4)).toEqual({ zustand: "verfuegbar", klickbar: true });
  });

  it("sperrt noch nicht freigeschaltete Schritte", () => {
    expect(schrittZustand(4, 2, 3)).toEqual({ zustand: "gesperrt", klickbar: false });
    expect(schrittZustand(5, 1, 2)).toEqual({ zustand: "gesperrt", klickbar: false });
  });

  it("Grenzfall: max = aktuell (nichts voraus erreicht) sperrt alles danach", () => {
    expect(schrittZustand(3, 2, 2)).toEqual({ zustand: "gesperrt", klickbar: false });
  });

  it("kennt genau fünf beschriftete Schritte", () => {
    expect(FORTSCHRITT_SCHRITTE).toHaveLength(5);
    expect(FORTSCHRITT_SCHRITTE[0]).toBe("Projekt");
    expect(FORTSCHRITT_SCHRITTE[4]).toBe("Ergebnis");
  });
});
