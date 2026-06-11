"""Stil-Engine: Swipe-Aggregation, Preset-Weg, Schema-Konformität des Profils."""

import json
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator, FormatChecker

from fp_engines.api import app

REPO_ROOT = Path(__file__).resolve().parents[3]
BILDER = json.loads((REPO_ROOT / "data" / "images" / "bad.json").read_text(encoding="utf-8"))
VALIDATOR = Draft202012Validator(
    json.loads(
        (REPO_ROOT / "packages" / "shared" / "schemas" / "stilprofil.schema.json").read_text()
    ),
    format_checker=FormatChecker(),
)


def _ids(praedikat: Any) -> list[str]:
    return [b["id"] for b in BILDER if praedikat(b)]


def test_swipe_profil_aggregiert_und_validiert() -> None:
    client = TestClient(app)
    warm = _ids(lambda b: b["achsenTags"].get("temperatur", 0) > 0)
    kalt = _ids(lambda b: b["achsenTags"].get("temperatur", 0) < 0)
    res = client.post("/style/profile", json={"roomType": "bad", "likes": warm, "dislikes": kalt})
    profil = res.json()
    assert [f"{e.json_path}: {e.message}" for e in VALIDATOR.iter_errors(profil)] == []
    # Warme Likes + kühle Dislikes ⇒ deutlich warmer Vektor
    assert profil["styleVector"]["temperatur"] > 0.4
    assert profil["meta"]["method"] == "swipe"
    assert profil["meta"]["sampleSufficient"] is (len(warm) + len(kalt) >= 6)
    assert profil["palette"]


def test_preset_profil() -> None:
    client = TestClient(app)
    preset = next(b for b in BILDER if b["istPreset"])
    res = client.post("/style/profile", json={"roomType": "bad", "presetId": preset["id"]})
    profil = res.json()
    assert profil["meta"]["method"] == "preset"
    assert profil["styleVector"] == preset["presetProfile"]
    assert profil["meta"]["sampleSufficient"] is True


def test_bilder_endpoint_und_statics() -> None:
    client = TestClient(app)
    bilder = client.get("/images/bad").json()
    assert len(bilder) == 8
    svg = client.get(f"/bilder/{bilder[0]['bildRef']}")
    assert svg.status_code == 200
    assert b"<svg" in svg.content


def test_stil_bis_plan_durchstich() -> None:
    """Swipe → Profil → /curate → /solve: der ganze M4-Pfad hängt zusammen."""
    client = TestClient(app)
    room = json.loads(
        (
            REPO_ROOT
            / "packages"
            / "shared"
            / "fixtures"
            / "artefakte"
            / "raummodell.bad-sample.json"
        ).read_text()
    )
    profil = client.post(
        "/style/profile", json={"roomType": "bad", "likes": [b["id"] for b in BILDER[:6]]}
    ).json()
    kur = client.post("/curate", json={"room": room, "stilprofil": profil, "seed": 2}).json()
    assert kur["port"] == "baseline"
    assert kur["kurator"]["auswahl"]
    res = client.post(
        "/solve",
        json={
            "room": room,
            "seed": 2,
            "auswahl": kur["kurator"]["auswahl"],
            "relationaleAbsichten": kur["kurator"]["relationaleAbsichten"],
            "stilprofilRef": profil["id"],
        },
    )
    assert res.status_code == 200
    assert res.json()["plan"]["constraintReport"]["hard"]["summary"]["verletzt"] == 0
