"""E2E über die API: Sample-Raum → /solve → /evaluate → /export/kv-pdf."""

import json
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from fp_engines.api import app

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURES = REPO_ROOT / "packages" / "shared" / "fixtures" / "artefakte"


def _room(name: str) -> Any:
    return json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))


def test_happy_path_raum_bis_pdf() -> None:
    client = TestClient(app)
    room = _room("raummodell.bad-sample")

    res = client.post("/solve", json={"room": room, "seed": 1})
    assert res.status_code == 200
    body = res.json()
    plan = body["plan"]
    assert body["hinweis"] == "GEOMETRY_UNCONFIRMED"  # Ampel-Margen aktiv
    assert plan["constraintReport"]["hard"]["summary"]["verletzt"] == 0

    res = client.post("/evaluate", json={"room": room, "plan": plan})
    assert res.status_code == 200
    assert res.json()["summe_chf"] > 0

    res = client.post("/export/kv-pdf", json={"room": room, "plan": plan})
    assert res.status_code == 200
    assert res.content[:5] == b"%PDF-"


def test_solve_unloesbar_gibt_422() -> None:
    client = TestClient(app)
    room = _room("raummodell.r1-wc")
    dusche = "aaaaaaaa-0003-4000-8000-000000000003"
    res = client.post("/solve", json={"room": room, "auswahl": [dusche]})
    assert res.status_code == 422
    assert res.json()["code"] == "NO_FEASIBLE_PLACEMENT"


def test_samples_und_katalog() -> None:
    client = TestClient(app)
    rooms = client.get("/samples/rooms").json()
    assert {r["name"] for r in rooms} >= {"Sample-Bad 3.0 × 2.4 m"}
    katalog = client.get("/catalog/bad").json()
    assert any(c["funktionsTyp"] == "wc" for c in katalog)
    assert client.get("/catalog/garage").status_code == 404
