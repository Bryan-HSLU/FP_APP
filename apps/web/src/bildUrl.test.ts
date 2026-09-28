import { describe, expect, it } from "vitest";
import { bildUrl } from "./bildUrl";

describe("bildUrl", () => {
  it("kodiert Leerzeichen als %20", () => {
    expect(bildUrl("Bild Nasszelle.jpg")).toBe("/bilder/Bild%20Nasszelle.jpg");
  });

  it("lässt Klammern unkodiert (encodeURIComponent-Ausnahmezeichen)", () => {
    // encodeURIComponent kodiert "(" und ")" bewusst nicht – nur Leerzeichen davor.
    expect(bildUrl("Bild Nasszelle (1).jpg")).toBe("/bilder/Bild%20Nasszelle%20(1).jpg");
  });

  it("kodiert Umlaute", () => {
    expect(bildUrl("Bäder Übersicht.jpg")).toBe("/bilder/B%C3%A4der%20%C3%9Cbersicht.jpg");
  });

  it("kodiert jedes Pfadsegment einzeln, der Schrägstrich bleibt Trenner", () => {
    expect(bildUrl("bad/Bild Nasszelle (1).jpg")).toBe("/bilder/bad/Bild%20Nasszelle%20(1).jpg");
  });
});
