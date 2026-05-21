"""Export the reconstructed room as GLTF (walls + floor) + room.json."""

from __future__ import annotations

from pathlib import Path

from fp.schemas import RoomModel


def export_room_gltf(room: RoomModel, path: str | Path) -> None:
    import numpy as np
    import trimesh

    w = room.floor_polygon[1][0]
    l = room.floor_polygon[2][1]
    h = room.ceiling_height
    meshes = []

    floor = trimesh.creation.box(extents=[w, l, 0.02])
    floor.apply_translation([w / 2, l / 2, -0.01])
    floor.visual.face_colors = [200, 200, 200, 255]
    meshes.append(floor)

    # thin wall slabs with rectangular holes approximated by skipping the
    # opening span (POC: draw solid walls; openings are also in room.json)
    t = 0.05
    slabs = [
        ([w, t, h], [w / 2, 0, h / 2]),
        ([w, t, h], [w / 2, l, h / 2]),
        ([t, l, h], [0, l / 2, h / 2]),
        ([t, l, h], [w, l / 2, h / 2]),
    ]
    for ext, pos in slabs:
        wall = trimesh.creation.box(extents=ext)
        wall.apply_translation(pos)
        wall.visual.face_colors = [170, 175, 180, 120]
        meshes.append(wall)

    trimesh.Scene(meshes).export(str(path))


def write_room(room: RoomModel, out_dir: str | Path) -> Path:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    gltf = out / "room.gltf"
    room.gltf_uri = str(gltf)
    export_room_gltf(room, gltf)
    room_json = out / "room.json"
    # drop the private origin helper before serialising
    room.__dict__.pop("_origin", None)
    room_json.write_text(room.model_dump_json(indent=2))
    return room_json
