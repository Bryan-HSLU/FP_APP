"""Solver – Feasibility-first, gestuft P1→P2→P3 (Solver-Algorithmus-Detailkonzept).

Kernprinzip: harte Regeln FILTERN den Suchraum (Kandidaten, die den
constraintReport verletzen würden, werden nie platziert) → jede Ausgabe ist
per Konstruktion normkonform («0 ❌»). Findet sich kein zulässiger Platz für
ein P1-Pflichtobjekt, wird ehrlich NoFeasiblePlacement gemeldet statt einer
verletzenden Lösung.

v0-Vereinfachungen (bewusst, dokumentiert in STATUS.md):
- Wand-Kandidaten parallel an massiven Wänden (Snap-Schritt 5 cm, Rotation aus
  der Wand-Normalen) – nötig für wandgebundene Objekte (Bad, Regal, Spiegel).
- Boden-Kandidaten (ab M5/Wohnen): freie Platzierung auf einem 0.25-m-Raster
  über der Bounding-Box des Bodenpolygons, Yaw 0/90/180/270 – Standmöbel
  (Sofa, Esstisch …) müssen nicht an einer Wand kleben.
- Zulässigkeit = Regel-Interpreter-Urteil über die TEIL-Szene
  (summary.verletzt == 0) – exakt dieselbe Logik wie Live-Check und CI.
- Soft-Score v0 = Wandstreuung (Objekte verteilen) + Nähe zu relationalen
  Ankern; Stil-Score kommt mit M4 (Kurator).
"""

from __future__ import annotations

import math
import random
import uuid
from dataclasses import dataclass
from typing import Any

from fp_engines.rules.geometry import (
    containment_violation,
    footprint,
    front_dir,
    overlap_depth,
    point_in_polygon,
)
from fp_engines.rules.interpreter import evaluate_rules
from fp_engines.rules.scene import build_scene

SOLVER_VERSION = "0.1.0"
SNAP_M = 0.05
FLOOR_GRID_M = 0.25  # Rasterweite freie Boden-Platzierung (ab M5/Wohnen)
P1_CAP = 400  # Backtracking-Kandidaten-Deckel je P1-Objekt (Explosionsschutz)


class NoFeasiblePlacement(Exception):
    """Ehrliches Solver-Ergebnis: kein normkonformer Platz für ein Pflichtobjekt."""

    def __init__(self, funktions_typ: str):
        self.funktions_typ = funktions_typ
        super().__init__(f"Kein normkonformer Platz für «{funktions_typ}»")


@dataclass
class _Kandidat:
    pos: tuple[float, float]
    yaw_deg: float
    wall_index: int


def _wall_candidates(room: dict[str, Any], item: dict[str, Any]) -> list[_Kandidat]:
    """Zulässige Posen entlang massiver Wände: Rücken zur Wand, Front zum Raum.

    Die Wand-Normale Richtung Rauminneres bestimmt yaw: front (lokal +z) muss
    von der Wand weg zeigen. Snap-Schritt 5 cm entlang der Wand.
    """
    floor = room["shell"]["floor"]["polygon"]
    cx = sum(p[0] for p in floor) / len(floor)
    cz = sum(p[1] for p in floor) / len(floor)
    d = item["masse"]["d"]
    out: list[_Kandidat] = []
    for wi, wall in enumerate(room["shell"]["walls"]):
        if wall["kind"] != "massiv":
            continue
        sx, sz = wall["start"]
        ex, ez = wall["end"]
        laenge = math.hypot(ex - sx, ez - sz)
        if laenge < item["masse"]["w"]:
            continue
        ux, uz = (ex - sx) / laenge, (ez - sz) / laenge
        # Normale Richtung Raummitte (einfacher Test über das Zentroid).
        nx, nz = -uz, ux
        mx, mz = (sx + ex) / 2, (sz + ez) / 2
        if (cx - mx) * nx + (cz - mz) * nz < 0:
            nx, nz = -nx, -nz
        # yaw so, dass front_dir == (nx, nz)
        yaw = math.degrees(math.atan2(nx, nz)) % 360
        # exakte 90°-Snaps gegen Float-Rauschen (Konzept: θ gesnappt)
        for exakt in (0.0, 90.0, 180.0, 270.0):
            if abs(yaw - exakt) < 1e-6:
                yaw = exakt
        f = front_dir(yaw)
        schritte = int((laenge - item["masse"]["w"]) / SNAP_M)
        for i in range(schritte + 1):
            t = item["masse"]["w"] / 2 + i * SNAP_M
            # Zentrum: an der Wand entlang + halbe Tiefe Richtung Raum
            px = sx + ux * t + f[0] * (d / 2)
            pz = sz + uz * t + f[1] * (d / 2)
            out.append(_Kandidat((round(px, 4), round(pz, 4)), yaw, wi))
    return out


def _floor_candidates(room: dict[str, Any], item: dict[str, Any]) -> list[_Kandidat]:
    """Freie Boden-Posen auf einem Raster über der Bounding-Box des Bodenpolygons.

    Nur für Standmöbel (mount == «boden»): Rasterweite FLOOR_GRID_M, je Punkt die
    vier achsparallelen Yaws (0/90/180/270). Offensichtlich daneben liegende
    Kandidaten (Zentrum ausserhalb des Polygons) werden hier schon weggelassen;
    den Rest erledigen `_schnell_unzulaessig` und die volle Regelauswertung.
    Reihenfolge ist deterministisch (Raster + Yaw geschachtelt), damit der
    spätere shuffle reproduzierbar bleibt.
    """
    floor = room["shell"]["floor"]["polygon"]
    xs = [p[0] for p in floor]
    zs = [p[1] for p in floor]
    x_min, x_max = min(xs), max(xs)
    z_min, z_max = min(zs), max(zs)
    nx = int((x_max - x_min) / FLOOR_GRID_M)
    nz = int((z_max - z_min) / FLOOR_GRID_M)
    out: list[_Kandidat] = []
    for ix in range(nx + 1):
        px = round(x_min + ix * FLOOR_GRID_M, 4)
        for iz in range(nz + 1):
            pz = round(z_min + iz * FLOOR_GRID_M, 4)
            if not point_in_polygon((px, pz), floor):
                continue
            for yaw in (0.0, 90.0, 180.0, 270.0):
                out.append(_Kandidat((px, pz), yaw, -1))
    return out


def _candidates(room: dict[str, Any], item: dict[str, Any]) -> list[_Kandidat]:
    """Kandidaten je Item: Wand-Kandidaten + (bei Boden-Items) Boden-Kandidaten.

    Wandgebundene Items (mount == «wand») bleiben bei den Wand-Kandidaten;
    Standmöbel bekommen zusätzlich das freie Boden-Raster. Reihenfolge
    deterministisch (erst Wand, dann Boden) – der seed-gesteuerte shuffle in den
    Pässen sorgt für Variation.
    """
    kand = _wall_candidates(room, item)
    if item.get("mount", "boden") == "boden":
        kand = kand + _floor_candidates(room, item)
    return kand


def _als_placement(item: dict[str, Any], kandidat: _Kandidat, rnd: random.Random) -> dict[str, Any]:
    p: dict[str, Any] = {
        "id": str(uuid.UUID(int=rnd.getrandbits(128), version=4)),
        "catalogItemId": item["id"],
        "pose": {"pos": [kandidat.pos[0], kandidat.pos[1]], "yawDeg": kandidat.yaw_deg},
        "gewerk": item["gewerk"],
        "locked": False,
        "source": "solver",
    }
    if item.get("mount") == "wand":
        hr = item.get("mountHeightRange") or {"min": 0.0, "max": 0.0}
        p["mountHeight"] = round((hr["min"] + hr["max"]) / 2, 3)
    return p


def _schnell_unzulaessig(
    room: dict[str, Any],
    placements: list[dict[str, Any]],
    by_id: dict[str, dict[str, Any]],
    kandidat_placement: dict[str, Any],
) -> bool:
    """Billiger Vorfilter VOR der vollen Regelauswertung: offensichtliche
    Kollisionen (gleiche Höhenlage) und Raum-Austritte sofort verwerfen.
    Konservativ – verwirft nie fälschlich (vertikal getrennte Paare werden
    der vollen Prüfung überlassen, wenn kein Plan-Overlap vorliegt)."""
    item = by_id[kandidat_placement["catalogItemId"]]
    quad = footprint(
        tuple(kandidat_placement["pose"]["pos"]),
        item["masse"]["w"],
        item["masse"]["d"],
        kandidat_placement["pose"]["yawDeg"],
    )
    if containment_violation(quad, room["shell"]["floor"]["polygon"]) < 0:
        return True
    k_lo = kandidat_placement.get("mountHeight") or 0.0
    k_hi = k_lo + item["masse"]["h"]
    for p in placements[:-1]:
        o = by_id[p["catalogItemId"]]
        o_lo = p.get("mountHeight") or 0.0
        if k_hi <= o_lo or o_lo + o["masse"]["h"] <= k_lo:
            continue  # vertikal getrennt → keine Kollision möglich
        o_quad = footprint(
            tuple(p["pose"]["pos"]), o["masse"]["w"], o["masse"]["d"], p["pose"]["yawDeg"]
        )
        if overlap_depth(quad, o_quad) is not None:
            return True
    return False


def _zulaessig(
    room: dict[str, Any],
    placements: list[dict[str, Any]],
    catalog: list[dict[str, Any]],
    rules: list[dict[str, Any]],
    norm_profile: str,
) -> dict[str, Any] | None:
    """Urteil des Regel-Interpreters über die Teil-Szene; Report wenn 0 verletzt."""
    plan_stub = {"placements": placements, "meta": {"normProfile": norm_profile}}
    report = evaluate_rules(build_scene(room, plan_stub, catalog), rules)
    return report if report["hard"]["summary"]["verletzt"] == 0 else None


def _streuung_score(placements: list[dict[str, Any]]) -> float:
    """Soft-Score v0: paarweise Distanzsumme – Objekte verteilen statt klumpen."""
    s = 0.0
    for i in range(len(placements)):
        for j in range(i + 1, len(placements)):
            a = placements[i]["pose"]["pos"]
            b = placements[j]["pose"]["pos"]
            s += math.hypot(a[0] - b[0], a[1] - b[1])
    return s


def solve(
    room: dict[str, Any],
    auswahl_ids: list[str],
    relationale_absichten: list[dict[str, Any]],
    catalog: list[dict[str, Any]],
    rules: list[dict[str, Any]],
    *,
    seed: int,
    norm_profile: str = "ch",
    stilprofil_ref: str | None = None,
    created_at: str = "1970-01-01T00:00:00Z",
) -> dict[str, Any]:
    """Raummodell + Auswahl + Regeln + seed → normkonformes Plan-Objekt.

    Determinismus: gleicher Input + gleicher seed ⇒ gleicher Plan
    (Engineering-Grundlagen §1); Varianten via anderem seed («würfeln»).
    """
    rnd = random.Random(seed)
    by_id = {c["id"]: c for c in catalog}
    items = [by_id[i] for i in auswahl_ids]
    p1 = [i for i in items if i["priorityClass"] == "P1"]
    p2 = [i for i in items if i["priorityClass"] == "P2"]
    p3 = [i for i in items if i["priorityClass"] == "P3"]
    relation_von = {a["itemId"]: a["relation"] for a in relationale_absichten}

    placements: list[dict[str, Any]] = []

    # Pass 1 – P1: Backtracking über zulässige Wand-Kandidaten. Der Raum ist
    # klein (2–4 Objekte) → vollständige Suche mit Erst-Treffer je Beam;
    # Variation: seed mischt die Kandidaten-Reihenfolge GLEICHVERTEILT, daher
    # liefern verschiedene Seeds verschiedene zulässige Layouts.
    def backtrack(rest: list[dict[str, Any]]) -> bool:
        if not rest:
            return True
        item, *uebrige = rest
        kandidaten = _candidates(room, item)
        rnd.shuffle(kandidaten)
        for kandidat in kandidaten[:P1_CAP]:
            placement = _als_placement(item, kandidat, rnd)
            placements.append(placement)
            if not _schnell_unzulaessig(room, placements, by_id, placement) and (
                _zulaessig(room, placements, catalog, rules, norm_profile) is not None
            ):
                if backtrack(uebrige):
                    return True
            placements.pop()
        return False

    # Anschlussgebundenstes zuerst (Reihenfolge der Auswahl = Baseline-Wissen).
    if not backtrack(p1):
        # herausfinden, welches Item gescheitert ist: erstes ohne Einzelplatz
        for item in p1:
            einzeln = any(
                _zulaessig(
                    room,
                    [_als_placement(item, k, random.Random(0))],
                    catalog,
                    rules,
                    norm_profile,
                )
                for k in _candidates(room, item)
            )
            if not einzeln:
                raise NoFeasiblePlacement(item["funktionsTyp"])
        raise NoFeasiblePlacement(p1[-1]["funktionsTyp"] if p1 else "unbekannt")

    # Pass 2 – P2: greedy, relational gefiltert (near:<typ>:<maxDist>).
    typ_pos: dict[str, tuple[float, float]] = {}
    for pl in placements:
        typ_pos[by_id[pl["catalogItemId"]]["funktionsTyp"]] = (
            pl["pose"]["pos"][0],
            pl["pose"]["pos"][1],
        )
    for item in p2:
        anker: tuple[float, float] | None = None
        max_dist = math.inf
        rel = relation_von.get(item["id"])
        if rel:
            teile = rel.split(":")
            if teile[0] == "near" and teile[1] in typ_pos:
                anker = typ_pos[teile[1]]
                max_dist = float(teile[2]) if len(teile) > 2 else math.inf
        kandidaten = _candidates(room, item)
        if anker is not None:
            kandidaten = [
                k
                for k in kandidaten
                if math.hypot(k.pos[0] - anker[0], k.pos[1] - anker[1]) <= max_dist
            ]
            kandidaten.sort(key=lambda k: math.hypot(k.pos[0] - anker[0], k.pos[1] - anker[1]))
        else:
            rnd.shuffle(kandidaten)
        for kandidat in kandidaten[:300]:
            placement = _als_placement(item, kandidat, rnd)
            placements.append(placement)
            if not _schnell_unzulaessig(room, placements, by_id, placement) and (
                _zulaessig(room, placements, catalog, rules, norm_profile) is not None
            ):
                typ_pos[item["funktionsTyp"]] = kandidat.pos
                break
            placements.pop()
        # P2 ist optional: kein Platz → weglassen (kein Abbruch).

    # Pass 3 – P3 (Dekor): randomisiert auf zulässigen Restplätzen – hier
    # entsteht die Seed-Variation, ohne harte Regeln zu berühren.
    for item in p3:
        kandidaten = _candidates(room, item)
        rnd.shuffle(kandidaten)
        for kandidat in kandidaten[:200]:
            placement = _als_placement(item, kandidat, rnd)
            placements.append(placement)
            if not _schnell_unzulaessig(room, placements, by_id, placement) and (
                _zulaessig(room, placements, catalog, rules, norm_profile) is not None
            ):
                break
            placements.pop()

    report = _zulaessig(room, placements, catalog, rules, norm_profile)
    assert report is not None  # per Konstruktion – Solver-Invariante

    return {
        "id": str(uuid.UUID(int=rnd.getrandbits(128), version=4)),
        "schemaVersion": "0.1.0",
        "roomRef": room["id"],
        "stilprofilRef": stilprofil_ref or str(uuid.UUID(int=0, version=4)),
        "version": 1,
        "status": "vorschlag",
        "placements": placements,
        "assemblies": [],
        "interventions": [],
        "finishes": [],
        "constraintReport": report,
        "meta": {
            "solverVersion": SOLVER_VERSION,
            "seed": seed,
            "normProfile": norm_profile,
            "barrierefrei": False,
            "createdAt": created_at,
        },
    }
