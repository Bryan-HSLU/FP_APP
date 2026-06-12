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


def _rules(room_type: str) -> Any:
    return _load(REPO_ROOT / "data" / "rules" / "basis.json") + _load(
        REPO_ROOT / "data" / "rules" / f"{room_type}.json"
    )


def _catalog(room_type: str) -> Any:
    return _load(REPO_ROOT / "data" / "catalog" / f"{room_type}.json")


CATALOG = _catalog("bad")
RULES = _rules("bad")
# (room_name, roomType) – Bad-Räume + Wohnzimmer (M5, freie Boden-Platzierung).
ROOMS = ["raummodell.bad-sample", "raummodell.r1-wc"]
ALLE_RAEUME = [
    ("raummodell.bad-sample", "bad"),
    ("raummodell.r1-wc", "bad"),
    ("raummodell.wohnen-sample", "wohnen"),
]
PLAN_VALIDATOR = Draft202012Validator(
    _load(REPO_ROOT / "packages" / "shared" / "schemas" / "plan.schema.json"),
    format_checker=FormatChecker(),
)


def _solve(room_name: str, seed: int, room_type: str = "bad") -> dict[str, Any]:
    room = _load(FIXTURES / f"{room_name}.json")
    catalog = _catalog(room_type)
    rules = _rules(room_type)
    sel = baseline_auswahl(room, catalog)
    return solve(
        room,
        sel["auswahl"],
        sel["relationaleAbsichten"],
        catalog,
        rules,
        seed=seed,
        created_at="2026-06-11T12:00:00Z",
    )


@pytest.mark.parametrize(("room_name", "room_type"), ALLE_RAEUME)
@pytest.mark.parametrize("seed", range(12))
def test_solver_invariante_0_verletzt_alle_raeume(
    room_name: str, room_type: str, seed: int
) -> None:
    plan = _solve(room_name, seed, room_type)
    assert plan["constraintReport"]["hard"]["summary"]["verletzt"] == 0
    assert plan["constraintReport"]["hard"]["ok"] is True


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


# --- M5 Wohnen: freie Boden-Platzierung -------------------------------------

WOHNEN_CATALOG = _catalog("wohnen")


def _typ_von(plan: dict[str, Any], catalog: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    by_id = {c["id"]: c for c in catalog}
    return {by_id[p["catalogItemId"]]["funktionsTyp"]: p for p in plan["placements"]}


def test_wohnen_p1_kernmoebel_platziert() -> None:
    """Sofa + Esstisch + TV-Möbel landen im Plan (P1-Kern Wohnzimmer)."""
    plan = _solve("raummodell.wohnen-sample", 1, "wohnen")
    typen = set(_typ_von(plan, WOHNEN_CATALOG))
    assert {"sofa", "esstisch", "tvmoebel"} <= typen


def test_wohnen_freie_platzierung_findet_statt() -> None:
    """Beweis, dass NICHT alles wandgesnapped ist: der Couchtisch steht frei im
    Raum (Abstand zur nächsten Wand > 0.3 m) ODER ist gemäss Relation nah am
    Sofa – beides nur dank der Boden-Kandidaten (vorher nur Wand möglich)."""
    from fp_engines.rules.geometry import dist_point_to_polygon_boundary

    room = _load(FIXTURES / "raummodell.wohnen-sample.json")
    floor = [tuple(p) for p in room["shell"]["floor"]["polygon"]]
    # Seed 0 platziert den Couchtisch deterministisch frei vor dem Sofa.
    plan = _solve("raummodell.wohnen-sample", 0, "wohnen")
    posen = _typ_von(plan, WOHNEN_CATALOG)
    assert "couchtisch" in posen, "Couchtisch sollte bei diesem Seed platziert sein"
    ct = posen["couchtisch"]["pose"]["pos"]
    wandabstand = dist_point_to_polygon_boundary((ct[0], ct[1]), floor)
    sofa = posen["sofa"]["pose"]["pos"]
    center_dist = ((ct[0] - sofa[0]) ** 2 + (ct[1] - sofa[1]) ** 2) ** 0.5
    assert wandabstand > 0.3 or center_dist <= 1.3
