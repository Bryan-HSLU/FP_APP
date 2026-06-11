/**
 * Validiert alle Stammdaten unter data/ gegen die Verträge (schemas/).
 * Stammdaten-Hygiene gemäss Domaenenmodell-Schema-Spezifikation: CI bricht,
 * wenn ein File nicht zum Schema passt. Aufruf: pnpm schema-check
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createValidator } from "../src/validation.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const dataDir = join(repoRoot, "data");

/** Welche data/-Ordner gegen welches Schema geprüft werden.
 *  `array: true` = das File enthält eine Liste von Instanzen. */
const mapping: { dir: string; schema: string; array: boolean }[] = [
  { dir: "rules", schema: "regel", array: true },
  { dir: "taxonomy", schema: "taxonomie", array: false },
  { dir: "catalog", schema: "katalog-item", array: true },
  { dir: "images", schema: "bild-katalog-item", array: true },
];

const validator = createValidator();
let files = 0;
let errors = 0;

for (const { dir, schema, array } of mapping) {
  const full = join(dataDir, dir);
  if (!existsSync(full)) continue;
  for (const name of readdirSync(full).filter((f) => f.endsWith(".json"))) {
    files += 1;
    const raw: unknown = JSON.parse(readFileSync(join(full, name), "utf-8"));
    const instances = array ? (raw as unknown[]) : [raw];
    for (const [i, instance] of instances.entries()) {
      const result = validator.validate(schema, instance);
      if (!result.ok) {
        errors += 1;
        console.error(`❌ data/${dir}/${name}[${i}] verletzt Schema «${schema}»:`);
        for (const msg of result.errors) console.error(`   ${msg}`);
      }
    }
  }
}

if (errors > 0) {
  console.error(`\nSchema-Check fehlgeschlagen: ${errors} Fehler in ${files} Files.`);
  process.exit(1);
}
console.log(`✅ Schema-Check ok (${files} Files geprüft).`);
