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
- Soft-Score v0 = relationale Absichten (near/against-wall/corner/facing/
  opposite/group/pair-with, siehe fp_engines.relationen) + stil-abhängige
  Platzierung – beides NUR auf der weichen Ebene: sie ordnen die zulässigen
  Kandidaten, sie erweitern die zulässige Menge nie (harte Regeln unberührt).
"""

from __future__ import annotations

import math
import random
import uuid
from dataclasses import dataclass
from typing import Any

from fp_engines.relationen import (
    AgainstWall,
    Corner,
    Facing,
    Group,
    Near,
    Opposite,
    PairWith,
    Relation,
    parse_relation,
    parse_relationen,
)
from fp_engines.rules.geometry import (
    Quad,
    Vec2,
    containment_violation,
    dist_point_to_polygon_boundary,
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
# Halbe Rundungsquante des Interpreters (0.1 cm): kleinere Überlappungen sind
# Berührung, keine Kollision.
_BERUEHRUNGS_EPS = 5e-4


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


_TUER_KORRIDOR_TIEFE = 0.9  # Tiefe (m) des freizuhaltenden Zugangsstreifens vor einer Tür.


def _tuer_korridore(room: dict[str, Any], tiefe: float = _TUER_KORRIDOR_TIEFE) -> list[Quad]:
    """Zugangsstreifen vor jeder Tür (Türbreite × tiefe, ins Rauminnere).

    Verkehrsweg-Heuristik zur «circulation»-Regel: OPTIONALE Objekte (P2/P3)
    werden hier nicht platziert, damit der Tür-Zugang – der dominante Engpass der
    Freiraumanalyse – frei bleibt. P1-Pflichtobjekte sind bewusst ausgenommen
    (sie müssen Anschluss/Platz finden; der Türschwenk hält den unmittelbaren
    Bereich ohnehin frei). Reiner Geometrie-Filter – KEINE Grid-Auswertung im
    Hot-Path, deshalb billig und paritätsneutral (nur Solver-seitig).
    """
    floor = room["shell"]["floor"]["polygon"]
    walls = {w["id"]: w for w in room["shell"]["walls"]}
    zones: list[Quad] = []
    for o in room["openings"]:
        if o["type"] != "door":
            continue
        w = walls.get(o["hostWall"])
        if w is None:
            continue
        sx, sz = w["start"][0], w["start"][1]
        ex, ez = w["end"][0], w["end"][1]
        length = math.hypot(ex - sx, ez - sz)
        if length == 0:
            continue
        ux, uz = (ex - sx) / length, (ez - sz) / length
        a = (sx + ux * o["offset"], sz + uz * o["offset"])
        b = (a[0] + ux * o["width"], a[1] + uz * o["width"])
        # Seite ins Rauminnere über den Polygon-Test (wie der Interpreter).
        for sgn in (1, -1):
            nx, nz = -uz * sgn, ux * sgn
            mid = ((a[0] + b[0]) / 2 + nx * 0.1, (a[1] + b[1]) / 2 + nz * 0.1)
            if point_in_polygon(mid, floor):
                zones.append(
                    (
                        a,
                        b,
                        (b[0] + nx * tiefe, b[1] + nz * tiefe),
                        (a[0] + nx * tiefe, a[1] + nz * tiefe),
                    )
                )
                break
    return zones


def _blockiert_korridor(item: dict[str, Any], kandidat: _Kandidat, korridore: list[Quad]) -> bool:
    """Überlappt der Footprint des Kandidaten einen Tür-Zugangsstreifen?"""
    if not korridore:
        return False
    quad = footprint(kandidat.pos, item["masse"]["w"], item["masse"]["d"], kandidat.yaw_deg)
    return any(overlap_depth(quad, z) is not None for z in korridore)


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
        tiefe = overlap_depth(quad, o_quad)
        # Berührung zählt nicht als Kollision: Der Interpreter rundet Margen auf
        # 0.1 cm – exakt anliegende Korpusse (Küchenzeile!) erzeugen durch
        # Float-Krümel Überlappungen ~1e-16, die das Urteil NICHT verletzen.
        # Der Vorfilter darf nie strenger sein als die volle Regelauswertung.
        if tiefe is not None and tiefe > _BERUEHRUNGS_EPS:
            return True
    return False


def _zulaessig(
    room: dict[str, Any],
    placements: list[dict[str, Any]],
    catalog: list[dict[str, Any]],
    rules: list[dict[str, Any]],
    norm_profile: str,
    nur_hart: bool = False,
) -> dict[str, Any] | None:
    """Urteil des Regel-Interpreters über die Teil-Szene; Report wenn 0 verletzt.

    `nur_hart=True` wertet nur harte Regeln aus – für den Solver-Hot-Path: die
    Zulässigkeit hängt einzig an `hard.summary.verletzt`, weiche Regeln (z.B. die
    teure circulation-Freiraumanalyse) tragen dort NICHTS bei. Der finale Report
    eines Plans wird bewusst mit allen Regeln (nur_hart=False) erzeugt.
    """
    aktive = [r for r in rules if r.get("severity") == "hard"] if nur_hart else rules
    plan_stub = {"placements": placements, "meta": {"normProfile": norm_profile}}
    report = evaluate_rules(build_scene(room, plan_stub, catalog), aktive)
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


# --- Weiche Anordnungs-Ebene: Relationen + Stil als Soft-Score --------------
# Gewichte ordnen NUR die zulässigen Kandidaten (nie Zulässigkeit). `near`
# dominiert bewusst (×100 auf −Distanz in Metern): so bleibt das etablierte
# «closest-first» der near-Relation die Leitgrösse, die übrigen Terme justieren
# nur innerhalb praktisch gleich naher Posen. Werte v0, im POC kalibrierbar.
_NEAR_W = 100.0
_FACE_W = 1.0
_OPP_W = 1.0
_GROUP_W = 2.0
_PAIR_W = 2.0
_CORNER_W = 1.5
_STYLE_W = 0.5
# Referenz-Wandabstand (m) für die Stil-Normierung: ab hier gilt eine Pose als
# «raummittig». Grob halbe Tiefe eines typischen Raums.
_STIL_WAND_REF = 2.0


@dataclass
class _PlatzKontext:
    """Laufender Zustand für die Soft-Score-Bewertung der Kandidaten.

    Wird nach jeder Platzierung fortgeschrieben (typ_pos/id_pos/gruppen_pos),
    damit spätere Objekte relational auf frühere ausgerichtet werden können.
    """

    floor: list[Vec2]
    style_vector: dict[str, float]
    typ_pos: dict[str, Vec2]
    id_pos: dict[str, Vec2]
    gruppen_pos: dict[str, list[Vec2]]


def _dist(a: Vec2, b: Vec2) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _norm(v: Vec2) -> Vec2:
    laenge = math.hypot(v[0], v[1])
    return (v[0] / laenge, v[1] / laenge) if laenge > 0 else (0.0, 0.0)


def _centroid(punkte: list[Vec2]) -> Vec2:
    n = len(punkte)
    return (sum(p[0] for p in punkte) / n, sum(p[1] for p in punkte) / n)


def _min_ecken_dist(pos: Vec2, floor: list[Vec2]) -> float:
    """Distanz zur nächsten Polygon-Ecke (Basis des corner-Scores)."""
    return min(_dist(pos, v) for v in floor)


def _stil_score(ctx: _PlatzKontext, pos: Vec2) -> float:
    """Stil-abhängige Platzierung: Achse `raumgefuehl` steuert Wand-Nähe.

    Design-Entscheid v0 (dokumentiert als offene Frage): ein hoher
    `raumgefuehl`-Wert (Wunsch nach Weite/Offenheit) belohnt wandnahe Posen –
    sie halten die Raummitte frei und wirken grosszügiger; negative Werte kehren
    die Präferenz um. Ohne styleVector trägt der Term 0 → Alt-Verhalten bleibt.
    """
    rg = ctx.style_vector.get("raumgefuehl", 0.0)
    if not rg:
        return 0.0
    wanddist = dist_point_to_polygon_boundary(pos, ctx.floor)
    naehe = max(0.0, 1.0 - wanddist / _STIL_WAND_REF)  # 1 an der Wand, 0 mittig
    return _STYLE_W * rg * naehe


def _kandidat_score(kandidat: _Kandidat, rels: list[Relation], ctx: _PlatzKontext) -> float:
    """Summe der weichen Präferenzen für eine Kandidaten-Pose (höher = besser)."""
    pos = kandidat.pos
    score = 0.0
    for r in rels:
        if isinstance(r, Near):
            anker = ctx.typ_pos.get(r.funktions_typ)
            if anker is not None:
                score += _NEAR_W * -_dist(pos, anker)
        elif isinstance(r, Facing):
            ziel = ctx.typ_pos.get(r.funktions_typ)
            if ziel is not None:
                f = front_dir(kandidat.yaw_deg)
                v = _norm((ziel[0] - pos[0], ziel[1] - pos[1]))
                score += _FACE_W * (f[0] * v[0] + f[1] * v[1])
        elif isinstance(r, Opposite):
            anker = ctx.typ_pos.get(r.funktions_typ)
            if anker is not None:
                score += _OPP_W * _dist(pos, anker)  # gegenüber = weit weg vom Anker
        elif isinstance(r, Group):
            mitglieder = ctx.gruppen_pos.get(r.group_id)
            if mitglieder:
                score += _GROUP_W * -_dist(pos, _centroid(mitglieder))
        elif isinstance(r, PairWith):
            anker = ctx.id_pos.get(r.item_id)
            if anker is not None:
                score += _PAIR_W * -_dist(pos, anker)
        elif isinstance(r, Corner):
            score += _CORNER_W * -_min_ecken_dist(pos, ctx.floor)
    return score + _stil_score(ctx, pos)


def _filter_kandidaten(
    kandidaten: list[_Kandidat], rels: list[Relation], ctx: _PlatzKontext
) -> list[_Kandidat]:
    """Harte Reduktion der (bereits zulässigen) Kandidaten aus Relationen.

    `against-wall` erzwingt Wand-Posen (Fallback auf alle, falls es keine gäbe –
    Feasibility geht vor Präferenz). `near` behält die etablierte harte
    Distanzschranke (kein Fallback: findet sich nichts, bleibt das optionale
    Objekt weg). Unbekannte Relationen wurden schon beim Parsen verworfen.
    """
    if any(isinstance(r, AgainstWall) for r in rels):
        wand = [k for k in kandidaten if k.wall_index >= 0]
        if wand:
            kandidaten = wand
    for r in rels:
        if isinstance(r, Near) and r.max_dist != math.inf:
            anker = ctx.typ_pos.get(r.funktions_typ)
            if anker is not None:
                kandidaten = [k for k in kandidaten if _dist(k.pos, anker) <= r.max_dist]
    return kandidaten


def _bevorzuge_wand(kandidaten: list[_Kandidat], wand_index: int | None) -> list[_Kandidat]:
    """Weicher Wandwunsch (anordnung.wandIndex): Posen an genau dieser Wand nach
    vorne, alle übrigen dahinter (stabil, Score-Reihenfolge bleibt je Gruppe).

    Bewusst reine Umsortierung, KEIN harter Filter: findet sich an der Wunschwand
    kein zulässiger Platz, greifen automatisch die übrigen Kandidaten → nie
    NoFeasiblePlacement wegen eines Wandwunsches. Ungültiger/negativer Index ist
    ein No-op (keine Pose matcht) – der Solver bleibt robust.
    """
    if wand_index is None:
        return kandidaten
    auf = [k for k in kandidaten if k.wall_index == wand_index]
    if not auf:
        return kandidaten
    rest = [k for k in kandidaten if k.wall_index != wand_index]
    return auf + rest


def _ordne_kandidaten(
    kandidaten: list[_Kandidat],
    rels: list[Relation],
    ctx: _PlatzKontext,
    rnd: random.Random,
    wunsch_wand: int | None = None,
) -> list[_Kandidat]:
    """Kandidaten filtern + nach Soft-Score ordnen; seed bricht Gleichstände.

    Reihenfolge: erst mischen (seed = Variation), dann filtern, dann STABIL nach
    −Score sortieren, zuletzt den (weichen) Wandwunsch nach vorne ziehen. Ohne
    Relationen/Stil/Wandwunsch ist der Score 0 → die Mischung bleibt unverändert
    (byte-identisch zum relationslosen Alt-Verhalten).
    """
    kandidaten = list(kandidaten)
    rnd.shuffle(kandidaten)
    kandidaten = _filter_kandidaten(kandidaten, rels, ctx)
    kandidaten.sort(key=lambda k: -_kandidat_score(k, rels, ctx))
    return _bevorzuge_wand(kandidaten, wunsch_wand)


def _merke_platzierung(
    ctx: _PlatzKontext, item: dict[str, Any], rels: list[Relation], pos: Vec2
) -> None:
    """Platzierte Pose in den Kontext eintragen (Anker für spätere Objekte)."""
    ctx.typ_pos[item["funktionsTyp"]] = pos
    ctx.id_pos[item["id"]] = pos
    for r in rels:
        if isinstance(r, Group):
            ctx.gruppen_pos.setdefault(r.group_id, []).append(pos)


def baue_rel_map(
    relationale_absichten: list[dict[str, Any]],
    anordnung: list[dict[str, Any]] | None,
) -> dict[str, list[Relation]]:
    """itemId → geparste Relationen; `anordnung.relationen` überschreibt je Item.

    Ein Item kann MEHRERE Absichten tragen (z.B. Sofa = group + facing) → Liste
    je itemId. Kaputte/unbekannte Relationen filtert der Parser weg (ignoriert).
    Die weiche `anordnung`-Ebene (Kurator-Pipeline v2) gewinnt je Item über die
    `relationaleAbsichten`. Eine Quelle für die Platzierung (solve) UND die
    Varianten-Bewertung (fp_engines.varianten) – damit beide dieselben Relationen
    sehen, kein Drift.
    """
    rel_map: dict[str, list[Relation]] = {}
    for a in relationale_absichten:
        rel = parse_relation(a.get("relation"))
        if rel is not None:
            rel_map.setdefault(a["itemId"], []).append(rel)
    for a in anordnung or []:
        iid = a.get("itemId")
        if iid is not None and a.get("relationen"):
            rel_map[iid] = parse_relationen(list(a["relationen"]))
    return rel_map


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
    style_profile: dict[str, Any] | None = None,
    anordnung: list[dict[str, Any]] | None = None,
    farben: dict[str, str] | None = None,
    mengen: dict[str, int] | None = None,
    created_at: str = "1970-01-01T00:00:00Z",
) -> dict[str, Any]:
    """Raummodell + Auswahl + Regeln + seed → normkonformes Plan-Objekt.

    Determinismus: gleicher Input + gleicher seed ⇒ gleicher Plan
    (Engineering-Grundlagen §1); Varianten via anderem seed («würfeln»).

    `anordnung` (Kurator-Pipeline v2, Vertrag 7) ist eine **weiche** Ebene je
    Item: `relationen` ergänzen/überschreiben die `relationaleAbsichten`
    (anordnung gewinnt), `wandIndex` zieht die Wand-Posen dieser Wand nach vorne
    (Fallback auf alle Kandidaten, wenn dort nichts Zulässiges frei ist),
    `prioritaet` ordnet innerhalb P2/P3. Nichts davon berührt die harten Regeln –
    jeder Plan endet mit 0 ❌.

    `farben` (Welle 3, optional) ist eine itemId→Farb-Slug-Abbildung (KI oder
    manuelle UI-Wahl); die gewählte Farbe je Item landet als `placement.farbe`.
    Rein visuell, Determinismus unberührt.

    `mengen` (Objekt-Ebenen-Modell, ADR-0014, optional) ist eine
    itemId→anzahl-Abbildung: das Item wird n-mal platziert (n eigenständige
    Placements mit eindeutigen IDs, z.B. 4 Stühle `near:esstisch`). Fehlt eine ID,
    gilt anzahl 1 → Alt-Verhalten byte-identisch (Determinismus unberührt). Jede
    Instanz durchläuft Kollision/Feasibility normal; Relationen (near:esstisch …)
    gelten je Instanz.
    """
    rnd = random.Random(seed)
    by_id = {c["id"]: c for c in catalog}
    # Mengen-Expansion: jede itemId erscheint anzahl-mal (Default 1) – konsekutiv,
    # damit die deterministische P1→P2→P3-Aufteilung/Reihenfolge stabil bleibt.
    items = [by_id[i] for i in auswahl_ids for _ in range(max(1, (mengen or {}).get(i, 1)))]
    p1 = [i for i in items if i["priorityClass"] == "P1"]
    p2 = [i for i in items if i["priorityClass"] == "P2"]
    p3 = [i for i in items if i["priorityClass"] == "P3"]
    # Relationen (relationaleAbsichten + anordnung-Override) zentral aufbauen –
    # dieselbe Quelle wie die Varianten-Bewertung (kein Drift).
    rel_map = baue_rel_map(relationale_absichten, anordnung)

    # Anordnung (weich) einweben: wandIndex/prioritaet sammeln (relationen sind
    # schon in rel_map). Ungültiges wird robust ignoriert.
    wand_wunsch: dict[str, int] = {}
    prio: dict[str, int] = {}
    n_walls = len(room["shell"]["walls"])
    for a in anordnung or []:
        iid = a.get("itemId")
        if iid is None:
            continue
        wi = a.get("wandIndex")
        if isinstance(wi, int) and not isinstance(wi, bool) and 0 <= wi < n_walls:
            wand_wunsch[iid] = wi
        pr = a.get("prioritaet")
        if isinstance(pr, int) and not isinstance(pr, bool):
            prio[iid] = pr
    if prio:
        # Stabile Reihenfolge: kleinere prioritaet zuerst; Items ohne Angabe
        # behalten ihre relative Reihenfolge (inf) und landen dahinter.
        p2 = sorted(p2, key=lambda it: prio.get(it["id"], math.inf))
        p3 = sorted(p3, key=lambda it: prio.get(it["id"], math.inf))

    floor: list[Vec2] = [(float(p[0]), float(p[1])) for p in room["shell"]["floor"]["polygon"]]
    ctx = _PlatzKontext(
        floor=floor,
        style_vector=(style_profile or {}).get("styleVector", {}) or {},
        typ_pos={},
        id_pos={},
        gruppen_pos={},
    )

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
        # P1 bleibt anschluss-/backtracking-getrieben; nur against-wall/corner
        # dürfen die Reihenfolge lenken (Zulässigkeit unberührt). Ohne solche
        # Relation ist das ein No-op → identisch zur reinen seed-Mischung.
        p1_rels: list[Relation] = [
            r for r in rel_map.get(item["id"], []) if isinstance(r, AgainstWall | Corner)
        ]
        if p1_rels:
            kandidaten = _filter_kandidaten(kandidaten, p1_rels, ctx)
            kandidaten.sort(key=lambda k: -_kandidat_score(k, p1_rels, ctx))
        # Wandwunsch bei P1: nur Ranking (Anschluss/Backtracking geht vor) – die
        # Wunschwand wird zuerst probiert, das Backtracking bleibt vollständig.
        kandidaten = _bevorzuge_wand(kandidaten, wand_wunsch.get(item["id"]))
        for kandidat in kandidaten[:P1_CAP]:
            placement = _als_placement(item, kandidat, rnd)
            placements.append(placement)
            if not _schnell_unzulaessig(room, placements, by_id, placement) and (
                _zulaessig(room, placements, catalog, rules, norm_profile, nur_hart=True)
                is not None
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
                    nur_hart=True,
                )
                for k in _candidates(room, item)
            )
            if not einzeln:
                raise NoFeasiblePlacement(item["funktionsTyp"])
        raise NoFeasiblePlacement(p1[-1]["funktionsTyp"] if p1 else "unbekannt")

    # Kontext mit den fixierten P1-Posen erden (Anker für P2/P3-Relationen).
    for pl in placements:
        it = by_id[pl["catalogItemId"]]
        _merke_platzierung(
            ctx, it, rel_map.get(it["id"], []), (pl["pose"]["pos"][0], pl["pose"]["pos"][1])
        )
    # Verkehrsweg: Tür-Zugänge für optionale (P2/P3) Objekte freihalten.
    korridore = _tuer_korridore(room)

    def platziere_optional(items: list[dict[str, Any]], cap: int) -> None:
        """Greedy-Platzierung von P2/P3: relational gefiltert + Soft-Score-geordnet.

        Jedes Objekt ist optional – findet sich kein zulässiger Platz, bleibt es
        weg (kein Abbruch). Nach jedem Treffer wird der Kontext fortgeschrieben,
        damit Gruppen/Paare/Ausrichtungen auf schon Platziertes zielen können.
        """
        for item in items:
            rels = rel_map.get(item["id"], [])
            kandidaten = _ordne_kandidaten(
                _candidates(room, item), rels, ctx, rnd, wand_wunsch.get(item["id"])
            )
            for kandidat in kandidaten[:cap]:
                if _blockiert_korridor(item, kandidat, korridore):
                    continue
                placement = _als_placement(item, kandidat, rnd)
                placements.append(placement)
                if not _schnell_unzulaessig(room, placements, by_id, placement) and (
                    _zulaessig(room, placements, catalog, rules, norm_profile, nur_hart=True)
                    is not None
                ):
                    _merke_platzierung(ctx, item, rels, kandidat.pos)
                    break
                placements.pop()

    # Pass 2 – P2: funktional sekundär, relational zu den P1-Ankern.
    platziere_optional(p2, 300)
    # Pass 3 – P3 (Dekor): dieselbe Mechanik auf den Restflächen; die Seed-
    # Mischung liefert hier die «Würfel»-Variation, ohne harte Regeln zu berühren.
    platziere_optional(p3, 200)

    report = _zulaessig(room, placements, catalog, rules, norm_profile)
    assert report is not None  # per Konstruktion – Solver-Invariante

    # Farbwahl je Objekt (Kurator-Pipeline v3, Welle 3) durchreichen: der Kurator
    # (oder die manuelle UI-Wahl) liefert `farben` als itemId→Slug; hier landet
    # sie als `placement.farbe`. Rein visuell (Slug ist auf `farbVarianten`
    # geerdet, keine Norm-Relevanz) → Determinismus/Solver-Invariante unberührt.
    if farben:
        for pl in placements:
            slug = farben.get(pl["catalogItemId"])
            if slug:
                pl["farbe"] = slug

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
