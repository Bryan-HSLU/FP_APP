"""LV-Ableitung + Bauzeitenplan + Dokument-Exporte (M4): deterministisch + Smoke."""

import json
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from fp_engines.api import app
from fp_engines.baseline import baseline_auswahl
from fp_engines.bauzeit import erzeuge_bauzeitenplan
from fp_engines.lv import erzeuge_lv
from fp_engines.solver import solve

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURES = REPO_ROOT / "packages" / "shared" / "fixtures" / "artefakte"


def _load(p: Path) -> Any:
    return json.loads(p.read_text(encoding="utf-8"))


CATALOG = _load(REPO_ROOT / "data" / "catalog" / "bad.json")
RULES = _load(REPO_ROOT / "data" / "rules" / "basis.json") + _load(
    REPO_ROOT / "data" / "rules" / "bad.json"
)
POSITIONEN = _load(REPO_ROOT / "data" / "positions" / "bad.json")
SEQUENZ = _load(REPO_ROOT / "data" / "sequence" / "bad.json")


def _plan_und_raum() -> tuple[dict[str, Any], dict[str, Any]]:
    room = _load(FIXTURES / "raummodell.bad-sample.json")
    sel = baseline_auswahl(room, CATALOG)
    plan = solve(
        room,
        sel["auswahl"],
        sel["relationaleAbsichten"],
        CATALOG,
        RULES,
        seed=1,
        created_at="2026-06-11T12:00:00Z",
    )
    return room, plan


def test_lv_ableitung_rueckverfolgbar() -> None:
    room, plan = _plan_und_raum()
    lv = erzeuge_lv(room, plan, CATALOG, POSITIONEN)
    # Jede Position hat mindestens einen Herkunfts-Verweis (Trigger im Plan).
    assert all(p["herkunft"] for p in lv["positionen"])
    pos_nrn = {p["posNr"] for p in lv["positionen"]}
    assert "230.20" in pos_nrn  # Montage Sanitär (3× P1 platziert)
    assert "100.10" in pos_nrn  # Baustelleneinrichtung (projekt-Trigger)
    montage = next(p for p in lv["positionen"] if p["posNr"] == "230.20")
    assert montage["menge"] == 3  # wc + lavabo + dusche
    # Anschlusspunkte: einmal je funktionsTyp, nicht je Stück
    anschluss = next(p for p in lv["positionen"] if p["posNr"] == "230.30")
    assert anschluss["menge"] == 3
    assert lv["summe_chf"] == round(sum(p["total_chf"] for p in lv["positionen"]), 2)


def test_keine_demontage_ohne_bestand() -> None:
    """Demontage triggert auf Bestandsobjekte – Sample-Bad hat keine → keine Position."""
    room, plan = _plan_und_raum()
    lv = erzeuge_lv(room, plan, CATALOG, POSITIONEN)
    assert "230.10" not in {p["posNr"] for p in lv["positionen"]}


def test_bauzeitenplan_sequenz_und_trocknung() -> None:
    room, plan = _plan_und_raum()
    lv = erzeuge_lv(room, plan, CATALOG, POSITIONEN)
    bz = erzeuge_bauzeitenplan(lv, SEQUENZ)
    zeilen = {z["phase"]: z for z in bz["zeilen"]}
    # Phasen starten erst nach Ende + Trocknung des Vorgängers
    if "abdichtung" in zeilen and "belaege" in zeilen:
        abd = zeilen["abdichtung"]
        ende_mit_trocknung = abd["start_tag"] + abd["dauer_tage"] + abd["trocknung_tage"]
        assert zeilen["belaege"]["start_tag"] >= ende_mit_trocknung
    assert bz["gesamtdauer_arbeitstage"] > 0
    assert bz["von_tage"] < bz["gesamtdauer_arbeitstage"] < bz["bis_tage"]


def test_alle_dokument_exporte_ueber_api() -> None:
    """M4-DoD: alle MVP-Dokumente generierbar (LV, Bauzeit, Offerte, DXF, KV)."""
    room, plan = _plan_und_raum()
    client = TestClient(app)
    body = {"room": room, "plan": plan}
    assert client.post("/export/lv", json=body).json()["positionen"]
    pdf_pfade = [
        "/export/lv-pdf",
        "/export/bauzeitenplan-pdf",
        "/export/offertanfrage",
        "/export/kv-pdf",
    ]
    for pfad in pdf_pfade:
        res = client.post(pfad, json=body)
        assert res.status_code == 200, pfad
        assert res.content[:5] == b"%PDF-", pfad
    bz = client.post("/export/bauzeitenplan", json=body).json()
    assert bz["zeilen"]
    dxf = client.post("/export/dxf", json=body)
    assert dxf.status_code == 200
    assert b"WAENDE" in dxf.content and b"MOEBEL" in dxf.content
