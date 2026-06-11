"""Schema-Validierung (Python-Seite): Fixtures + data/ gegen die Verträge.

TS-Gegenstück: packages/shared/tests/schemas.test.ts (Ajv). Beide Validatoren
müssen dieselben Instanzen akzeptieren – sonst driften die Verträge.
"""

import json
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

REPO_ROOT = Path(__file__).resolve().parents[3]
SCHEMAS = REPO_ROOT / "packages" / "shared" / "schemas"
FIXTURES = REPO_ROOT / "packages" / "shared" / "fixtures" / "artefakte"
DATA = REPO_ROOT / "data"


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


_REGISTRY = Registry().with_resources(
    (f.name, Resource.from_contents(_load(f))) for f in SCHEMAS.glob("*.schema.json")
)


def _validator(schema_name: str) -> Draft202012Validator:
    schema = _load(SCHEMAS / f"{schema_name}.schema.json")
    return Draft202012Validator(schema, registry=_REGISTRY, format_checker=FormatChecker())


FIXTURE_MAP = [
    ("raummodell.bad-sample.json", "raummodell", False),
    ("raummodell.r1-wc.json", "raummodell", False),
    ("plan.bad-ok.json", "plan", False),
    ("plan.bad-verletzt.json", "plan", False),
    ("stilprofil.beispiel.json", "stilprofil", False),
    ("katalog-items.bad.json", "katalog-item", True),
    ("bild-katalog-items.beispiel.json", "bild-katalog-item", True),
    ("kurator-vertrag.beispiel.json", "kurator-vertrag", False),
    ("projekt.beispiel.json", "projekt", False),
]


@pytest.mark.parametrize(("file", "schema", "is_array"), FIXTURE_MAP)
def test_fixture_valid(file: str, schema: str, is_array: bool) -> None:
    raw = _load(FIXTURES / file)
    validator = _validator(schema)
    for instance in raw if is_array else [raw]:
        errors = [f"{e.json_path}: {e.message}" for e in validator.iter_errors(instance)]
        assert errors == []


@pytest.mark.parametrize("ruleset", ["basis", "bad"])
def test_rules_valid(ruleset: str) -> None:
    validator = _validator("regel")
    for rule in _load(DATA / "rules" / f"{ruleset}.json"):
        errors = [f"{e.json_path}: {e.message}" for e in validator.iter_errors(rule)]
        assert errors == []


def test_taxonomy_valid() -> None:
    validator = _validator("taxonomie")
    errors = [
        f"{e.json_path}: {e.message}"
        for e in validator.iter_errors(_load(DATA / "taxonomy" / "stilachsen.json"))
    ]
    assert errors == []
