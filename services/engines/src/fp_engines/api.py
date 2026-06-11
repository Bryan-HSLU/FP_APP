"""Lokaler FastAPI-Dienst – API-Oberfläche gemäss Engineering-Grundlagen-POC §1.

Endpunkte kommen meilensteinweise dazu (M1: /validate, M3: /solve, /evaluate …).
Fehler-Envelope einheitlich: {code, message, details}.
"""

import json
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from fp_engines import __version__
from fp_engines.rules import build_scene, evaluate_rules

REPO_ROOT = Path(__file__).resolve().parents[4]
DATA_RULES = REPO_ROOT / "data" / "rules"

app = FastAPI(title="Future Planning – Engines", version=__version__)


@app.get("/health")
def health() -> dict[str, Any]:
    """Lebenszeichen für Setup-Script und Frontend-Proxy."""
    return {"status": "ok", "version": __version__}


class ValidateRequest(BaseModel):
    """Plan gegen den Norm-Regelsatz prüfen (Servergegencheck zum TS-Live-Check).

    rulesets: Namen unter data/rules/ (Default: basis + Raumtyp des Raums).
    """

    room: dict[str, Any]
    plan: dict[str, Any]
    catalog: list[dict[str, Any]]
    rulesets: list[str] | None = None


def _load_rulesets(names: list[str]) -> list[dict[str, Any]]:
    rules: list[dict[str, Any]] = []
    for name in names:
        path = DATA_RULES / f"{name}.json"
        if not path.is_file():
            raise FileNotFoundError(name)
        rules.extend(json.loads(path.read_text(encoding="utf-8")))
    return rules


@app.post("/validate")
def validate(req: ValidateRequest) -> JSONResponse:
    """constraintReport für einen Plan – dieselbe Urteilslogik wie der TS-Interpreter."""
    names = req.rulesets if req.rulesets is not None else ["basis", req.room["roomType"]]
    try:
        rules = _load_rulesets(names)
    except FileNotFoundError as e:
        return JSONResponse(
            status_code=400,
            content={
                "code": "SCHEMA_INVALID",
                "message": f"Unbekanntes Regelset: {e.args[0]}",
                "details": {"verfuegbar": sorted(p.stem for p in DATA_RULES.glob("*.json"))},
            },
        )
    try:
        scene = build_scene(req.room, req.plan, req.catalog)
    except (KeyError, ValueError) as e:
        return JSONResponse(
            status_code=400,
            content={"code": "SCHEMA_INVALID", "message": str(e), "details": {}},
        )
    return JSONResponse(content={"constraintReport": evaluate_rules(scene, rules)})
