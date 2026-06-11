/**
 * Regel-Paritätstest ⭐ (TS-Seite): der TS-Interpreter muss auf den goldenen
 * Fixtures EXAKT die Urteile der Goldens liefern (die der Python-Interpreter
 * erzeugt hat) – identische Status, Margen, Beteiligte, Summary.
 * Python-Gegenstück: services/engines/tests/test_parity.py.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateRules, type Rule } from "../src/rules/interpreter.ts";
import {
  buildScene,
  type CatalogItemInput,
  type PlanInput,
  type RoomInput,
} from "../src/rules/scene.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(here, "../fixtures");
const dataRules = resolve(here, "../../../data/rules");

const load = (path: string): unknown => JSON.parse(readFileSync(path, "utf-8"));

interface Case {
  name: string;
  room: string;
  plan: string;
  catalog: string;
  rules: string[];
}

interface Golden {
  hard: { ok: boolean; summary: Record<string, number> };
  results: {
    ruleId: string;
    status: string;
    margin_cm: number | null;
    placements: string[];
  }[];
}

const cases = load(join(fixtures, "rule-parity", "cases.json")) as Case[];

describe("Regel-Parität TS ↔ Goldens (Python)", () => {
  for (const c of cases) {
    it(c.name, () => {
      const room = load(join(fixtures, "artefakte", `${c.room}.json`)) as RoomInput;
      const plan = load(join(fixtures, "artefakte", `${c.plan}.json`)) as PlanInput;
      const catalog = load(join(fixtures, "artefakte", `${c.catalog}.json`)) as CatalogItemInput[];
      const rules = c.rules.flatMap((r) => load(join(dataRules, `${r}.json`)) as Rule[]);
      const golden = load(join(fixtures, "rule-parity", "expected", `${c.name}.json`)) as Golden;

      const report = evaluateRules(buildScene(room, plan, catalog), rules);

      expect(report.hard).toEqual(golden.hard);
      expect(report.results.length).toBe(golden.results.length);
      for (let i = 0; i < golden.results.length; i++) {
        const got = report.results[i];
        const want = golden.results[i];
        if (!got || !want) throw new Error("Index ausser Bereich");
        expect(got.ruleId).toBe(want.ruleId);
        expect(got.status).toBe(want.status);
        expect(got.placements).toEqual(want.placements);
        if (want.margin_cm === null) {
          expect(got.margin_cm).toBeNull();
        } else {
          expect(got.margin_cm).not.toBeNull();
          // Margen auf 0.1 cm gerundet → müssen bit-identisch sein; Toleranz nur als Schutz.
          expect(Math.abs((got.margin_cm as number) - want.margin_cm)).toBeLessThan(1e-9);
        }
      }
    });
  }
});
