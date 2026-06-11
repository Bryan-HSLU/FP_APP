/**
 * Schema-Validierung (Ajv, JSON Schema draft 2020-12) über alle Verträge.
 * Wird vom Schema-Check, den Tests und später vom Frontend (Import-Pfade)
 * genutzt. Python-Gegenstück: fp_engines.validation (jsonschema).
 */
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const schemasDir = resolve(dirname(fileURLToPath(import.meta.url)), "../schemas");

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export interface ContractValidator {
  /** Validiert eine Instanz gegen einen Vertrag (Schema-Name ohne Endung). */
  validate(schemaName: string, instance: unknown): ValidationResult;
  schemaNames: string[];
}

export function createValidator(): ContractValidator {
  // allowUnionTypes: Verträge nutzen bewusst Union-Typen (z.B. params: number|string).
  const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
  addFormats(ajv);

  const names: string[] = [];
  for (const file of readdirSync(schemasDir).filter((f) => f.endsWith(".schema.json"))) {
    const schema: unknown = JSON.parse(readFileSync(join(schemasDir, file), "utf-8"));
    const name = basename(file, ".schema.json");
    ajv.addSchema(schema as object, name);
    names.push(name);
  }

  return {
    schemaNames: names,
    validate(schemaName, instance) {
      const validate = ajv.getSchema(schemaName);
      if (!validate) throw new Error(`Unbekanntes Schema: ${schemaName}`);
      const ok = validate(instance) as boolean;
      return {
        ok,
        errors: (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`),
      };
    },
  };
}
