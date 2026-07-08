"""Relations-Grammatik der weichen Anordnungs-Ebene («KI wählt WAS, Solver WO»).

Der Kurator (bzw. `relationalRules` im Katalog) drückt räumliche Wünsche als
**reine Strings** aus; dieser Parser übersetzt sie in typisierte Absichten, die
der Solver als **weiche** Kandidatenfilter/Soft-Scores anwendet. Bewusst robust:
Unbekannte oder kaputte Relationen werden zu `None` (ignoriert), nie zu einem
harten Fehler – die Norm-Garantie hängt einzig am Feasibility-first-Filter des
Regel-Interpreters, nie an dieser Ebene.

Grammatik (alle Strings, `:`-getrennt):
- `near:<funktionsTyp>:<maxDist>` – nah bei einem Objekt dieses Typs (maxDist m,
  optional → sonst unbegrenzt).
- `against-wall` – Rücken an einer massiven Wand (Boden-Item: Wand-Kandidaten).
- `corner` – bevorzugt nahe einer Polygon-Ecke.
- `facing:<funktionsTyp>` – Front (lokal +z) zeigt zum nächsten Objekt des Typs.
- `opposite:<funktionsTyp>` – bevorzugt die dem Anker gegenüberliegende Raumhälfte.
- `group:<groupId>` – Objekte gleicher groupId landen als eine Einrichtung nah
  beieinander (z.B. Sofa+Couchtisch = Sitzgruppe).
- `pair-with:<itemId>` – Spezialfall von group: nah bei genau diesem Item.
"""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class Near:
    """Nah bei einem Objekt des Typs `funktions_typ` (Zentrumsabstand ≤ max_dist)."""

    funktions_typ: str
    max_dist: float


@dataclass(frozen=True)
class AgainstWall:
    """Rücken an einer massiven Wand (weicher Kandidatenfilter auf Wand-Posen)."""


@dataclass(frozen=True)
class Corner:
    """Bevorzugt nahe einer Ecke des Bodenpolygons (Soft-Score)."""


@dataclass(frozen=True)
class Facing:
    """Front (lokal +z) soll zum nächsten Objekt des Typs zeigen (Yaw-Präferenz)."""

    funktions_typ: str


@dataclass(frozen=True)
class Opposite:
    """Bevorzugt die dem Anker (Objekt dieses Typs) gegenüberliegende Raumhälfte."""

    funktions_typ: str


@dataclass(frozen=True)
class Group:
    """Objekte gleicher groupId sollen als eine Einrichtung nah beieinander landen."""

    group_id: str


@dataclass(frozen=True)
class PairWith:
    """Nah bei genau diesem Item (group-Spezialfall über eine konkrete itemId)."""

    item_id: str


Relation = Near | AgainstWall | Corner | Facing | Opposite | Group | PairWith


def parse_relation(roh: object) -> Relation | None:
    """Ein Relations-String → typisierte Relation; None wenn unbekannt/kaputt.

    Nie eine Exception: die weiche Ebene darf einen Plan nie scheitern lassen.
    """
    if not isinstance(roh, str):
        return None
    s = roh.strip()
    if not s:
        return None
    teile = s.split(":")
    kopf = teile[0]
    if kopf == "against-wall":
        return AgainstWall()
    if kopf == "corner":
        return Corner()
    if len(teile) < 2 or not teile[1]:
        return None
    arg = teile[1]
    if kopf == "near":
        # Distanz optional; fehlt/kaputt → unbegrenzt (reiner Nähe-Score, kein Filter).
        max_dist = math.inf
        if len(teile) >= 3 and teile[2]:
            try:
                max_dist = float(teile[2])
            except ValueError:
                return None
        return Near(arg, max_dist)
    if kopf == "facing":
        return Facing(arg)
    if kopf == "opposite":
        return Opposite(arg)
    if kopf == "group":
        return Group(arg)
    if kopf == "pair-with":
        return PairWith(arg)
    return None


def parse_relationen(rohe: list[str]) -> list[Relation]:
    """Liste von Relations-Strings → Liste typisierter Relationen (kaputte fallen weg)."""
    out: list[Relation] = []
    for r in rohe:
        rel = parse_relation(r)
        if rel is not None:
            out.append(rel)
    return out
