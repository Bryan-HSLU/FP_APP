/** Farb-System (Welle 3): Schema-Deckung + Auflösungs-Rangfolge.
 *
 * Drift-Schutz: die Slug→Hex-Map muss EXAKT das Schema-Enum abdecken
 * (`katalog-item.schema.json#/$defs/farbSlug`) – kommt ein Slug dazu/weg, ohne
 * die Map zu pflegen, schlägt dieser Test an (analog zum MATERIAL_SLUGS-Laufzeit-
 * Read in kurator.py).
 */
import { describe, expect, it } from "vitest";
import katalogSchema from "../../../packages/shared/schemas/katalog-item.schema.json";
import { FARBSLUG_HEX, FARBSLUGS, farbHex, loeseFarbSlug } from "./farben";

const SCHEMA_ENUM = (katalogSchema as { $defs: { farbSlug: { enum: string[] } } }).$defs.farbSlug
  .enum;

describe("FARBSLUG_HEX deckt das Schema-Enum", () => {
  it("hat exakt dieselben Slugs wie farbSlug im Schema", () => {
    expect([...FARBSLUGS].sort()).toEqual([...SCHEMA_ENUM].sort());
  });

  it("liefert für jeden Slug einen #rrggbb-Hex", () => {
    for (const slug of SCHEMA_ENUM) {
      expect(FARBSLUG_HEX[slug as keyof typeof FARBSLUG_HEX]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("farbHex fällt bei unbekanntem Slug sauber zurück", () => {
    expect(farbHex("gibt-es-nicht")).toBe("#cccccc");
    expect(farbHex(null)).toBe("#cccccc");
    expect(farbHex("salbei")).toBe(FARBSLUG_HEX.salbei);
  });
});

describe("loeseFarbSlug – Rangfolge MANUELL > KI > Default", () => {
  const varianten = ["hellgrau", "schwarz"] as const;

  it("nimmt den manuellen Override vor allem anderen", () => {
    expect(loeseFarbSlug(varianten, "schwarz", "salbei")).toBe("salbei");
  });

  it("nimmt die KI-Farbe, wenn kein Override gesetzt ist", () => {
    expect(loeseFarbSlug(varianten, "schwarz", null)).toBe("schwarz");
  });

  it("fällt auf die erste Variante (Default) zurück", () => {
    expect(loeseFarbSlug(varianten, null, null)).toBe("hellgrau");
  });

  it("liefert undefined ohne Varianten und ohne Override", () => {
    expect(loeseFarbSlug(undefined, null, null)).toBeUndefined();
    expect(loeseFarbSlug([], null, null)).toBeUndefined();
  });

  it("ignoriert unbekannte Slugs (Erdung liegt beim Kurator)", () => {
    expect(loeseFarbSlug(varianten, "gibt-es-nicht", null)).toBeUndefined();
  });
});
