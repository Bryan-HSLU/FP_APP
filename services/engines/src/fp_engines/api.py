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
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from fp_engines import __version__
from fp_engines.auswertung import evaluate_plan
from fp_engines.baseline import baseline_auswahl
from fp_engines.bauzeit import erzeuge_bauzeitenplan
from fp_engines.dxf import grundriss_dxf
from fp_engines.lv import erzeuge_lv
from fp_engines.pdf import bauzeit_pdf, kv_pdf, lv_pdf, offertanfrage_pdf
from fp_engines.rules import build_scene, evaluate_rules
from fp_engines.solver import NoFeasiblePlacement, solve

REPO_ROOT = Path(__file__).resolve().parents[4]
DATA_RULES = REPO_ROOT / "data" / "rules"
DATA_CATALOG = REPO_ROOT / "data" / "catalog"
FIXTURE_ROOMS = REPO_ROOT / "packages" / "shared" / "fixtures" / "artefakte"

app = FastAPI(title="Future Planning – Engines", version=__version__)
# Bild-Dateien (SVG-Platzhalter) direkt ausliefern – Frontend: /api/bilder/...
app.mount("/bilder", StaticFiles(directory=REPO_ROOT / "data" / "images"), name="bilder")


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
    relationaleAbsichten: list[dict[str, Any]] = []
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
        auswahl, absichten = req.auswahl, req.relationaleAbsichten
    try:
        plan = solve(
            req.room,
            auswahl,
            absichten,
            katalog,
            rules,
            seed=req.seed,
            norm_profile=req.normProfile,
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


@app.get("/rules/{room_type}")
def rules_for_room(room_type: str) -> Any:
    """Regel-JSON (basis + Raumtyp) – der TS-Live-Check liest DIESELBEN Regeln."""
    try:
        return _load_rulesets(["basis", room_type])
    except FileNotFoundError:
        return _load_rulesets(["basis"])


def _lv_und_bauzeit(req: "EvaluateRequest") -> tuple[dict[str, Any], dict[str, Any]]:
    room_type = req.room["roomType"]
    katalog = _catalog(room_type)
    positionskatalog = json.loads(
        (REPO_ROOT / "data" / "positions" / f"{room_type}.json").read_text(encoding="utf-8")
    )
    sequenz = json.loads(
        (REPO_ROOT / "data" / "sequence" / f"{room_type}.json").read_text(encoding="utf-8")
    )
    lv = erzeuge_lv(req.room, req.plan, katalog, positionskatalog)
    return lv, erzeuge_bauzeitenplan(lv, sequenz)


@app.post("/export/lv")
def export_lv(req: EvaluateRequest) -> JSONResponse:
    """Leistungsverzeichnis (JSON) – Positionen deklarativ aus dem Plan abgeleitet."""
    lv, _ = _lv_und_bauzeit(req)
    return JSONResponse(content=lv)


@app.post("/export/lv-pdf")
def export_lv_pdf(req: EvaluateRequest) -> Response:
    lv, _ = _lv_und_bauzeit(req)
    return Response(
        content=lv_pdf(lv),
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="leistungsverzeichnis.pdf"'},
    )


@app.post("/export/bauzeitenplan")
def export_bauzeitenplan(req: EvaluateRequest) -> JSONResponse:
    _, bz = _lv_und_bauzeit(req)
    return JSONResponse(content=bz)


@app.post("/export/bauzeitenplan-pdf")
def export_bauzeitenplan_pdf(req: EvaluateRequest) -> Response:
    _, bz = _lv_und_bauzeit(req)
    return Response(
        content=bauzeit_pdf(bz),
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="bauzeitenplan.pdf"'},
    )


@app.post("/export/offertanfrage")
def export_offertanfrage(req: EvaluateRequest) -> Response:
    """Offert-Paket je Gewerk (LV ohne Preise + Zeitfenster + Rückgabeblatt)."""
    lv, bz = _lv_und_bauzeit(req)
    return Response(
        content=offertanfrage_pdf(lv, bz),
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="offertanfrage.pdf"'},
    )


@app.post("/export/dxf")
def export_dxf(req: EvaluateRequest) -> Response:
    """2D-Grundriss als DXF (x,z → x,y)."""
    katalog = _catalog(req.room["roomType"])
    return Response(
        content=grundriss_dxf(req.room, req.plan, katalog),
        media_type="application/dxf",
        headers={"Content-Disposition": 'attachment; filename="grundriss.dxf"'},
    )


class CurateRequest(BaseModel):
    """KuratorPort (Vertrag 7): Stilprofil + Raum → Auswahl + relationale Absichten."""

    room: dict[str, Any]
    stilprofil: dict[str, Any] | None = None
    budget: float | None = None
    seed: int = 1


@app.post("/curate")
def curate(req: CurateRequest) -> JSONResponse:
    """Kurator-Aufruf (2–10 s mit LLM); Port via FP_KURATOR_URL, sonst Baseline."""
    from fp_engines.kurator import waehle_port

    katalog = _catalog(req.room["roomType"])
    profil = req.stilprofil or {"styleVector": {}, "derivedRequirements": [], "palette": []}
    port = waehle_port()
    antwort = port.kuratiere(profil, req.room, katalog, req.budget, req.seed)
    return JSONResponse(content={"kurator": antwort, "port": port.name})


@app.get("/images/{room_type}")
def images(room_type: str) -> Any:
    """Bild-Katalog je Raumtyp (raumtyp-gebunden, Stilprofil-Konzept)."""
    path = REPO_ROOT / "data" / "images" / f"{room_type}.json"
    if not path.is_file():
        return JSONResponse(
            status_code=404,
            content={
                "code": "SCHEMA_INVALID",
                "message": f"Keine Bilder für «{room_type}»",
                "details": {},
            },
        )
    return json.loads(path.read_text(encoding="utf-8"))


class StyleProfileRequest(BaseModel):
    """Swipes ODER Preset → Stilprofil (sync, trivial – Engineering-Grundlagen §1)."""

    roomType: str
    likes: list[str] = []
    dislikes: list[str] = []
    presetId: str | None = None


@app.post("/style/profile")
def style_profile(req: StyleProfileRequest) -> JSONResponse:
    from fp_engines.stil import erzeuge_stilprofil

    bilder_path = REPO_ROOT / "data" / "images" / f"{req.roomType}.json"
    bilder = json.loads(bilder_path.read_text(encoding="utf-8")) if bilder_path.is_file() else []
    taxonomie = json.loads(
        (REPO_ROOT / "data" / "taxonomy" / "stilachsen.json").read_text(encoding="utf-8")
    )
    profil = erzeuge_stilprofil(
        req.roomType, bilder, req.likes, req.dislikes, req.presetId, taxonomie["taxonomyVersion"]
    )
    return JSONResponse(content=profil)


@app.get("/taxonomy")
def taxonomy() -> Any:
    """Stilachsen-Taxonomie (datengetrieben, ADR-0006) – fürs Smart-Spider-UI."""
    return json.loads(
        (REPO_ROOT / "data" / "taxonomy" / "stilachsen.json").read_text(encoding="utf-8")
    )
