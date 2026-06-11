"""3D-Export: Raum + Plan als glTF 2.0 (MVP-Dokument «3D-Export»).

Minimaler, handgebauter glTF-Writer ohne Zusatz-Dependency: EIN Einheitswürfel
als Mesh, jede Wand/jedes Möbel als Node mit Translation/Rotation/Skalierung.
Damit ist der Export exakt deckungsgleich mit dem Box-Platzhalter-Viewer
(gleiche Konvention: y-up, Meter, yaw um +y). Items mit echtem gltfRef werden
später referenziert statt als Box exportiert (Auto-Upgrade-Prinzip).
"""

import base64
import math
import struct
from typing import Any

from fp_engines.rules.geometry import cos_deg, sin_deg

# CI-Farben je Prioritätsklasse (wie Viewer) + Bauteile.
_FARBEN = {
    "P1": (0.12, 0.30, 0.23, 1.0),
    "P2": (0.36, 0.54, 0.45, 1.0),
    "P3": (0.64, 0.73, 0.67, 1.0),
    "wand": (0.85, 0.82, 0.77, 0.45),
    "boden": (0.91, 0.89, 0.84, 1.0),
}


def _einheitswuerfel() -> tuple[bytes, int, int]:
    """Positions- und Index-Puffer eines Einheitswürfels (zentriert, Kantenlänge 1)."""
    h = 0.5
    ecken = [
        (-h, -h, -h),
        (h, -h, -h),
        (h, h, -h),
        (-h, h, -h),
        (-h, -h, h),
        (h, -h, h),
        (h, h, h),
        (-h, h, h),
    ]
    flaechen = [
        (0, 1, 2, 3),
        (4, 5, 6, 7),
        (0, 1, 5, 4),
        (2, 3, 7, 6),
        (0, 3, 7, 4),
        (1, 2, 6, 5),
    ]
    indices: list[int] = []
    for a, b, c, d in flaechen:
        indices += [a, b, c, a, c, d]
    pos = b"".join(struct.pack("<fff", *e) for e in ecken)
    idx = b"".join(struct.pack("<H", i) for i in indices)
    return pos + idx, len(ecken), len(indices)


def _quat_y(yaw_deg: float) -> list[float]:
    """Quaternion für Rotation um +y (gleiche Konvention wie rotate_y)."""
    return [0.0, sin_deg(yaw_deg / 2), 0.0, cos_deg(yaw_deg / 2)]


def szene_gltf(
    room: dict[str, Any], plan: dict[str, Any], catalog: list[dict[str, Any]]
) -> dict[str, Any]:
    by_id = {c["id"]: c for c in catalog}
    puffer, n_ecken, n_indices = _einheitswuerfel()

    materials: list[dict[str, Any]] = []
    material_index: dict[str, int] = {}
    for name, rgba in _FARBEN.items():
        material_index[name] = len(materials)
        mat: dict[str, Any] = {
            "name": name,
            "pbrMetallicRoughness": {"baseColorFactor": list(rgba), "roughnessFactor": 0.9},
        }
        if rgba[3] < 1.0:
            mat["alphaMode"] = "BLEND"
        materials.append(mat)

    meshes = [
        {
            "name": f"box-{name}",
            "primitives": [
                {"attributes": {"POSITION": 0}, "indices": 1, "material": material_index[name]}
            ],
        }
        for name in _FARBEN
    ]
    mesh_index = {name: i for i, name in enumerate(_FARBEN)}

    nodes: list[dict[str, Any]] = []

    # Boden als flache Platte über der Bounding-Box des Polygons.
    poly = room["shell"]["floor"]["polygon"]
    xs = [p[0] for p in poly]
    zs = [p[1] for p in poly]
    nodes.append(
        {
            "name": "boden",
            "mesh": mesh_index["boden"],
            "translation": [(min(xs) + max(xs)) / 2, -0.01, (min(zs) + max(zs)) / 2],
            "scale": [max(xs) - min(xs), 0.02, max(zs) - min(zs)],
        }
    )

    for w in room["shell"]["walls"]:
        dx = w["end"][0] - w["start"][0]
        dz = w["end"][1] - w["start"][1]
        laenge = math.hypot(dx, dz)
        # Wand-Yaw: Box-x entlang der Wandrichtung ausrichten.
        yaw = math.degrees(math.atan2(dz, -dx)) + 180
        nodes.append(
            {
                "name": f"wand-{w['id'][:8]}",
                "mesh": mesh_index["wand"],
                "translation": [
                    (w["start"][0] + w["end"][0]) / 2,
                    w["height"] / 2,
                    (w["start"][1] + w["end"][1]) / 2,
                ],
                "rotation": _quat_y(yaw),
                "scale": [laenge, w["height"], max(w["thickness"], 0.02)],
            }
        )

    for p in plan["placements"]:
        item = by_id[p["catalogItemId"]]
        m = item["masse"]
        y = (p.get("mountHeight") or 0.0) + m["h"] / 2
        nodes.append(
            {
                "name": item["funktionsTyp"],
                "mesh": mesh_index.get(item["priorityClass"], mesh_index["P3"]),
                "translation": [p["pose"]["pos"][0], y, p["pose"]["pos"][1]],
                "rotation": _quat_y(p["pose"]["yawDeg"]),
                "scale": [m["w"], m["h"], m["d"]],
            }
        )

    pos_laenge = n_ecken * 12
    return {
        "asset": {"version": "2.0", "generator": "future-planning-poc"},
        "scene": 0,
        "scenes": [{"name": room["name"], "nodes": list(range(len(nodes)))}],
        "nodes": nodes,
        "meshes": meshes,
        "materials": materials,
        "buffers": [
            {
                "byteLength": len(puffer),
                "uri": "data:application/octet-stream;base64," + base64.b64encode(puffer).decode(),
            }
        ],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": pos_laenge, "target": 34962},
            {"buffer": 0, "byteOffset": pos_laenge, "byteLength": n_indices * 2, "target": 34963},
        ],
        "accessors": [
            {
                "bufferView": 0,
                "componentType": 5126,
                "count": n_ecken,
                "type": "VEC3",
                "min": [-0.5, -0.5, -0.5],
                "max": [0.5, 0.5, 0.5],
            },
            {"bufferView": 1, "componentType": 5123, "count": n_indices, "type": "SCALAR"},
        ],
    }
