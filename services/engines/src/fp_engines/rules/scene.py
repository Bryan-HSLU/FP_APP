"""Szenen-Aufbau: Raummodell + Plan + Katalog → auswertbare Szene.

⚠️ PARITÄT: 1:1-Spiegel von packages/shared/src/rules/scene.ts.
Arbeitet bewusst auf rohen dicts (den JSON-Artefakten) – die generierten
pydantic-Modelle validieren an der API-Grenze, der Interpreter bleibt
schema-nah und deckungsgleich mit der TS-Seite.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fp_engines.rules.geometry import Quad, Vec2, footprint


@dataclass
class SceneObject:
    """Ein auswertbares Objekt der Szene (Platzierung ODER Bestandsobjekt)."""

    id: str
    funktions_typ: str
    quad: Quad
    center: Vec2
    yaw_deg: float
    w: float
    d: float
    h: float
    mount: str
    mount_height: float | None
    anschluesse: list[str]
    is_placement: bool


@dataclass
class Scene:
    room_type: str
    floor: list[Vec2]
    walls: list[dict[str, Any]]
    openings: list[dict[str, Any]]
    fixpoints: list[dict[str, Any]]
    objects: list[SceneObject]
    norm_profile: str
    #: Unsicherheits-Marge der Konfidenz-Ampel in cm (0, wenn Geometrie bestätigt).
    marge_cm: float


def _vec2(v: list[float]) -> Vec2:
    return (v[0], v[1])


def build_scene(room: dict[str, Any], plan: dict[str, Any], catalog: list[dict[str, Any]]) -> Scene:
    by_id = {c["id"]: c for c in catalog}
    objects: list[SceneObject] = []

    for p in plan["placements"]:
        item = by_id.get(p["catalogItemId"])
        if item is None:
            raise ValueError(f"Placement {p['id']}: Katalog-Item {p['catalogItemId']} fehlt")
        pos = _vec2(p["pose"]["pos"])
        masse = item["masse"]
        objects.append(
            SceneObject(
                id=p["id"],
                funktions_typ=item["funktionsTyp"],
                quad=footprint(pos, masse["w"], masse["d"], p["pose"]["yawDeg"]),
                center=pos,
                yaw_deg=p["pose"]["yawDeg"],
                w=masse["w"],
                d=masse["d"],
                h=masse["h"],
                mount=item.get("mount", "boden"),
                mount_height=p.get("mountHeight"),
                anschluesse=list(item.get("anschluesse", [])),
                is_placement=True,
            )
        )

    for o in room["objects"]:
        pos = _vec2(o["pose"]["pos"])
        bbox = o["geometry"]["bbox"]
        objects.append(
            SceneObject(
                id=o["id"],
                funktions_typ=o["label"],
                quad=footprint(pos, bbox["w"], bbox["d"], o["pose"]["yawDeg"]),
                center=pos,
                yaw_deg=o["pose"]["yawDeg"],
                w=bbox["w"],
                d=bbox["d"],
                h=bbox["h"],
                mount="boden",
                mount_height=None,
                anschluesse=[],
                is_placement=False,
            )
        )

    meta = room["meta"]
    return Scene(
        room_type=room["roomType"],
        floor=[_vec2(p) for p in room["shell"]["floor"]["polygon"]],
        walls=room["shell"]["walls"],
        openings=room["openings"],
        fixpoints=room["fixpoints"],
        objects=objects,
        norm_profile=plan["meta"]["normProfile"],
        marge_cm=0.0 if meta["geometryConfirmed"] else meta["estimatedError_cm"],
    )
