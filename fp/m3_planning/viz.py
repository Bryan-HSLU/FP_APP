"""Render the solved scene: a top-down floor plan PNG and a 3D GLTF.

The PNG is the quick "you can see it works" artifact; no UI required.
"""

from __future__ import annotations

import math

import numpy as np

from fp.schemas import RoomModel, Scene


def _rot_corners(cx: float, cy: float, w: float, d: float, theta: float):
    hw, hd = w / 2, d / 2
    base = np.array([[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]])
    c, s = math.cos(theta), math.sin(theta)
    rot = np.array([[c, -s], [s, c]])
    return (base @ rot.T) + np.array([cx, cy])


def render_layout(room: RoomModel, scene: Scene, path: str) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import Polygon as MplPolygon

    fig, ax = plt.subplots(figsize=(8, 9))

    floor = [(p[0], p[1]) for p in room.floor_polygon]
    ax.add_patch(MplPolygon(floor, closed=True, fill=False, edgecolor="black", lw=2))

    for op in room.openings:
        xs = [p[0] for p in op.polygon]
        ys = [p[1] for p in op.polygon]
        color = "#2e7d32" if op.kind == "door" else "#1565c0"
        ax.plot([min(xs), max(xs)], [min(ys), max(ys)], color=color, lw=6, solid_capstyle="butt")
        ax.annotate(op.kind, ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2),
                    color=color, fontsize=8, ha="center", va="center")

    for fp in room.fixpoints:
        ax.plot(fp.position[0], fp.position[1], marker="x", color="red", ms=8)

    for obj in scene.objects:
        cx, cy = obj.position[0], obj.position[1]
        corners = _rot_corners(cx, cy, obj.dimensions[0], obj.dimensions[1], obj.rotation_z)
        alpha = 0.45 if obj.klass == "accessory" else 0.75
        ax.add_patch(MplPolygon(corners, closed=True, facecolor=obj.color,
                                edgecolor="black", lw=1, alpha=alpha))
        ax.annotate(obj.instance_id, (cx, cy), color="black", fontsize=7,
                    ha="center", va="center")

    ax.set_aspect("equal")
    ax.autoscale_view()
    ax.margins(0.1)
    ax.set_title(f"{scene.room_type} - solver: {scene.solver_status} "
                 f"({len(scene.objects)} Objekte)")
    ax.set_xlabel("x [m]")
    ax.set_ylabel("y [m]")
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)


def export_gltf(room: RoomModel, scene: Scene, path: str) -> None:
    import trimesh

    ox, oy, mx, my = room.floor_bounds()
    w, l = mx - ox, my - oy
    meshes = []

    floor = trimesh.creation.box(extents=[w, l, 0.02])
    floor.apply_translation([ox + w / 2, oy + l / 2, -0.01])
    floor.visual.face_colors = [210, 210, 210, 255]
    meshes.append(floor)

    for obj in scene.objects:
        box = trimesh.creation.box(extents=[obj.dimensions[0], obj.dimensions[1], obj.dimensions[2]])
        T = trimesh.transformations.rotation_matrix(obj.rotation_z, [0, 0, 1])
        box.apply_transform(T)
        box.apply_translation([obj.position[0], obj.position[1], obj.dimensions[2] / 2])
        rgb = obj.color.lstrip("#")
        box.visual.face_colors = [int(rgb[0:2], 16), int(rgb[2:4], 16), int(rgb[4:6], 16), 255]
        meshes.append(box)

    trimesh.Scene(meshes).export(path)
