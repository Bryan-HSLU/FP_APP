"""Solver-Invariante ⭐ (Property-Test, Engineering-Grundlagen §3):

Jeder gelieferte Plan hat 0 ❌ im constraintReport – über viele Seeds und
beide Test-Räume (Sample-Bad + echtes L-WC R1). Zusätzlich: jeder Plan
validiert gegen das Plan-Schema (Vertrag 2) und ist seed-deterministisch.
"""

import copy
import json
import math
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator, FormatChecker

from fp_engines.baseline import baseline_auswahl
from fp_engines.rules.geometry import footprint, overlap_depth
from fp_engines.solver import NoFeasiblePlacement, _tuer_korridore, solve

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


# --- Erweiterte Relations-Grammatik (weiche Constraints) --------------------

_WOHNEN_ROOM = _load(FIXTURES / "raummodell.wohnen-sample.json")
_WOHNEN_RULES = _rules("wohnen")
_SOFA = "bbbbbbbb-0001-4000-8000-000000000001"  # P1, boden
_COUCHTISCH = "bbbbbbbb-0009-4000-8000-000000000009"  # P2, boden
_SIDEBOARD = "bbbbbbbb-0015-4000-8000-000000000015"  # P2, boden, d 0.42


def _solve_wohnen(auswahl: list[str], absichten: list[dict[str, Any]], seed: int) -> dict[str, Any]:
    return solve(
        _WOHNEN_ROOM,
        auswahl,
        absichten,
        WOHNEN_CATALOG,
        _WOHNEN_RULES,
        seed=seed,
        created_at="2026-06-11T12:00:00Z",
    )


def _pos(plan: dict[str, Any], item_id: str) -> tuple[float, float]:
    pl = next(p for p in plan["placements"] if p["catalogItemId"] == item_id)
    return (pl["pose"]["pos"][0], pl["pose"]["pos"][1])


def _yaw(plan: dict[str, Any], item_id: str) -> float:
    pl = next(p for p in plan["placements"] if p["catalogItemId"] == item_id)
    return float(pl["pose"]["yawDeg"])


def test_against_wall_platziert_an_wand() -> None:
    """against-wall ⇒ das Boden-Item steht mit dem Rücken an einer Wand."""
    from fp_engines.rules.geometry import dist_point_to_polygon_boundary

    plan = _solve_wohnen([_SIDEBOARD], [{"itemId": _SIDEBOARD, "relation": "against-wall"}], 1)
    assert plan["constraintReport"]["hard"]["summary"]["verletzt"] == 0
    pos = _pos(plan, _SIDEBOARD)
    floor = [tuple(p) for p in _WOHNEN_ROOM["shell"]["floor"]["polygon"]]
    tiefe = next(c["masse"]["d"] for c in WOHNEN_CATALOG if c["id"] == _SIDEBOARD)
    # Wand-Kandidat: Zentrum liegt halbe Tiefe von der Wand (+ Snap-Toleranz).
    assert dist_point_to_polygon_boundary(pos, floor) <= tiefe / 2 + 0.06


def test_facing_richtet_front_zum_ziel() -> None:
    """facing:sofa ⇒ die Front (lokal +z) des Couchtischs zeigt zum Sofa."""
    from fp_engines.rules.geometry import front_dir

    plan = _solve_wohnen(
        [_SOFA, _COUCHTISCH], [{"itemId": _COUCHTISCH, "relation": "facing:sofa"}], 1
    )
    assert plan["constraintReport"]["hard"]["summary"]["verletzt"] == 0
    ct = _pos(plan, _COUCHTISCH)
    sofa = _pos(plan, _SOFA)
    f = front_dir(_yaw(plan, _COUCHTISCH))
    laenge = ((sofa[0] - ct[0]) ** 2 + (sofa[1] - ct[1]) ** 2) ** 0.5
    richtung = ((sofa[0] - ct[0]) / laenge, (sofa[1] - ct[1]) / laenge)
    # Front zeigt zum Sofa: Skalarprodukt deutlich positiv (best-orientierte Pose).
    assert f[0] * richtung[0] + f[1] * richtung[1] > 0.5


def test_group_bringt_mitglieder_nah_zusammen() -> None:
    """group:<id> ⇒ Objekte gleicher Gruppe landen nah beieinander (Sitzgruppe)."""
    absichten = [
        {"itemId": _SOFA, "relation": "group:sitzgruppe"},
        {"itemId": _COUCHTISCH, "relation": "group:sitzgruppe"},
    ]
    plan = _solve_wohnen([_SOFA, _COUCHTISCH], absichten, 4)
    assert plan["constraintReport"]["hard"]["summary"]["verletzt"] == 0
    sofa = _pos(plan, _SOFA)
    ct = _pos(plan, _COUCHTISCH)
    abstand = ((sofa[0] - ct[0]) ** 2 + (sofa[1] - ct[1]) ** 2) ** 0.5
    assert abstand <= 2.0


def test_relationen_erhalten_invariante_ueber_seeds() -> None:
    """Alle neuen Relationen kombiniert: 0 ❌ über viele Seeds (Solver-Invariante)."""
    absichten = [
        {"itemId": _SOFA, "relation": "against-wall"},
        {"itemId": _SOFA, "relation": "facing:couchtisch"},
        {"itemId": _COUCHTISCH, "relation": "group:sitzgruppe"},
        {"itemId": _SIDEBOARD, "relation": "corner"},
        {"itemId": _SIDEBOARD, "relation": "group:sitzgruppe"},
    ]
    for seed in range(8):
        plan = _solve_wohnen([_SOFA, _COUCHTISCH, _SIDEBOARD], absichten, seed)
        assert plan["constraintReport"]["hard"]["summary"]["verletzt"] == 0
        assert plan["constraintReport"]["hard"]["ok"] is True


def test_kaputte_relation_wird_ignoriert_nicht_fatal() -> None:
    """Unbekannte/kaputte Relation ⇒ kein Fehler, gültiger Plan (robuste Ebene)."""
    plan = _solve_wohnen(
        [_SOFA, _COUCHTISCH], [{"itemId": _COUCHTISCH, "relation": "voll-kaputt:???"}], 1
    )
    assert plan["constraintReport"]["hard"]["summary"]["verletzt"] == 0


def test_stil_score_durchgereicht_erhaelt_invariante() -> None:
    """styleVector durchgereicht ⇒ Stil ordnet nur, Plan bleibt normkonform."""
    style = {"styleVector": {"raumgefuehl": 0.9}}
    plan = solve(
        _WOHNEN_ROOM,
        [_SOFA, _COUCHTISCH, _SIDEBOARD],
        [],
        WOHNEN_CATALOG,
        _WOHNEN_RULES,
        seed=2,
        style_profile=style,
        created_at="2026-06-11T12:00:00Z",
    )
    assert plan["constraintReport"]["hard"]["summary"]["verletzt"] == 0


# --- Kurator-Pipeline v2: weiche Anordnung (wandIndex/prioritaet/relationen) ---


def _dist_point_segment(p: tuple[float, float], a: list[float], b: list[float]) -> float:
    ax, az = a[0], a[1]
    bx, bz = b[0], b[1]
    dx, dz = bx - ax, bz - az
    laenge2 = dx * dx + dz * dz
    t = 0.0 if laenge2 == 0 else max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - az) * dz) / laenge2))
    return math.hypot(p[0] - (ax + t * dx), p[1] - (az + t * dz))


def _nearest_wall(pos: tuple[float, float], walls: list[dict[str, Any]]) -> int:
    return min(
        range(len(walls)),
        key=lambda i: _dist_point_segment(pos, walls[i]["start"], walls[i]["end"]),
    )


def _solve_anordnung(
    auswahl: list[str],
    absichten: list[dict[str, Any]],
    anordnung: list[dict[str, Any]],
    seed: int,
    room: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return solve(
        room or _WOHNEN_ROOM,
        auswahl,
        absichten,
        WOHNEN_CATALOG,
        _WOHNEN_RULES,
        seed=seed,
        anordnung=anordnung,
        created_at="2026-06-11T12:00:00Z",
    )


def test_wandindex_platziert_an_gewuenschter_wand() -> None:
    """anordnung.wandIndex ⇒ das Item landet (wenn zulässig) an genau dieser Wand."""
    walls = _WOHNEN_ROOM["shell"]["walls"]
    for wi in range(len(walls)):
        plan = _solve_anordnung([_SIDEBOARD], [], [{"itemId": _SIDEBOARD, "wandIndex": wi}], 2)
        assert plan["constraintReport"]["hard"]["summary"]["verletzt"] == 0
        assert _nearest_wall(_pos(plan, _SIDEBOARD), walls) == wi


def test_wandindex_fallback_bei_unmoeglicher_wand() -> None:
    """Keine zulässige Wand-Pose an der Wunschwand ⇒ weicher Fallback (kein Fehler)."""
    room = copy.deepcopy(_WOHNEN_ROOM)
    room["shell"]["walls"][0]["kind"] = "offen"  # Wand 0 hat keine Wand-Kandidaten mehr
    plan = _solve_anordnung(
        [_SIDEBOARD], [], [{"itemId": _SIDEBOARD, "wandIndex": 0}], 1, room=room
    )
    assert plan["constraintReport"]["hard"]["summary"]["verletzt"] == 0
    # Trotz unerfüllbarem Wandwunsch wird das (optionale) Item platziert.
    assert any(p["catalogItemId"] == _SIDEBOARD for p in plan["placements"])


def test_prioritaet_ordnet_innerhalb_p2() -> None:
    """Kleinere prioritaet ⇒ zuerst platziert (stabile Reihenfolge in der Klasse)."""

    def _reihenfolge(anordnung: list[dict[str, Any]]) -> list[str]:
        plan = _solve_anordnung([_COUCHTISCH, _SIDEBOARD], [], anordnung, 3)
        return [p["catalogItemId"] for p in plan["placements"]]

    vor = _reihenfolge(
        [{"itemId": _SIDEBOARD, "prioritaet": 1}, {"itemId": _COUCHTISCH, "prioritaet": 2}]
    )
    assert vor.index(_SIDEBOARD) < vor.index(_COUCHTISCH)
    nach = _reihenfolge(
        [{"itemId": _SIDEBOARD, "prioritaet": 2}, {"itemId": _COUCHTISCH, "prioritaet": 1}]
    )
    assert nach.index(_COUCHTISCH) < nach.index(_SIDEBOARD)


def test_anordnung_relationen_werden_konsumiert() -> None:
    """anordnung.relationen speisen die weiche Ebene (against-wall ⇒ an die Wand)."""
    from fp_engines.rules.geometry import dist_point_to_polygon_boundary

    plan = _solve_anordnung(
        [_SIDEBOARD], [], [{"itemId": _SIDEBOARD, "relationen": ["against-wall"]}], 1
    )
    assert plan["constraintReport"]["hard"]["summary"]["verletzt"] == 0
    floor = [tuple(p) for p in _WOHNEN_ROOM["shell"]["floor"]["polygon"]]
    tiefe = next(c["masse"]["d"] for c in WOHNEN_CATALOG if c["id"] == _SIDEBOARD)
    assert dist_point_to_polygon_boundary(_pos(plan, _SIDEBOARD), floor) <= tiefe / 2 + 0.06


def test_anordnung_relationen_ueberschreiben_absichten() -> None:
    """Kollidieren absichten und anordnung.relationen je Item, gewinnt die anordnung."""
    from fp_engines.rules.geometry import dist_point_to_polygon_boundary

    # absichten wollen das Sideboard ans Sofa binden; anordnung erzwingt against-wall.
    plan = _solve_anordnung(
        [_SOFA, _SIDEBOARD],
        [{"itemId": _SIDEBOARD, "relation": "pair-with:" + _SOFA}],
        [{"itemId": _SIDEBOARD, "relationen": ["against-wall"]}],
        1,
    )
    assert plan["constraintReport"]["hard"]["summary"]["verletzt"] == 0
    floor = [tuple(p) for p in _WOHNEN_ROOM["shell"]["floor"]["polygon"]]
    tiefe = next(c["masse"]["d"] for c in WOHNEN_CATALOG if c["id"] == _SIDEBOARD)
    assert dist_point_to_polygon_boundary(_pos(plan, _SIDEBOARD), floor) <= tiefe / 2 + 0.06


def test_anordnung_erhaelt_invariante_ueber_seeds() -> None:
    """Kombinierte anordnung (wandIndex + prioritaet + relationen): 0 ❌ über Seeds."""
    anordnung = [
        {"itemId": _SOFA, "wandIndex": 0, "prioritaet": 1, "relationen": ["against-wall"]},
        {"itemId": _COUCHTISCH, "prioritaet": 2, "relationen": ["near:sofa:1.3"]},
        {"itemId": _SIDEBOARD, "wandIndex": 2, "prioritaet": 3, "relationen": ["corner"]},
    ]
    for seed in range(8):
        plan = _solve_anordnung([_SOFA, _COUCHTISCH, _SIDEBOARD], [], anordnung, seed)
        assert plan["constraintReport"]["hard"]["summary"]["verletzt"] == 0
        assert plan["constraintReport"]["hard"]["ok"] is True


# Solvability-Regression: alle solve()-fähigen Raum-Fixtures × Seeds 0–3, jeweils
# mit der (neuen) Baseline-`anordnung` durchgereicht – beweist, dass die weiche
# Anordnungs-Ebene die Feasibility nirgends bricht.
_REGRESSION_RAEUME = [
    ("raummodell.bad-sample", "bad"),
    ("raummodell.bad-gross", "bad"),
    ("raummodell.gaeste-wc", "bad"),
    ("raummodell.r1-wc", "bad"),
    ("raummodell.wohnen-sample", "wohnen"),
    ("raummodell.wohnen-l", "wohnen"),
    ("raummodell.wohnen-lang", "wohnen"),
]


@pytest.mark.parametrize(("room_name", "room_type"), _REGRESSION_RAEUME)
@pytest.mark.parametrize("seed", range(4))
def test_solvability_regression_mit_anordnung(room_name: str, room_type: str, seed: int) -> None:
    room = _load(FIXTURES / f"{room_name}.json")
    catalog = _catalog(room_type)
    rules = _rules(room_type)
    sel = baseline_auswahl(room, catalog)
    plan = solve(
        room,
        sel["auswahl"],
        sel["relationaleAbsichten"],
        catalog,
        rules,
        seed=seed,
        anordnung=sel["anordnung"],
        created_at="2026-06-11T12:00:00Z",
    )
    assert plan["constraintReport"]["hard"]["summary"]["verletzt"] == 0
    assert plan["constraintReport"]["hard"]["ok"] is True


def test_tuer_korridor_frei_von_optionalen() -> None:
    """Verkehrsweg: optionale (P2/P3) Objekte stehen nicht im Tür-Zugangsstreifen."""
    room = _load(FIXTURES / "raummodell.bad-sample.json")
    plan = _solve("raummodell.bad-sample", 3)
    by_id = {c["id"]: c for c in CATALOG}
    korridore = _tuer_korridore(room)
    assert korridore, "Sample-Bad hat eine Tür → mindestens ein Korridor"
    for p in plan["placements"]:
        item = by_id[p["catalogItemId"]]
        if item["priorityClass"] == "P1" or item.get("mount") == "wand":
            continue
        quad = footprint(
            (p["pose"]["pos"][0], p["pose"]["pos"][1]),
            item["masse"]["w"],
            item["masse"]["d"],
            p["pose"]["yawDeg"],
        )
        assert all(overlap_depth(quad, z) is None for z in korridore), item["funktionsTyp"]
