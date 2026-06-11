"""Generiert pydantic-v2-Modelle aus den JSON-Schemas (Verträge).

Quelle: packages/shared/schemas/ → Ziel: src/fp_engines/generated/.
Generierte Files NIE von Hand ändern. TS-Gegenstück:
packages/shared/scripts/codegen.ts. Aufruf: pnpm codegen (Repo-Root).
"""

import subprocess
import sys
from pathlib import Path

ENGINES = Path(__file__).resolve().parents[1]
REPO_ROOT = ENGINES.parents[1]
SCHEMAS = REPO_ROOT / "packages" / "shared" / "schemas"
OUT = ENGINES / "src" / "fp_engines" / "generated"


def main() -> None:
    OUT.mkdir(exist_ok=True)
    (OUT / "__init__.py").write_text(
        '"""AUTOGENERIERT aus packages/shared/schemas – nicht von Hand ändern (pnpm codegen)."""\n',
        encoding="utf-8",
    )
    for schema in sorted(SCHEMAS.glob("*.schema.json")):
        name = schema.name.removesuffix(".schema.json").replace("-", "_")
        target = OUT / f"{name}.py"
        subprocess.run(
            [
                "datamodel-codegen",
                "--input",
                str(schema),
                "--input-file-type",
                "jsonschema",
                "--output",
                str(target),
                "--output-model-type",
                "pydantic_v2.BaseModel",
                "--target-python-version",
                "3.12",
                "--use-schema-description",
                "--use-double-quotes",
                "--disable-timestamp",
                "--custom-file-header",
                "# AUTOGENERIERT aus packages/shared/schemas – nicht von Hand ändern.",
            ],
            check=True,
        )
        print(f"✅ {schema.name} → {target.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    sys.exit(main())
