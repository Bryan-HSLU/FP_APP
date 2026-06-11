"""Lokaler FastAPI-Dienst – API-Oberfläche gemäss Engineering-Grundlagen-POC §1.

Endpunkte kommen meilensteinweise dazu (M1: /validate, M3: /solve, /evaluate …).
Fehler-Envelope einheitlich: {code, message, details}.
"""

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from fp_engines import __version__
from fp_engines.auswertung import evaluate_plan
from fp_engines.baseline import baseline_auswahl
from fp_engines.pdf import kv_pdf
from fp_engines.rules import build_scene, evaluate_rules
from fp_engines.solver import NoFeasiblePlacement, solve

REPO_ROOT = Path(__file__).resolve().parents[4]
DATA_RULES = REPO_ROOT / "data" / "rules"
DATA_CATALOG = REPO_ROOT / "data" / "catalog"
FIXTURE_ROOMS = REPO_ROOT / "packages" / "shared" / "fixtures" / "artefakte"

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


def _catalog(room_type: str) -> list[dict[str, Any]]:
    path = DATA_CATALOG / f"{room_type}.json"
    if not path.is_file():
        raise FileNotFoundError(room_type)
    return json.loads(path.read_text(encoding="utf-8"))  # type: ignore[no-any-return]


@app.get("/samples/rooms")
def samples_rooms() -> list[dict[str, Any]]:
    """Sample-/Import-Raummodelle für den POC-Klickpfad (ADR-0005: Scan entkoppelt)."""
    rooms = []
    for f in sorted(FIXTURE_ROOMS.glob("raummodell.*.json")):
        rooms.append(json.loads(f.read_text(encoding="utf-8")))
    return rooms


@app.get("/catalog/{room_type}")
def catalog(room_type: str) -> Any:
    """Katalog-Stammdaten je Raumtyp (Viewer braucht Masse für Box-Platzhalter)."""
    try:
        return _catalog(room_type)
    except FileNotFoundError:
        return JSONResponse(
            status_code=404,
            content={
                "code": "SCHEMA_INVALID",
                "message": f"Kein Katalog für «{room_type}»",
                "details": {},
            },
        )


class SolveRequest(BaseModel):
    """Raum + (optionale) Auswahl + seed → normkonformer Plan.

    Ohne `auswahl` läuft die deterministische Kurator-Baseline (ADR-0007-Fallback).
    Gleicher Input + gleicher seed ⇒ gleicher Plan («Variante würfeln» = seed+1).
    """

    room: dict[str, Any]
    seed: int = 1
    normProfile: str = "ch"
    auswahl: list[str] | None = None
    stilprofilRef: str | None = None


@app.post("/solve")
def solve_endpoint(req: SolveRequest) -> JSONResponse:
    try:
        katalog = _catalog(req.room["roomType"])
        rules = _load_rulesets(["basis", req.room["roomType"]])
    except FileNotFoundError as e:
        return JSONResponse(
            status_code=400,
            content={
                "code": "SCHEMA_INVALID",
                "message": f"Stammdaten fehlen: {e.args[0]}",
                "details": {},
            },
        )
    if req.auswahl is None:
        sel = baseline_auswahl(req.room, katalog)
        auswahl, absichten = sel["auswahl"], sel["relationaleAbsichten"]
    else:
        auswahl, absichten = req.auswahl, []
    try:
        plan = solve(
            req.room, auswahl, absichten, katalog, rules,
            seed=req.seed, norm_profile=req.normProfile,
            stilprofil_ref=req.stilprofilRef,
            created_at=datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        )
    except NoFeasiblePlacement as e:
        # Ehrliches Solver-Ergebnis (Engineering-Grundlagen §1) – kein 500.
        return JSONResponse(
            status_code=422,
            content={
                "code": "NO_FEASIBLE_PLACEMENT",
                "message": str(e),
                "details": {"funktionsTyp": e.funktions_typ},
            },
        )
    hinweis = {} if req.room["meta"]["geometryConfirmed"] else {"hinweis": "GEOMETRY_UNCONFIRMED"}
    return JSONResponse(content={"plan": plan, **hinweis})


class EvaluateRequest(BaseModel):
    room: dict[str, Any]
    plan: dict[str, Any]


@app.post("/evaluate")
def evaluate_endpoint(req: EvaluateRequest) -> JSONResponse:
    """Plan → Mengen + Kostenschätzung (Bandbreite, nie Offerte)."""
    katalog = _catalog(req.room["roomType"])
    return JSONResponse(content=evaluate_plan(req.room, req.plan, katalog))


@app.post("/export/kv-pdf")
def export_kv_pdf(req: EvaluateRequest) -> Response:
    """Kostenschätzung als PDF (CI-Look, Disclaimer «keine Offerte»)."""
    katalog = _catalog(req.room["roomType"])
    daten = kv_pdf(evaluate_plan(req.room, req.plan, katalog))
    return Response(
        content=daten,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="kostenschaetzung.pdf"'},
    )
