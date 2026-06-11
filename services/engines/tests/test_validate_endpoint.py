"""E2E-Smoke für POST /validate: Fixture-Plan → constraintReport über die API."""

import json
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from fp_engines.api import app

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURES = REPO_ROOT / "packages" / "shared" / "fixtures" / "artefakte"


def _load(name: str) -> Any:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def test_validate_ok_plan() -> None:
    res = TestClient(app).post(
        "/validate",
        json={
            "room": _load("raummodell.bad-sample.json"),
            "plan": _load("plan.bad-ok.json"),
            "catalog": _load("katalog-items.bad.json"),
        },
    )
    assert res.status_code == 200
    report = res.json()["constraintReport"]
    assert report["hard"]["ok"] is True
    assert report["hard"]["summary"]["verletzt"] == 0


def test_validate_unbekanntes_regelset() -> None:
    res = TestClient(app).post(
        "/validate",
        json={
            "room": _load("raummodell.bad-sample.json"),
            "plan": _load("plan.bad-ok.json"),
            "catalog": _load("katalog-items.bad.json"),
            "rulesets": ["gibtsnicht"],
        },
    )
    assert res.status_code == 400
    assert res.json()["code"] == "SCHEMA_INVALID"
