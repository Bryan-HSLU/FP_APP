/**
 * Stammdaten-Hygiene: alle Beispiel-Instanzen (Fixtures) und data/-Files
 * validieren gegen die Verträge. Beidseitig abgesichert – Python-Gegenstück:
 * services/engines/tests/test_schemas.py.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createValidator } from "../src/validation.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(here, "../fixtures/artefakte");
const dataDir = resolve(here, "../../../data");
const validator = createValidator();

const load = (path: string): unknown => JSON.parse(readFileSync(path, "utf-8"));

/** Fixture-Datei → Vertrag (array = Liste von Instanzen). */
const fixtureMap: { file: string; schema: string; array: boolean }[] = [
  { file: "raummodell.bad-sample.json", schema: "raummodell", array: false },
  { file: "raummodell.r1-wc.json", schema: "raummodell", array: false },
  { file: "raummodell.wohnen-sample.json", schema: "raummodell", array: false },
  { file: "raummodell.kueche-sample.json", schema: "raummodell", array: false },
  { file: "raummodell.grossraum-sample.json", schema: "raummodell", array: false },
  { file: "raummodell.flur-test.json", schema: "raummodell", array: false },
  { file: "plan.bad-ok.json", schema: "plan", array: false },
  { file: "plan.bad-verletzt.json", schema: "plan", array: false },
  { file: "plan.flur-test.json", schema: "plan", array: false },
  { file: "stilprofil.beispiel.json", schema: "stilprofil", array: false },
  { file: "katalog-items.bad.json", schema: "katalog-item", array: true },
  { file: "katalog-items.flur-test.json", schema: "katalog-item", array: true },
  { file: "bild-katalog-items.beispiel.json", schema: "bild-katalog-item", array: true },
  { file: "kurator-vertrag.beispiel.json", schema: "kurator-vertrag", array: false },
  { file: "projekt.beispiel.json", schema: "projekt", array: false },
];

describe("Verträge: Beispiel-Instanzen validieren", () => {
  for (const { file, schema, array } of fixtureMap) {
    it(`${file} → ${schema}`, () => {
      const raw = load(join(fixtures, file));
      for (const instance of array ? (raw as unknown[]) : [raw]) {
        const result = validator.validate(schema, instance);
        expect(result.errors).toEqual([]);
        expect(result.ok).toBe(true);
      }
    });
  }
});

describe("Stammdaten (data/) validieren", () => {
  for (const ruleset of ["basis", "bad", "wohnen", "kueche"]) {
    it(`rules/${ruleset}.json → regel`, () => {
      for (const rule of load(join(dataDir, "rules", `${ruleset}.json`)) as unknown[]) {
        const result = validator.validate("regel", rule);
        expect(result.errors).toEqual([]);
      }
    });
  }
  it("taxonomy/stilachsen.json → taxonomie", () => {
    const result = validator.validate("taxonomie", load(join(dataDir, "taxonomy", "stilachsen.json")));
    expect(result.errors).toEqual([]);
  });
});
