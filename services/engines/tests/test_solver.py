"""Solver-Invariante ⭐ (Property-Test, Engineering-Grundlagen §3):

Jeder gelieferte Plan hat 0 ❌ im constraintReport – über viele Seeds und
beide Test-Räume (Sample-Bad + echtes L-WC R1). Zusätzlich: jeder Plan
validiert gegen das Plan-Schema (Vertrag 2) und ist seed-deterministisch.
"""

import json
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator, FormatChecker

from fp_engines.baseline import baseline_auswahl
from fp_engines.solver import NoFeasiblePlacement, solve

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURES = REPO_ROOT / "packages" / "shared" / "fixtures" / "artefakte"


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


CATALOG = _load(REPO_ROOT / "data" / "catalog" / "bad.json")
RULES = _load(REPO_ROOT / "data" / "rules" / "basis.json") + _load(
    REPO_ROOT / "data" / "rules" / "bad.json"
)
ROOMS = ["raummodell.bad-sample", "raummodell.r1-wc"]
PLAN_VALIDATOR = Draft202012Validator(
    _load(REPO_ROOT / "packages" / "shared" / "schemas" / "plan.schema.json"),
    format_checker=FormatChecker(),
)


def _solve(room_name: str, seed: int) -> dict[str, Any]:
    room = _load(FIXTURES / f"{room_name}.json")
    sel = baseline_auswahl(room, CATALOG)
    return solve(
        room,
        sel["auswahl"],
        sel["relationaleAbsichten"],
        CATALOG,
        RULES,
        seed=seed,
        created_at="2026-06-11T12:00:00Z",
    )


@pytest.mark.parametrize("room_name", ROOMS)
@pytest.mark.parametrize("seed", range(12))
def test_solver_invariante_0_verletzt(room_name: str, seed: int) -> None:
    plan = _solve(room_name, seed)
    assert plan["constraintReport"]["hard"]["summary"]["verletzt"] == 0
    assert plan["constraintReport"]["hard"]["ok"] is True


@pytest.mark.parametrize("room_name", ROOMS)
def test_plan_validiert_gegen_schema(room_name: str) -> None:
    plan = _solve(room_name, 1)
    errors = [f"{e.json_path}: {e.message}" for e in PLAN_VALIDATOR.iter_errors(plan)]
    assert errors == []


def test_determinismus_gleicher_seed_gleicher_plan() -> None:
    assert _solve("raummodell.bad-sample", 5) == _solve("raummodell.bad-sample", 5)


def test_varianten_verschiedene_seeds() -> None:
    """«Würfeln»: verschiedene Seeds liefern (im grossen Raum) verschiedene Posen."""
    posen = {
        json.dumps([p["pose"] for p in _solve("raummodell.bad-sample", s)["placements"]])
        for s in range(6)
    }
    assert len(posen) > 1


def test_p1_pflicht_im_grossen_bad_komplett() -> None:
    plan = _solve("raummodell.bad-sample", 1)
    typen = {
        next(c["funktionsTyp"] for c in CATALOG if c["id"] == p["catalogItemId"])
        for p in plan["placements"]
    }
    assert {"wc", "lavabo", "dusche"} <= typen


def test_no_feasible_placement_ist_ehrlich() -> None:
    """Auswahl, die nie passt (Dusche im 1.56-m²-WC) → Exception statt Regelbruch."""
    room = _load(FIXTURES / "raummodell.r1-wc.json")
    dusche = next(c["id"] for c in CATALOG if c["funktionsTyp"] == "dusche")
    with pytest.raises(NoFeasiblePlacement):
        solve(room, [dusche], [], CATALOG, RULES, seed=1)
