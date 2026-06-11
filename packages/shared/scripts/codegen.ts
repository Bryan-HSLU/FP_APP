/**
 * Generiert TS-Typen aus den JSON-Schemas (schemas/ → src/generated/).
 * Die pydantic-Seite erzeugt services/engines/scripts/codegen.py.
 * Generierte Files NIE von Hand ändern. Aufruf: pnpm codegen
 */
import { compileFromFile } from "json-schema-to-typescript";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const schemasDir = resolve(here, "../schemas");
const outDir = resolve(here, "../src/generated");
mkdirSync(outDir, { recursive: true });

const banner =
  "/* AUTOGENERIERT aus packages/shared/schemas – nicht von Hand ändern (pnpm codegen). */\n\n";

const indexLines: string[] = [];
for (const file of readdirSync(schemasDir).filter((f) => f.endsWith(".schema.json"))) {
  const name = basename(file, ".schema.json");
  const ts = await compileFromFile(join(schemasDir, file), {
    cwd: schemasDir,
    bannerComment: "",
    additionalProperties: false,
  });
  writeFileSync(join(outDir, `${name}.ts`), banner + ts);
  indexLines.push(`export * from "./${name}.ts";`);
  console.log(`✅ ${file} → src/generated/${name}.ts`);
}
writeFileSync(join(outDir, "index.ts"), banner + indexLines.join("\n") + "\n");
