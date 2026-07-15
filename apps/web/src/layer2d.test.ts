import { describe, expect, it } from "vitest";
import {
  DARSTELLUNGS_LAYER,
  defaultLayers,
  objektSichtbar,
  toggleLayer,
  toggleObjekt,
} from "./layer2d";

describe("layer2d", () => {
  it("Default-Layer: Boxen/Platzbedarf/Masse aus, Rest an", () => {
    const l = defaultLayers();
    expect(l.waende && l.oeffnungen && l.objekte && l.beschriftung && l.ampel).toBe(true);
    expect(l.boxen || l.platzbedarf || l.masse).toBe(false);
  });

  it("DARSTELLUNGS_LAYER deckt genau die Default-Schlüssel ab", () => {
    const ids = DARSTELLUNGS_LAYER.map((d) => d.id).sort();
    expect(ids).toEqual(Object.keys(defaultLayers()).sort());
  });

  it("toggleLayer schaltet unveränderlich um", () => {
    const l = defaultLayers();
    const n = toggleLayer(l, "platzbedarf");
    expect(n.platzbedarf).toBe(true);
    expect(l.platzbedarf).toBe(false); // Original unangetastet
    expect(toggleLayer(n, "platzbedarf").platzbedarf).toBe(false);
  });

  it("Flächen-Layer (Welle C): Default AN, umschaltbar", () => {
    const l = defaultLayers();
    expect(l.flaechen).toBe(true);
    expect(toggleLayer(l, "flaechen").flaechen).toBe(false);
  });

  it("toggleObjekt versteckt/zeigt einzeln, neues Set", () => {
    const leer = new Set<string>();
    const versteckt = toggleObjekt(leer, "a");
    expect(versteckt.has("a")).toBe(true);
    expect(leer.has("a")).toBe(false); // Original unangetastet
    expect(objektSichtbar(versteckt, "a")).toBe(false);
    expect(objektSichtbar(versteckt, "b")).toBe(true);
    expect(objektSichtbar(toggleObjekt(versteckt, "a"), "a")).toBe(true);
  });
});
