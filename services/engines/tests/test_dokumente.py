"""M4-Abschluss: 2D-Plan-PDF, glTF, Gewerke-Übersicht, Einkaufsliste."""

import json
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from fp_engines.api import app
from fp_engines.baseline import baseline_auswahl
from fp_engines.gltf import szene_gltf
from fp_engines.solver import solve

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURES = REPO_ROOT / "packages" / "shared" / "fixtures" / "artefakte"


def _load(p: Path) -> Any:
    return json.loads(p.read_text(encoding="utf-8"))


CATALOG = _load(REPO_ROOT / "data" / "catalog" / "bad.json")
RULES = _load(REPO_ROOT / "data" / "rules" / "basis.json") + _load(
    REPO_ROOT / "data" / "rules" / "bad.json"
)


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


def test_gltf_struktur() -> None:
    room, plan = _plan_und_raum()
    gltf = szene_gltf(room, plan, CATALOG)
    assert gltf["asset"]["version"] == "2.0"
    # Boden + 4 Wände + alle Platzierungen als Nodes
    assert len(gltf["nodes"]) == 1 + len(room["shell"]["walls"]) + len(plan["placements"])
    assert gltf["buffers"][0]["uri"].startswith("data:application/octet-stream;base64,")
    # Alle Node-Mesh-Referenzen gültig
    assert all(0 <= n["mesh"] < len(gltf["meshes"]) for n in gltf["nodes"])


def test_gewerke_und_einkaufsliste_inhalt() -> None:
    room, plan = _plan_und_raum()
    client = TestClient(app)
    body = {"room": room, "plan": plan}
    ueb = client.post("/export/gewerke", json=body).json()
    assert {e["gewerk"] for e in ueb["gewerke"]} >= {"sanitaer"}
    assert all(e["zeitfenster_arbeitstage"] for e in ueb["gewerke"])
    liste = client.post("/export/einkaufsliste", json=body).json()
    assert sum(z["menge"] for z in liste["zeilen"]) == len(plan["placements"])
    assert liste["summe_chf"] > 0


def test_neue_dokumente_ueber_api() -> None:
    room, plan = _plan_und_raum()
    client = TestClient(app)
    body = {"room": room, "plan": plan}
    for pfad in ["/export/plan-pdf", "/export/gewerke-pdf", "/export/einkaufsliste-pdf"]:
        res = client.post(pfad, json=body)
        assert res.status_code == 200, pfad
        assert res.content[:5] == b"%PDF-", pfad
    gltf = client.post("/export/gltf", json=body)
    assert gltf.status_code == 200
    assert gltf.json()["asset"]["version"] == "2.0"
