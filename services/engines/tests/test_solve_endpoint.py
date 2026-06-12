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
    import json as _json
    from pathlib import Path as _Path

    catalog = _json.loads(
        (_Path(__file__).resolve().parents[3] / "data" / "catalog" / "bad.json").read_text()
    )
    dusche = max(
        (c for c in catalog if c["funktionsTyp"] == "dusche"),
        key=lambda c: c["masse"]["w"] * c["masse"]["d"],
    )["id"]
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


def test_kueche_formen_endpoint() -> None:
    """M6: /kueche/formen liefert Top-3 Formen für die Sample-Küche."""
    client = TestClient(app)
    room = _room("raummodell.kueche-sample")
    res = client.post("/kueche/formen", json={"room": room})
    assert res.status_code == 200
    formen = res.json()["formen"]
    assert 1 <= len(formen) <= 3
    assert all("form" in f and "score" in f and "begruendung" in f for f in formen)
    assert "insel" not in {f["form"] for f in formen}


def test_solve_kueche_smoke() -> None:
    """M6: /solve auf der Sample-Küche → Baugruppe mit assemblies, 0 ❌."""
    client = TestClient(app)
    room = _room("raummodell.kueche-sample")
    res = client.post("/solve", json={"room": room, "seed": 1, "normProfile": "eu"})
    assert res.status_code == 200
    body = res.json()
    plan = body["plan"]
    assert plan["constraintReport"]["hard"]["summary"]["verletzt"] == 0
    assert plan["assemblies"][0]["type"] == "kuechenzeile"
    assert plan["meta"]["normProfile"] == "eu"
    assert body["room"]["id"] == room["id"]


def test_solve_grossraum_zone_room_zurueck() -> None:
    """M6: /solve mit zoneId plant den Teilraum; Response.room ist der Teilraum,
    Placements liegen in der Zone (x ≤ 2.8)."""
    client = TestClient(app)
    gr = _room("raummodell.grossraum-sample")
    zid = "aaaa0001-3000-4000-8000-000000003001"
    res = client.post("/solve", json={"room": gr, "seed": 1, "zoneId": zid, "form": "l"})
    assert res.status_code == 200
    body = res.json()
    assert body["room"]["id"] != gr["id"]  # eigenständiger Teilraum
    assert body["room"]["roomType"] == "kueche"
    assert all(p["pose"]["pos"][0] <= 2.8 + 1e-6 for p in body["plan"]["placements"])


def test_export_kueche_plan() -> None:
    """M6: LV (JSON) + glTF laufen für einen Küchen-Plan (placements-basiert)."""
    client = TestClient(app)
    room = _room("raummodell.kueche-sample")
    plan = client.post("/solve", json={"room": room, "seed": 1}).json()["plan"]
    lv = client.post("/export/lv", json={"room": room, "plan": plan})
    assert lv.status_code == 200
    gltf = client.post("/export/gltf", json={"room": room, "plan": plan})
    assert gltf.status_code == 200


def test_solve_wohnen_kernmoebel() -> None:
    """M5: Sample-Wohnzimmer → /solve liefert Plan mit Sofa + Esstisch + TV-Möbel."""
    client = TestClient(app)
    room = _room("raummodell.wohnen-sample")
    res = client.post("/solve", json={"room": room, "seed": 1})
    assert res.status_code == 200
    plan = res.json()["plan"]
    assert plan["constraintReport"]["hard"]["summary"]["verletzt"] == 0
    katalog = client.get("/catalog/wohnen").json()
    by_id = {c["id"]: c for c in katalog}
    typen = {by_id[p["catalogItemId"]]["funktionsTyp"] for p in plan["placements"]}
    assert {"sofa", "esstisch", "tvmoebel"} <= typen
