"""Zonen-Ableitung: Grossraum-Raummodell → Teilraum je Zone.

Brain-Vorgabe: Küchen-Detailkonzept Teil 3 (Grossraum, Zonen & offene Kanten).
Im Grossraum (eine Hülle, mehrere `zones[]`) gelten Regeln **pro Zone**. Damit
Solver und Regel-Interpreter UNVERÄNDERT arbeiten können, projizieren wir eine
Zone auf ein eigenständiges, schema-valides Raummodell (Teilraum):

- floor.polygon  = Zonen-Polygon (Fläche neu via Shoelace).
- walls          = Hüllen-Segmente auf dem Zonenrand bleiben (massiv/offen);
                   Zonenkanten OHNE Hüllenwand werden synthetisch `virtuell`.
- openings       = nur Öffnungen, deren Hostwand auf einer Zonenkante liegt.
- fixpoints      = nur die mit zone == zone_id ODER Position im Zonen-Polygon.
- roomType       = roomType der Zone (so greift der richtige Regelsatz).

Der Solver platziert nur an `kind == "massiv"` (verifiziert in solver.py
`_wall_candidates`), virtuelle/offene Kanten tragen also nichts – genau wie eine
Zonengrenze ohne physische Wand es verlangt.

v0-Annahme (bewusst, im POC ausreichend): Zonen sind **achsparallele Rechtecke**
und die Zonenkanten liegen auf gemeinsamen Achsen mit den Hüllen-Wänden. Die
Zuordnung «Hüllenwand liegt auf Zonenkante» nutzt eine Toleranz statt exakter
Polygon-Verschneidung. Beliebige (schiefe) Zonengeometrie kommt post-POC.
"""

from __future__ import annotations

import uuid
from typing import Any

from fp_engines.rules.geometry import Vec2, dist_point_to_segment, point_in_polygon

# Toleranz (m), innerhalb derer ein Punkt als «auf einer Kante liegend» gilt.
_EPS = 1e-3

# Fester Namespace für deterministische Teilraum-IDs (UUIDv5 aus room.id+zone_id).
_ZONE_NS = uuid.UUID("00000000-0000-5000-8000-00000000d017")


def _shoelace_area(polygon: list[list[float]]) -> float:
    """Polygonfläche (immer positiv) über die Gauss'sche Trapezformel."""
    n = len(polygon)
    s = 0.0
    for i in range(n):
        x1, z1 = polygon[i]
        x2, z2 = polygon[(i + 1) % n]
        s += x1 * z2 - x2 * z1
    return abs(s) / 2


def _polygon_edges(polygon: list[list[float]]) -> list[tuple[Vec2, Vec2]]:
    n = len(polygon)
    return [
        ((polygon[i][0], polygon[i][1]), (polygon[(i + 1) % n][0], polygon[(i + 1) % n][1]))
        for i in range(n)
    ]


def _point_on_segment(p: Vec2, a: Vec2, b: Vec2, eps: float = _EPS) -> bool:
    return dist_point_to_segment(p, a, b) <= eps


def _wall_on_edge(wall: dict[str, Any], edge: tuple[Vec2, Vec2]) -> bool:
    """Deckt ein Hüllen-Wandsegment eine Zonenkante (anteilig) ab?

    v0: Der Mittelpunkt der ZONENKANTE muss auf dem Wandsegment liegen. Damit
    deckt auch eine lange Hüllenwand (z.B. ganze Stirnseite des Grossraums) die
    kürzere Zonenkante korrekt ab – genügt für achsparallele Rechteck-Zonen,
    deren Kanten mit Hüllen-Wänden auf gemeinsamer Achse liegen.
    """
    a, b = edge
    edge_mid: Vec2 = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    return _point_on_segment(edge_mid, (wall["start"][0], wall["start"][1]),
                             (wall["end"][0], wall["end"][1]))


def _clip_openings(
    host: dict[str, Any],
    edge: tuple[Vec2, Vec2],
    seg_id: str,
    all_openings: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Öffnungen einer Hüllenwand, die im Bereich der Zonenkante liegen.

    Der Offset wird auf den neuen (geclippten) Wand-Start umgerechnet und die
    hostWall auf das Teilraum-Segment umgehängt. v0: Öffnung gilt als zur Zone
    gehörig, wenn ihr Mittelpunkt auf der Zonenkante liegt (achsparallel).
    """
    out: list[dict[str, Any]] = []
    hs: Vec2 = (host["start"][0], host["start"][1])
    he: Vec2 = (host["end"][0], host["end"][1])
    hlen = ((he[0] - hs[0]) ** 2 + (he[1] - hs[1]) ** 2) ** 0.5
    if hlen == 0:
        return out
    ux, uz = (he[0] - hs[0]) / hlen, (he[1] - hs[1]) / hlen
    a, b = edge
    for op in (o for o in all_openings if o["hostWall"] == host["id"]):
        mid = op["offset"] + op["width"] / 2
        cx, cz = hs[0] + ux * mid, hs[1] + uz * mid
        if not _point_on_segment((cx, cz), a, b):
            continue
        # neuer Offset = Projektion des Öffnungs-Anfangs auf die Kante ab a
        start_x, start_z = hs[0] + ux * op["offset"], hs[1] + uz * op["offset"]
        new_offset = ((start_x - a[0]) ** 2 + (start_z - a[1]) ** 2) ** 0.5
        clipped = dict(op)
        clipped["hostWall"] = seg_id
        clipped["offset"] = round(new_offset, 4)
        out.append(clipped)
    return out


def _zone_polygon(room: dict[str, Any], zone_id: str) -> tuple[dict[str, Any], list[list[float]]]:
    for zone in room.get("zones", []):
        if zone["id"] == zone_id:
            return zone, [list(p) for p in zone["polygon"]]
    raise ValueError(f"Zone {zone_id} nicht im Raummodell {room['id']} gefunden")


def zone_room(room: dict[str, Any], zone_id: str) -> dict[str, Any]:
    """Leitet aus einem Grossraum-Raummodell den Teilraum einer Zone ab.

    Ergebnis ist ein eigenständiges, gegen `raummodell.schema.json` valides
    Raummodell, auf dem Solver und Regel-Interpreter ohne Änderung laufen.
    Reine Funktion (kein Seiteneffekt am Eingabe-`room`).
    """
    zone, polygon = _zone_polygon(room, zone_id)
    edges = _polygon_edges(polygon)
    height = room["shell"]["ceiling"]["height"]

    # 1) Wände: je Zonenkante GENAU EIN Segment, geclippt auf die Kante. Deckt
    #    eine Hüllenwand die Kante ab, erbt das Segment deren kind/Höhe/Dicke
    #    (massiv bleibt massiv, offen bleibt offen); sonst → synthetisch
    #    virtuell. So bleibt die Teilraum-Hülle geschlossen UND die Wand-
    #    Kandidaten des Solvers laufen nur entlang der Zonenkanten, nie über die
    #    volle Grossraum-Wand hinaus.
    walls: list[dict[str, Any]] = []
    # Öffnungen sammeln wir gleich mit: nur die, die auf einer Zonenkante liegen,
    # und mit hostWall auf das neue (geclippte) Segment umgehängt.
    openings: list[dict[str, Any]] = []
    for ei, edge in enumerate(edges):
        a, b = edge
        seg_id = str(uuid.uuid5(_ZONE_NS, f"{zone_id}:wall:{ei}"))
        host = next((w for w in room["shell"]["walls"] if _wall_on_edge(w, edge)), None)
        if host is not None:
            seg: dict[str, Any] = {
                "id": seg_id,
                "start": [a[0], a[1]],
                "end": [b[0], b[1]],
                "height": host["height"],
                "thickness": host["thickness"],
                "kind": host["kind"],
            }
            zone_openings = _clip_openings(host, edge, seg_id, room["openings"])
            if zone_openings:
                seg["openings"] = [op["id"] for op in zone_openings]
                openings.extend(zone_openings)
            walls.append(seg)
        else:
            walls.append(
                {
                    "id": seg_id,
                    "start": [a[0], a[1]],
                    "end": [b[0], b[1]],
                    "height": height,
                    "thickness": 0,
                    "kind": "virtuell",
                }
            )

    # 2) Fixpunkte: explizit der Zone zugeordnet ODER Position im Zonen-Polygon.
    poly_vecs: list[Vec2] = [(p[0], p[1]) for p in polygon]
    fixpoints: list[dict[str, Any]] = []
    for fp in room["fixpoints"]:
        pos: Vec2 = (fp["position"][0], fp["position"][1])
        if fp.get("zone") == zone_id or point_in_polygon(pos, poly_vecs):
            fixpoints.append(dict(fp))

    derived_id = str(uuid.uuid5(_ZONE_NS, f"{room['id']}:{zone_id}"))
    return {
        "id": derived_id,
        "schemaVersion": room["schemaVersion"],
        "name": f"{room['name']} – {zone['name']}",
        "roomType": zone["roomType"],
        "source": room["source"],
        "units": room["units"],
        "shell": {
            "walls": walls,
            "floor": {
                "polygon": [list(p) for p in polygon],
                "area": round(_shoelace_area(polygon), 4),
            },
            "ceiling": {"height": height},
        },
        "openings": openings,
        "zones": [],
        "fixpoints": fixpoints,
        "objects": [],
        "meta": dict(room["meta"]),
    }
