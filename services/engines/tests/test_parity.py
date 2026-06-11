"""Regel-Paritätstest ⭐ (Python-Seite) gegen die goldenen Reports.

TS-Gegenstück: packages/shared/tests/parity.test.ts. Beide Seiten müssen auf
denselben Fixtures identisch urteilen. Goldens bewusst aktualisieren via
scripts/update_goldens.py (im selben Commit wie die Interpreter-Änderung).
"""

import json
from pathlib import Path
from typing import Any

import pytest

from fp_engines.rules import build_scene, evaluate_rules

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURES = REPO_ROOT / "packages" / "shared" / "fixtures"
DATA_RULES = REPO_ROOT / "data" / "rules"


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


CASES = _load(FIXTURES / "rule-parity" / "cases.json")


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_parity(case: dict[str, Any]) -> None:
    room = _load(FIXTURES / "artefakte" / f"{case['room']}.json")
    plan = _load(FIXTURES / "artefakte" / f"{case['plan']}.json")
    catalog = _load(FIXTURES / "artefakte" / f"{case['catalog']}.json")
    rules: list[dict[str, Any]] = []
    for ruleset in case["rules"]:
        rules.extend(_load(DATA_RULES / f"{ruleset}.json"))
    golden = _load(FIXTURES / "rule-parity" / "expected" / f"{case['name']}.json")

    report = evaluate_rules(build_scene(room, plan, catalog), rules)

    assert report["hard"] == golden["hard"]
    assert len(report["results"]) == len(golden["results"])
    for got, want in zip(report["results"], golden["results"], strict=True):
        assert got["ruleId"] == want["ruleId"]
        assert got["status"] == want["status"]
        assert got["placements"] == want["placements"]
        if want["margin_cm"] is None:
            assert got["margin_cm"] is None
        else:
            assert got["margin_cm"] == pytest.approx(want["margin_cm"], abs=1e-9)
