"""Lokaler FastAPI-Dienst – API-Oberfläche gemäss Engineering-Grundlagen-POC §1.

Endpunkte kommen meilensteinweise dazu (M1: /validate, M3: /solve, /evaluate …).
Fehler-Envelope einheitlich: {code, message, details}.
"""

import io
import json
import os
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from fp_engines import __version__
from fp_engines.auswertung import evaluate_plan
from fp_engines.bauzeit import erzeuge_bauzeitenplan
from fp_engines.dxf import grundriss_dxf
from fp_engines.kueche import arbeitsdreieck, formwahl, solve_kueche
from fp_engines.lv import erzeuge_lv
from fp_engines.pdf import bauzeit_pdf, kv_pdf, lv_pdf, offertanfrage_pdf
from fp_engines.rules import build_scene, evaluate_rules
from fp_engines.scan import (
    AdapterFehler,
    LayoutParseFehler,
    PosenFehler,
    layout_to_raummodell,
    parse_layout,
    parse_posen,
)
from fp_engines.solver import NoFeasiblePlacement, solve_begehbar
from fp_engines.zonen import zone_room

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


_ROOM_TYPES = {"bad", "kueche", "wohnen", "schlafen", "essen", "flur", "sonstig"}
_VIDEO_SUFFIXE = (".mp4", ".mov", ".m4v", ".avi", ".mkv")


def _bundle_dateien(rohdaten: bytes, dateiname: str) -> dict[str, bytes]:
    """Zerlegt ein hochgeladenes Scan-Bundle in seine benannten Teile.

    Akzeptiert ein **.zip** (Colab-Scan-Bundle: `layout.txt` [+ `poses.json`,
    `scene.ply`]) ODER eine **einzelne Datei** (rohe `layout.txt` bzw.
    `poses.json`). Rückgabe: Basisname → Bytes.
    """
    if zipfile.is_zipfile(io.BytesIO(rohdaten)):
        dateien: dict[str, bytes] = {}
        with zipfile.ZipFile(io.BytesIO(rohdaten)) as z:
            for info in z.infolist():
                if not info.is_dir():
                    dateien[Path(info.filename).name] = z.read(info)
        return dateien
    name = Path(dateiname).name
    low = name.lower()
    if low.endswith(".json"):
        return {"poses.json": rohdaten}
    if low.endswith(_VIDEO_SUFFIXE):
        return {name: rohdaten}  # Video bleibt Video → kein Layout (nur Live-Weg)
    return {"layout.txt": rohdaten}


@app.post("/scan")
async def scan(
    bundle: Annotated[UploadFile, File()],
    roomType: Annotated[str, Form()] = "sonstig",
    name: Annotated[str, Form()] = "Scan",
) -> JSONResponse:
    """Scan-Bundle (auf Colab vorberechnet) → schema-valides Raummodell.

    v0 = **Vorberechnen** (Brain: Demo-Regel in Scan-Laufzeit-Budget): das Bundle
    enthält bereits SpatialLMs `layout.txt`; die Engines laufen nur den Adapter
    (GPU-frei, deterministisch) → Raummodell für den bestehenden Klickpfad. Die
    Live-Weiterleitung an den Colab-Worker (`FP_SCAN_WORKER_URL`) folgt mit dem
    ersten echten Colab-Lauf (Fahrplan Schritt 5). Fixpunkte (Anschlüsse) bleiben
    leer – der Scan erkennt sie nicht; sie kommen aus Bestand/Korrektur-Modus.
    """
    if roomType not in _ROOM_TYPES:
        return JSONResponse(
            status_code=400,
            content={
                "code": "SCAN_INVALID",
                "message": f"Unbekannter roomType «{roomType}».",
                "details": {"erlaubt": sorted(_ROOM_TYPES)},
            },
        )
    dateien = _bundle_dateien(await bundle.read(), bundle.filename or "layout.txt")

    layout_bytes = next((b for n, b in dateien.items() if n.endswith("layout.txt")), None)
    if layout_bytes is None:
        hat_video = any(n.lower().endswith(_VIDEO_SUFFIXE) for n in dateien)
        worker = os.environ.get("FP_SCAN_WORKER_URL")
        message = (
            "Kein layout.txt im Bundle – den Scan zuerst auf Colab vorberechnen und "
            "layout.txt exportieren. Live-Weiterleitung an den Worker folgt in "
            "Fahrplan Schritt 5."
            if hat_video or not worker
            else "Bundle enthält weder layout.txt noch ein Video."
        )
        return JSONResponse(
            status_code=400,
            content={
                "code": "SCAN_NO_LAYOUT",
                "message": message,
                "details": {"dateien": sorted(dateien), "workerKonfiguriert": bool(worker)},
            },
        )

    warnungen: list[str] = []
    poses_bytes = next((b for n, b in dateien.items() if n.endswith("poses.json")), None)
    if poses_bytes is not None:
        try:
            parse_posen(poses_bytes.decode("utf-8"))
        except (PosenFehler, UnicodeDecodeError, ValueError) as e:
            warnungen.append(f"poses.json ignoriert (ungültig): {e}")

    try:
        layout = parse_layout(layout_bytes.decode("utf-8"))
        room = layout_to_raummodell(layout, name=name, room_type=roomType, source="video")
    except (LayoutParseFehler, AdapterFehler, UnicodeDecodeError) as e:
        return JSONResponse(
            status_code=400,
            content={"code": "SCAN_INVALID", "message": str(e), "details": {}},
        )

    n_review = sum(1 for o in room["objects"] if o.get("needsReview"))
    if n_review:
        warnungen.append(f"{n_review} erkannte Objekt(e) brauchen Bestätigung (needsReview).")
    if not room["fixpoints"]:
        warnungen.append("Keine Anschlüsse erkannt – im Korrektur-Modus/Bestand ergänzen.")
    return JSONResponse(content={"room": room, "warnungen": warnungen})


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


def _dressing(room_type: str) -> list[dict[str, Any]]:
    path = REPO_ROOT / "data" / "dressing" / f"{room_type}.json"
    if not path.is_file():
        raise FileNotFoundError(room_type)
    return json.loads(path.read_text(encoding="utf-8"))  # type: ignore[no-any-return]


@app.get("/dressing/{room_type}")
def dressing(room_type: str) -> Any:
    """Scene-Dressing-Stammdaten je Raumtyp (rein visuelle Deko-Ebene).

    Read-only, analog /catalog. Die Objekte sind NICHT solver-/normrelevant –
    der Client platziert sie deterministisch an Ankern aus dem bestehenden Plan.
    """
    try:
        return _dressing(room_type)
    except FileNotFoundError:
        return JSONResponse(
            status_code=404,
            content={
                "code": "SCHEMA_INVALID",
                "message": f"Kein Scene-Dressing für «{room_type}»",
                "details": {},
            },
        )


def _kueche_zone_id(room: dict[str, Any]) -> str | None:
    """ID der Küchen-Zone in einem Grossraum (für Auto-Routing), sonst None."""
    for zone in room.get("zones", []):
        if zone.get("roomType") == "kueche":
            return str(zone["id"])
    return None


def _effektiver_raum(room: dict[str, Any], zone_id: str | None) -> dict[str, Any]:
    """Effektiv geplanter Raum: Teilraum der Zone, falls zoneId; sonst der Raum.

    Ohne explizite zoneId, aber mit einer Küchen-Zone im Grossraum, wird diese
    automatisch geplant (Küchen-Detailkonzept Teil 3 – Zonen-Routing).
    """
    zid = zone_id or (None if room.get("roomType") == "kueche" else _kueche_zone_id(room))
    if zid:
        return zone_room(room, zid)
    return room


class FormenRequest(BaseModel):
    """Raum (+ optional Stilprofil/Normprofil) → Top-3 Küchenformen."""

    room: dict[str, Any]
    styleProfile: dict[str, Any] | None = None
    normProfile: str = "ch"
    zoneId: str | None = None


@app.post("/kueche/formen")
def kueche_formen(req: FormenRequest) -> JSONResponse:
    """Top-3 Küchenformen (I/L/U/Galley/Insel) für den effektiven Küchenraum."""
    raum = _effektiver_raum(req.room, req.zoneId)
    if raum["roomType"] != "kueche":
        return JSONResponse(
            status_code=400,
            content={
                "code": "SCHEMA_INVALID",
                "message": "Formwahl nur für Küchenräume (roomType kueche oder Küchen-Zone).",
                "details": {},
            },
        )
    formen = formwahl(raum, req.styleProfile, req.normProfile)
    return JSONResponse(content={"formen": formen})


class SolveRequest(BaseModel):
    """Raum + (optionale) Auswahl + seed → normkonformer Plan.

    Ohne `auswahl` läuft die deterministische Kurator-Baseline (ADR-0007-Fallback).
    Gleicher Input + gleicher seed ⇒ gleicher Plan («Variante würfeln» = seed+1).
    Küche: optional `normProfile`, `form` (Default Top-1 der Formwahl) und
    `zoneId` (Grossraum → Teilraum). Response enthält zusätzlich `room` (der
    effektiv verwendete Raum) für Viewer + Live-Ampel.
    """

    room: dict[str, Any]
    seed: int = 1
    normProfile: str = "ch"
    form: str | None = None
    zoneId: str | None = None
    auswahl: list[str] | None = None
    relationaleAbsichten: list[dict[str, Any]] = []
    anordnung: list[dict[str, Any]] | None = None
    # Mehrfach-Instanzen (Objekt-Ebenen-Modell, ADR-0014): itemId→anzahl. Additiv/
    # optional – fehlt es, wird jede Auswahl-ID einmal platziert (Alt-Verhalten).
    mengen: dict[str, int] | None = None
    # K-Varianten (Welle 5): true → K=3 Solver-Läufe, beste wird gewählt; Response
    # trägt zusätzlich `varianteInfo`. DEFAULT false → Verhalten exakt wie bisher
    # (bestehende Golden-/Determinismus-Tests unberührt). Nur Nicht-Küche.
    varianten: bool = False
    flaechen: dict[str, Any] | None = None
    # Kurator-Farbwahl je Item (Welle 3): itemId→Farb-Slug → placement.farbe.
    farben: dict[str, str] | None = None
    stilprofil: dict[str, Any] | None = None
    stilprofilRef: str | None = None


@app.post("/solve")
def solve_endpoint(req: SolveRequest) -> JSONResponse:
    raum = _effektiver_raum(req.room, req.zoneId)
    try:
        katalog = _catalog(raum["roomType"])
        rules = _load_rulesets(["basis", raum["roomType"]])
    except FileNotFoundError as e:
        return JSONResponse(
            status_code=400,
            content={
                "code": "SCHEMA_INVALID",
                "message": f"Stammdaten fehlen: {e.args[0]}",
                "details": {},
            },
        )
    created = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    variante_info: dict[str, Any] | None = None
    try:
        if raum["roomType"] == "kueche":
            # Küche = lineare Baugruppe (Formwahl + Slot-Füllung).
            form = req.form
            if form is None:
                top = formwahl(raum, req.stilprofil, req.normProfile)
                form = top[0]["form"] if top else "i"
            plan = solve_kueche(
                raum,
                katalog,
                rules,
                form=form,
                norm_profile=req.normProfile,
                seed=req.seed,
                style_profile=req.stilprofil,
                stilprofil_ref=req.stilprofilRef,
                created_at=created,
            )
        else:
            if req.auswahl is None:
                from fp_engines.kurator import BaselineKurator, mengen_aus_antwort

                neutral: dict[str, Any] = {
                    "styleVector": {},
                    "derivedRequirements": [],
                    "palette": [],
                }
                sel = BaselineKurator().kuratiere(neutral, raum, katalog, None, req.seed)
                auswahl, absichten = sel["auswahl"], sel["relationaleAbsichten"]
                anordnung = sel.get("anordnung")
                # Mengen aus der Kurator-Antwort (ergaenzungen) ableiten – der
                # kleinste saubere Weg, ohne den Vertrag um ein internes Feld zu
                # erweitern (mengen_aus_antwort liest die ergaenzungen).
                mengen: dict[str, int] | None = mengen_aus_antwort(sel)
            else:
                auswahl, absichten = req.auswahl, req.relationaleAbsichten
                anordnung = req.anordnung
                mengen = req.mengen
            if req.varianten:
                # Welle 5: K=3 Varianten, beste deterministisch gewählt; die
                # Auswahl-Spur (varianteInfo) geht in die Response-Hülle.
                from fp_engines.varianten import loese_mit_varianten

                plan, variante_info = loese_mit_varianten(
                    raum,
                    auswahl,
                    absichten,
                    katalog,
                    rules,
                    seed=req.seed,
                    norm_profile=req.normProfile,
                    stilprofil_ref=req.stilprofilRef,
                    style_profile=req.stilprofil,
                    anordnung=anordnung,
                    farben=req.farben,
                    mengen=mengen,
                    created_at=created,
                )
            else:
                # solve_begehbar = solve() + Begehbarkeits-Garantie am Planende
                # (Weg «hart am Ende», Begründung in fp_engines.solver). Der
                # Varianten-Pfad oben und solve_kueche erzwingen sie intern.
                plan = solve_begehbar(
                    raum,
                    auswahl,
                    absichten,
                    katalog,
                    rules,
                    seed=req.seed,
                    norm_profile=req.normProfile,
                    stilprofil_ref=req.stilprofilRef,
                    style_profile=req.stilprofil,
                    anordnung=anordnung,
                    farben=req.farben,
                    mengen=mengen,
                    created_at=created,
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
    hinweis = {} if raum["meta"]["geometryConfirmed"] else {"hinweis": "GEOMETRY_UNCONFIRMED"}
    extra: dict[str, Any] = {}
    if raum["roomType"] == "kueche":
        # Arbeitsdreieck-Detail (Seiten/Summe/Bewertung) fürs Viewer-Panel; der
        # Score steckt zusätzlich im Plan (constraintReport.softScore.ergonomie).
        dreieck = arbeitsdreieck(plan["placements"], {c["id"]: c for c in katalog})
        if dreieck is not None:
            extra["arbeitsdreieck"] = dreieck
    # K-Varianten-Spur (Welle 5) additiv in der Response-Hülle (nicht im Plan-
    # Artefakt → keine Schema-Änderung). Nur gesetzt, wenn varianten=true lief.
    if variante_info is not None:
        extra["varianteInfo"] = variante_info
    # Flächen-Wünsche (Kurator Call C) additiv durchreichen; Frontend-Konsum ist
    # eine spätere Welle. None = Client leitet die Optik deterministisch ab.
    return JSONResponse(
        content={"plan": plan, "room": raum, "flaechen": req.flaechen, **hinweis, **extra}
    )


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


class FlaechenPruefRequest(BaseModel):
    """Manuelle Flächen-Wahl (Welle 3) + Raum → Norm-Kontrolle.

    Quellenunabhängige harte Flächen-Normprüfung: dieselbe Kontrolle wie beim
    Kurator-Call C (`pruefe_flaechen`/`korrigiere_flaechen`) – die eiserne Regel
    (Normen bleiben hart, auch bei manueller Wahl) gilt so auch für die UI.
    """

    room: dict[str, Any]
    flaechen: dict[str, Any] | None = None


@app.post("/flaechen/pruefen")
def flaechen_pruefen(req: FlaechenPruefRequest) -> JSONResponse:
    """Prüft die (manuell gewählten) Flächen gegen die Norm und korrigiert sie.

    Kein TS-Nachbau der Regeln (Drift vermeiden): die Python-Quelle
    `pruefe_flaechen`/`korrigiere_flaechen` ist die EINZIGE Norm-Instanz. Liefert
    `verstoesse` (deutsche Klartext-Liste, leer = konform) und `korrigiert` (die
    normkonforme Fassung, die die UI übernimmt).
    """
    from fp_engines.kurator import FLAECHEN_REGELN, korrigiere_flaechen, pruefe_flaechen

    verstoesse = pruefe_flaechen(req.flaechen, req.room, FLAECHEN_REGELN)
    korrigiert = korrigiere_flaechen(req.flaechen, req.room, FLAECHEN_REGELN)
    return JSONResponse(content={"verstoesse": verstoesse, "korrigiert": korrigiert})


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


@app.post("/export/plan-pdf")
def export_plan_pdf(req: EvaluateRequest) -> Response:
    """2D-Grundriss als PDF (Draufsicht mit Massen und Möbel-Footprints)."""
    from fp_engines.pdf import plan2d_pdf

    katalog = _catalog(req.room["roomType"])
    return Response(
        content=plan2d_pdf(req.room, req.plan, katalog),
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="grundriss.pdf"'},
    )


@app.post("/export/gltf")
def export_gltf(req: EvaluateRequest) -> JSONResponse:
    """3D-Export als glTF 2.0 (Boxen, deckungsgleich mit dem Viewer)."""
    from fp_engines.gltf import szene_gltf

    katalog = _catalog(req.room["roomType"])
    return JSONResponse(
        content=szene_gltf(req.room, req.plan, katalog),
        media_type="model/gltf+json",
        headers={"Content-Disposition": 'attachment; filename="szene.gltf"'},
    )


@app.post("/export/gewerke")
def export_gewerke(req: EvaluateRequest) -> JSONResponse:
    from fp_engines.auswertung import gewerke_uebersicht

    lv, bz = _lv_und_bauzeit(req)
    return JSONResponse(content=gewerke_uebersicht(lv, bz))


@app.post("/export/gewerke-pdf")
def export_gewerke_pdf(req: EvaluateRequest) -> Response:
    from fp_engines.auswertung import gewerke_uebersicht
    from fp_engines.pdf import gewerke_pdf

    lv, bz = _lv_und_bauzeit(req)
    return Response(
        content=gewerke_pdf(gewerke_uebersicht(lv, bz)),
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="gewerke-uebersicht.pdf"'},
    )


@app.post("/export/einkaufsliste")
def export_einkaufsliste(req: EvaluateRequest) -> JSONResponse:
    from fp_engines.auswertung import einkaufsliste

    katalog = _catalog(req.room["roomType"])
    return JSONResponse(content=einkaufsliste(req.plan, katalog))


@app.post("/export/einkaufsliste-pdf")
def export_einkaufsliste_pdf(req: EvaluateRequest) -> Response:
    from fp_engines.auswertung import einkaufsliste
    from fp_engines.pdf import einkaufsliste_pdf

    katalog = _catalog(req.room["roomType"])
    return Response(
        content=einkaufsliste_pdf(einkaufsliste(req.plan, katalog), req.room["name"]),
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="einkaufsliste.pdf"'},
    )
