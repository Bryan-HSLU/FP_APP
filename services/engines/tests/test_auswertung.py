"""Auswertung (Mengen/KV) + KV-PDF: deterministische Werte, PDF-Smoke."""

import json
from pathlib import Path
from typing import Any

from fp_engines.auswertung import evaluate_plan
from fp_engines.baseline import baseline_auswahl
from fp_engines.pdf import kv_pdf
from fp_engines.solver import solve

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURES = REPO_ROOT / "packages" / "shared" / "fixtures" / "artefakte"


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


CATALOG = _load(REPO_ROOT / "data" / "catalog" / "bad.json")
RULES = _load(REPO_ROOT / "data" / "rules" / "basis.json") + _load(
    REPO_ROOT / "data" / "rules" / "bad.json"
)


def _plan_und_raum() -> tuple[dict[str, Any], dict[str, Any]]:
    room = _load(FIXTURES / "raummodell.bad-sample.json")
    sel = baseline_auswahl(room, CATALOG)
    plan = solve(
        room, sel["auswahl"], sel["relationaleAbsichten"], CATALOG, RULES,
        seed=1, created_at="2026-06-11T12:00:00Z",
    )
    return room, plan


def test_kv_summen_stimmen() -> None:
    room, plan = _plan_und_raum()
    kv = evaluate_plan(room, plan, CATALOG)
    assert kv["summe_chf"] == sum(p["total_chf"] for p in kv["positionen"])
    assert kv["von_chf"] < kv["summe_chf"] < kv["bis_chf"]
    assert kv["mengen"]["bodenflaeche_m2"] == 7.2
    assert "KEINE Offerte" in kv["hinweis"]
    # «knapp»-Regeln und nicht-geprüfte landen im Next-Steps-Leitfaden
    assert any("verkehrsweg" in s.lower() for s in kv["nextSteps"])


def test_kv_pdf_smoke() -> None:
    room, plan = _plan_und_raum()
    daten = kv_pdf(evaluate_plan(room, plan, CATALOG))
    assert daten[:5] == b"%PDF-"
    assert len(daten) > 1500
