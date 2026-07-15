"""Adapter: SpatialLM-Layout (z-up) → schema-valides Raummodell (y-up).

Das ist die Vertrags-Naht der Scan-Pipeline (Brain: M2-M7-Scan-Pipeline-Fahrplan):
egal woher die Punktwolke kam (known-pose Fusion, MASt3R-SLAM, …) – ab hier
spricht alles `raummodell.json`, und Solver/Viewer laufen unverändert.

Koordinaten-Konvention:
- SpatialLM: rechtshändig, **z-up**, Grundriss in x/y, metrisch.
- Raummodell: rechtshändig, **y-up**, Grundriss in x/z ([x, z]-vec2), Meter.
- Abbildung = Rotation um die x-Achse (kein Spiegel!): (x, y, z) → (x, z, −y),
  im Grundriss also (x_plan, z_plan) = (slm_x, −slm_y). Danach wird auf
  min-x/min-z = 0 verschoben (wie die Sample-Fixtures) und auf mm gerundet.
- Yaw: yawDeg = −deg(angle_z). Das Vorzeichen folgt der Achsabbildung und wird
  im R1-Lauf (Fahrplan Schritt 5) gegen echte SpatialLM-Ausgaben verifiziert.

Determinismus: gleicher Input ⇒ identisches Ergebnis. IDs sind uuid5 über
(Name, Entität, Index) – kein Zufall im Adapter.
"""

from __future__ import annotations

import math
import uuid
from typing import Any

from fp_engines.scan.spatiallm import SpatialLmLayout

__all__ = ["AdapterFehler", "layout_to_raummodell"]

_NS = uuid.uuid5(uuid.NAMESPACE_URL, "future-planning/scan-adapter")

# Endpunkt-Toleranz fürs Ketten der Wandsegmente: echte Scans treffen Ecken
# nie exakt; 2 cm liegt deutlich unter der Scan-Unsicherheit (~8.5 cm, ADR-0003).
_KETTEN_TOL = 0.02

# SpatialLM liefert keine Konfidenz pro Objekt → konservativer Mittelwert,
# jedes Objekt geht mit needsReview=True in den Korrektur-Modus (ADR-0003).
_OBJEKT_KONFIDENZ = 0.5


class AdapterFehler(ValueError):
    """Layout ist nicht in ein gültiges Raummodell überführbar (z.B. offene Hülle)."""


def _r(v: float) -> float:
    """mm-Rundung; +0.0 verhindert -0.0 im JSON."""
    return round(v, 3) + 0.0


def _id(name: str, art: str, idx: int | str) -> str:
    return str(uuid.uuid5(_NS, f"{name}|{art}|{idx}"))


def _kette(
    punkte: list[tuple[tuple[float, float], tuple[float, float]]],
) -> list[tuple[float, float]]:
    """Kettet Wandsegmente zum geschlossenen Boden-Polygon.

    Segmente dürfen ungeordnet und beliebig orientiert sein; verbunden wird der
    jeweils erste passende Endpunkt in Eingabereihenfolge (deterministisch).
    Schliesst die Kette nicht, ist das ein ehrlicher Fehler – kein stilles
    Rate-Polygon (Korrektur-Modus repariert später beim Nutzer, nicht hier).
    """

    def dist(a: tuple[float, float], b: tuple[float, float]) -> float:
        return math.hypot(a[0] - b[0], a[1] - b[1])

    offen = list(range(1, len(punkte)))
    kette = [punkte[0][0], punkte[0][1]]
    while offen:
        naechster: tuple[int, tuple[float, float]] | None = None
        for i in offen:
            start, ende = punkte[i]
            if dist(start, kette[-1]) <= _KETTEN_TOL:
                naechster = (i, ende)
                break
            if dist(ende, kette[-1]) <= _KETTEN_TOL:
                naechster = (i, start)
                break
        if naechster is None:
            raise AdapterFehler(
                "Wand-Hülle nicht geschlossen: kein Anschluss-Segment an "
                f"Punkt {kette[-1]} (Toleranz {_KETTEN_TOL} m)."
            )
        offen.remove(naechster[0])
        kette.append(naechster[1])
    if dist(kette[0], kette[-1]) > _KETTEN_TOL:
        raise AdapterFehler("Wand-Hülle nicht geschlossen: Kettenende trifft den Anfang nicht.")
    return kette[:-1]


def _flaeche(polygon: list[tuple[float, float]]) -> float:
    s = 0.0
    for (x1, z1), (x2, z2) in zip(polygon, polygon[1:] + polygon[:1], strict=True):
        s += x1 * z2 - x2 * z1
    return abs(s) / 2.0


def layout_to_raummodell(
    layout: SpatialLmLayout,
    *,
    name: str,
    room_type: str = "sonstig",
    source: str = "video",
    estimated_error_cm: float = 8.5,
) -> dict[str, Any]:
    """Überführt ein geparstes SpatialLM-Layout in ein Raummodell-Dict.

    `room_type` kommt vom Aufrufer (UI/Workflow) – SpatialLM kennt unseren
    Raumtyp nicht. `estimated_error_cm` default ~8.5 cm (ohne LiDAR, ADR-0003);
    die Konfidenz-Ampel rechnet diese Marge in die harten Checks ein.
    Fixpunkte bleiben leer: Anschlüsse erkennt der Scan nicht, sie kommen aus
    Bestand/Korrektur-Modus (Brain: Anschluesse-Standort-und-Vorwand).
    """
    if len(layout.walls) < 3:
        raise AdapterFehler(f"Zu wenige Wände ({len(layout.walls)}) für eine Hülle.")

    # z-up → y-up im Grundriss: (x, y) → (x, −y)
    roh = [((w.ax, -w.ay), (w.bx, -w.by)) for w in layout.walls]
    dx = min(p[0] for seg in roh for p in seg)
    dz = min(p[1] for seg in roh for p in seg)

    def t(p: tuple[float, float]) -> tuple[float, float]:
        return (_r(p[0] - dx), _r(p[1] - dz))

    segmente = [(t(s), t(e)) for s, e in roh]
    polygon = _kette(segmente)

    wall_ids = {w.id: _id(name, "wall", w.id) for w in layout.walls}
    walls = [
        {
            "id": wall_ids[w.id],
            "start": list(seg[0]),
            "end": list(seg[1]),
            "height": _r(w.height),
            "thickness": _r(max(w.thickness, 0.0)),
            "kind": "massiv",
        }
        for w, seg in zip(layout.walls, segmente, strict=True)
    ]
    hoehe = _r(max(w.height for w in layout.walls))

    openings: list[dict[str, Any]] = []
    for oeff, typ in [(d, "door") for d in layout.doors] + [(f, "window") for f in layout.windows]:
        if oeff.wall_id not in wall_ids:
            raise AdapterFehler(f"Öffnung {oeff.id} referenziert unbekannte Wand {oeff.wall_id!r}.")
        idx = next(i for i, w in enumerate(layout.walls) if w.id == oeff.wall_id)
        (sx, sz), (ex, ez) = segmente[idx]
        laenge = math.hypot(ex - sx, ez - sz)
        cx, cz = _r(oeff.x - dx), _r(-oeff.y - dz)
        # Projektion des Öffnungs-Zentrums auf die Wandachse → offset ab Wand-Start
        u = ((cx - sx) * (ex - sx) + (cz - sz) * (ez - sz)) / max(laenge, 1e-9)
        offset = min(max(u - oeff.width / 2.0, 0.0), max(laenge - oeff.width, 0.0))
        # Fenster: Zentrum → Unterkante (Brüstung); Türen stehen am Boden.
        sill = 0.0 if typ == "door" else max(oeff.z - oeff.height / 2.0, 0.0)
        opening_id = _id(name, "opening", oeff.id)
        openings.append(
            {
                "id": opening_id,
                "type": typ,
                "hostWall": wall_ids[oeff.wall_id],
                "offset": _r(offset),
                "width": _r(oeff.width),
                "height": _r(oeff.height),
                "sill": _r(sill),
            }
        )
        wand: dict[str, Any] = walls[idx]
        wand.setdefault("openings", []).append(opening_id)

    objects = [
        {
            "id": _id(name, "object", b.id),
            "label": b.label,
            "geometry": {
                "repr": "bbox",
                "bbox": {"w": _r(b.sx), "d": _r(b.sy), "h": _r(b.sz)},
            },
            "pose": {
                "pos": [_r(b.x - dx), _r(-b.y - dz)],
                "yawDeg": _r(-math.degrees(b.angle_z) % 360.0),
            },
            "movable": True,
            "confidence": _OBJEKT_KONFIDENZ,
            "needsReview": True,
        }
        for b in layout.bboxes
    ]

    return {
        "id": _id(name, "raummodell", 0),
        "schemaVersion": "0.1.0",
        "name": name,
        "roomType": room_type,
        "source": source,
        "units": "m",
        "shell": {
            "walls": walls,
            "floor": {"polygon": [list(p) for p in polygon], "area": _r(_flaeche(polygon))},
            "ceiling": {"height": hoehe},
        },
        "openings": openings,
        "zones": [],
        "fixpoints": [],
        "objects": objects,
        "meta": {
            "captureMethod": "ar",
            "estimatedError_cm": estimated_error_cm,
            "geometryConfirmed": False,
        },
    }
