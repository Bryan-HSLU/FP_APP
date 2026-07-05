"""Parser für das SpatialLM-Layout-Textformat (`layout.txt`).

SpatialLM gibt die erkannte Szene als Zeilen der Form
``wall_0=Wall(ax,ay,az,bx,by,bz,height,thickness)`` aus – Koordinaten **z-up**,
metrisch. Türen/Fenster referenzieren ihre Wand per Token (``wall_0``), Objekte
kommen als orientierte Bounding-Box mit Klassen-Label.

Die Zahlen-Konventionen (Winkel in Radiant, scale = volle Ausdehnung) folgen dem
SpatialLM-Repo; sie werden im R1-Lauf (Fahrplan Schritt 5) gegen echte Ausgaben
verifiziert. Der Parser ist bewusst tolerant gegen Leerzeilen/Kommentare, aber
strikt bei kaputten Zeilen – ehrliches Scheitern statt stiller Rate-Werte.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

__all__ = [
    "Bbox",
    "Door",
    "LayoutParseFehler",
    "SpatialLmLayout",
    "Wall",
    "Window",
    "parse_layout",
]


class LayoutParseFehler(ValueError):
    """Eine Layout-Zeile ist nicht interpretierbar."""


@dataclass(frozen=True)
class Wall:
    """Wandsegment, Fusspunkte a→b (z-up), Höhe/Dicke in Metern."""

    id: str
    ax: float
    ay: float
    az: float
    bx: float
    by: float
    bz: float
    height: float
    thickness: float


@dataclass(frozen=True)
class Door:
    """Türöffnung: Zentrum (x,y,z) auf der referenzierten Wand."""

    id: str
    wall_id: str
    x: float
    y: float
    z: float
    width: float
    height: float


@dataclass(frozen=True)
class Window:
    """Fensteröffnung, gleiche Semantik wie Door (Zentrum auf Wand)."""

    id: str
    wall_id: str
    x: float
    y: float
    z: float
    width: float
    height: float


@dataclass(frozen=True)
class Bbox:
    """Orientierte Objekt-Box: Zentrum, Rotation um z (rad), volle Ausdehnung."""

    id: str
    label: str
    x: float
    y: float
    z: float
    angle_z: float
    sx: float
    sy: float
    sz: float


@dataclass(frozen=True)
class SpatialLmLayout:
    walls: list[Wall] = field(default_factory=list)
    doors: list[Door] = field(default_factory=list)
    windows: list[Window] = field(default_factory=list)
    bboxes: list[Bbox] = field(default_factory=list)


_ZEILE = re.compile(r"^(?P<id>\w+)\s*=\s*(?P<typ>Wall|Door|Window|Bbox)\((?P<args>.*)\)\s*$")


def _floats(teile: list[str], n: int, zeile: str) -> list[float]:
    if len(teile) != n:
        raise LayoutParseFehler(f"Erwartete {n} Zahlen, bekam {len(teile)}: {zeile!r}")
    try:
        return [float(t) for t in teile]
    except ValueError as e:
        raise LayoutParseFehler(f"Keine Zahl in {zeile!r}: {e}") from e


def parse_layout(text: str) -> SpatialLmLayout:
    """Parst den kompletten Layout-Text; unbekannte Entitätstypen sind ein Fehler.

    Leerzeilen und ``#``-Kommentare werden übersprungen (erlaubt annotierte
    Test-Fixtures, echte SpatialLM-Ausgaben enthalten beides nicht).
    """
    walls: list[Wall] = []
    doors: list[Door] = []
    windows: list[Window] = []
    bboxes: list[Bbox] = []

    for roh in text.splitlines():
        zeile = roh.strip()
        if not zeile or zeile.startswith("#"):
            continue
        m = _ZEILE.match(zeile)
        if m is None:
            raise LayoutParseFehler(f"Zeile nicht interpretierbar: {zeile!r}")
        eid, typ = m.group("id"), m.group("typ")
        args = [a.strip().strip("'\"") for a in m.group("args").split(",")]

        if typ == "Wall":
            f = _floats(args, 8, zeile)
            walls.append(Wall(eid, f[0], f[1], f[2], f[3], f[4], f[5], f[6], f[7]))
        elif typ in ("Door", "Window"):
            wall_ref, rest = args[0], args[1:]
            f = _floats(rest, 5, zeile)
            if typ == "Door":
                doors.append(Door(eid, wall_ref, f[0], f[1], f[2], f[3], f[4]))
            else:
                windows.append(Window(eid, wall_ref, f[0], f[1], f[2], f[3], f[4]))
        else:  # Bbox
            label, rest = args[0], args[1:]
            f = _floats(rest, 7, zeile)
            bboxes.append(Bbox(eid, label, f[0], f[1], f[2], f[3], f[4], f[5], f[6]))

    return SpatialLmLayout(walls=walls, doors=doors, windows=windows, bboxes=bboxes)
