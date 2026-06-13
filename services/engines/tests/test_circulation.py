"""Verkehrsweg-Freiraum (circulation) – Verhalten des Python-Interpreters.

Parität TS↔Python ist über den goldenen Paritätstest (test_parity.py, Fall
`flur-circulation-verletzt`) abgedeckt; hier die fachliche Logik v0:
freier Korridor → ok, blockierter Korridor → verletzt, Raum ohne Tür → n/a.
"""

import json
from pathlib import Path
from typing import Any

from fp_engines.rules import build_scene, evaluate_rules

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURES = REPO_ROOT / "packages" / "shared" / "fixtures" / "artefakte"
DATA_RULES = REPO_ROOT / "data" / "rules"


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


BASIS = _load(DATA_RULES / "basis.json")
_VERKEHRSWEG = [r for r in BASIS if r["id"] == "basis-verkehrsweg"]


def _circulation(
    room: dict[str, Any], plan: dict[str, Any], catalog: list[dict[str, Any]]
) -> dict[str, Any]:
    report = evaluate_rules(build_scene(room, plan, catalog), _VERKEHRSWEG)
    return next(r for r in report["results"] if r["ruleId"] == "basis-verkehrsweg")


def test_freier_korridor_ok() -> None:
    """Sample-Bad mit wandständigen Objekten: breiter Korridor → ok, Marge > 0."""
    room = _load(FIXTURES / "raummodell.bad-sample.json")
    plan = _load(FIXTURES / "plan.bad-ok.json")
    catalog = _load(FIXTURES / "katalog-items.bad.json")
    res = _circulation(room, plan, catalog)
    assert res["status"] == "ok"
    assert res["margin_cm"] is not None and res["margin_cm"] > 0


def test_trennwand_blockiert_verletzt() -> None:
    """Trennwand pincht den Korridor zwischen zwei Türen < 0.90 m → verletzt."""
    room = _load(FIXTURES / "raummodell.flur-test.json")
    plan = _load(FIXTURES / "plan.flur-test.json")
    catalog = _load(FIXTURES / "katalog-items.flur-test.json")
    res = _circulation(room, plan, catalog)
    assert res["status"] == "verletzt"
    assert res["margin_cm"] is not None and res["margin_cm"] < 0


def test_ohne_tuer_nicht_anwendbar() -> None:
    """Ohne Tür gibt es keine Durchgangs-Anforderung → trivial ok (Marge None)."""
    room = _load(FIXTURES / "raummodell.flur-test.json")
    room["openings"] = []
    for w in room["shell"]["walls"]:
        w["openings"] = []
    plan = _load(FIXTURES / "plan.flur-test.json")
    catalog = _load(FIXTURES / "katalog-items.flur-test.json")
    res = _circulation(room, plan, catalog)
    assert res["status"] == "ok"
    assert res["margin_cm"] is None


def test_wandobjekt_blockiert_korridor_nicht() -> None:
    """Wandmontierte Objekte (mount=wand) versperren den Boden-Korridor nicht."""
    room = _load(FIXTURES / "raummodell.flur-test.json")
    catalog = _load(FIXTURES / "katalog-items.flur-test.json")
    catalog[0]["mount"] = "wand"  # dieselbe Trennwand, jetzt wandmontiert
    plan = _load(FIXTURES / "plan.flur-test.json")
    plan["placements"][0]["mountHeight"] = 1.4
    res = _circulation(room, plan, catalog)
    assert res["status"] == "ok"
