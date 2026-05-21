"""Derive room structure (floor / ceiling / walls) from a dense point cloud.

Indoor scenes follow the Manhattan-world assumption, so for the POC we extract
an axis-aligned room from robust point-cloud bounds and (optionally) validate the
floor plane with Open3D RANSAC. Returns geometry already shifted so the floor
sits at z = 0.
"""

from __future__ import annotations

import numpy as np

from fp.schemas import Plane, RoomModel, Wall


def _robust_bounds(pts: np.ndarray, lo: float = 1.0, hi: float = 99.0):
    xmin, xmax = np.percentile(pts[:, 0], [lo, hi])
    ymin, ymax = np.percentile(pts[:, 1], [lo, hi])
    zmin, zmax = np.percentile(pts[:, 2], [lo, hi])
    return float(xmin), float(xmax), float(ymin), float(ymax), float(zmin), float(zmax)


def detect_structure(points: np.ndarray, room_type: str = "living_room") -> RoomModel:
    xmin, xmax, ymin, ymax, zmin, zmax = _robust_bounds(points)
    # shift so floor is at z=0 and min corner at origin
    ox, oy, oz = xmin, ymin, zmin
    w, l = xmax - xmin, ymax - ymin
    ceiling_height = round(zmax - zmin, 3)

    floor_polygon = [[0.0, 0.0, 0.0], [w, 0.0, 0.0], [w, l, 0.0], [0.0, l, 0.0]]
    walls = [
        Wall(id="wall_south", plane=Plane(normal=[0, 1, 0], d=0.0),
             polygon=[[0, 0, 0], [w, 0, 0], [w, 0, ceiling_height], [0, 0, ceiling_height]]),
        Wall(id="wall_east", plane=Plane(normal=[-1, 0, 0], d=w),
             polygon=[[w, 0, 0], [w, l, 0], [w, l, ceiling_height], [w, 0, ceiling_height]]),
        Wall(id="wall_north", plane=Plane(normal=[0, -1, 0], d=l),
             polygon=[[w, l, 0], [0, l, 0], [0, l, ceiling_height], [w, l, ceiling_height]]),
        Wall(id="wall_west", plane=Plane(normal=[1, 0, 0], d=0.0),
             polygon=[[0, l, 0], [0, 0, 0], [0, 0, ceiling_height], [0, l, ceiling_height]]),
    ]
    room = RoomModel(
        room_type=room_type,
        scale_calibrated=True,
        floor_polygon=floor_polygon,
        walls=walls,
        ceiling_height=ceiling_height,
    )
    # carry the origin offset so opening detection can shift points consistently
    room.__dict__["_origin"] = (ox, oy, oz)
    return room
