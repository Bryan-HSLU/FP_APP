"""Detect doors and windows as empty regions in each wall's 2D coverage grid.

For every wall we build a (horizontal-position x height) occupancy grid from the
points lying on that wall plane (floor/ceiling bands removed so they don't fill
door gaps). For each horizontal bin we find its tallest empty vertical run:
  - a run that reaches the floor and is tall  -> door
  - a run floating in the mid-height band     -> window
Adjacent horizontal bins of the same kind are merged into one opening.
This is an approximate POC detector, not a metrology-grade method.
"""

from __future__ import annotations

import numpy as np

from fp.schemas import Opening, RoomModel

BIN_H = 0.10          # horizontal bin width (m)
BIN_V = 0.10          # vertical bin height (m)
WALL_BAND = 0.15      # max distance from the wall plane to count a point (m)
FLOOR_CEIL_SKIP = 0.10  # ignore points this close to floor/ceiling (m)
MIN_WIDTH = 0.6       # minimum opening width (m)
DOOR_MIN_H = 1.6      # a door's empty run is at least this tall (m)
WINDOW_MIN_H = 0.5    # a window's empty run is at least this tall (m)
FLOOR_TOUCH = 0.25    # an empty run starting below this height "touches" the floor


def _wall_points(p: np.ndarray, wall_id: str, w: float, l: float):
    if wall_id == "wall_south":
        near = np.abs(p[:, 1]) < WALL_BAND
        return p[near][:, 0], w
    if wall_id == "wall_north":
        near = np.abs(p[:, 1] - l) < WALL_BAND
        return p[near][:, 0], w
    if wall_id == "wall_west":
        near = np.abs(p[:, 0]) < WALL_BAND
        return p[near][:, 1], l
    near = np.abs(p[:, 0] - w) < WALL_BAND  # wall_east
    return p[near][:, 1], l


def _tallest_empty_run(occupied_col: np.ndarray, h: float) -> tuple[float, float] | None:
    """Given a boolean per-vbin occupancy column, return (z0,z1) of the tallest gap."""
    best = None
    best_len = 0
    v = 0
    n = len(occupied_col)
    while v < n:
        if not occupied_col[v]:
            start = v
            while v < n and not occupied_col[v]:
                v += 1
            if (v - start) > best_len:
                best_len = v - start
                best = (start * BIN_V, v * BIN_V)
        else:
            v += 1
    return best


def detect_openings(points: np.ndarray, room: RoomModel) -> list[Opening]:
    ox, oy, oz = room.__dict__.get("_origin", (0.0, 0.0, 0.0))
    p = points - np.array([ox, oy, oz])
    w = room.floor_polygon[1][0]
    l = room.floor_polygon[2][1]
    h = room.ceiling_height
    nv = max(1, int(h / BIN_V))
    openings: list[Opening] = []
    idx = 0

    for wall in room.walls:
        # keep only points on the wall plane and away from floor/ceiling
        if wall.id in ("wall_south", "wall_north"):
            near = np.abs(p[:, 1] - (0.0 if wall.id == "wall_south" else l)) < WALL_BAND
            pos = p[near][:, 0]
            axis, fixed, span = "x", (0.0 if wall.id == "wall_south" else l), w
        else:
            near = np.abs(p[:, 0] - (0.0 if wall.id == "wall_west" else w)) < WALL_BAND
            pos = p[near][:, 1]
            axis, fixed, span = "y", (0.0 if wall.id == "wall_west" else w), l
        z = p[near][:, 2]
        band = (z > FLOOR_CEIL_SKIP) & (z < h - FLOOR_CEIL_SKIP)
        pos, z = pos[band], z[band]
        if len(pos) < 50:
            continue

        nh = max(1, int(span / BIN_H))
        # per horizontal bin: tallest empty vertical run
        runs: list[tuple[float, float] | None] = []
        for b in range(nh):
            sel = (pos >= b * BIN_H) & (pos < (b + 1) * BIN_H)
            col = pos[sel]
            colz = z[sel]
            occ = np.zeros(nv, dtype=bool)
            if len(colz):
                vb = np.clip((colz / BIN_V).astype(int), 0, nv - 1)
                occ[vb] = True
            runs.append(_tallest_empty_run(occ, h) if len(col) >= 1 or True else None)

        def classify(run):
            if run is None:
                return None
            z0, z1 = run
            height = z1 - z0
            if z0 <= FLOOR_TOUCH and height >= DOOR_MIN_H:
                return "door"
            if z0 > FLOOR_TOUCH and height >= WINDOW_MIN_H and z1 < h - FLOOR_CEIL_SKIP + 1e-6:
                return "window"
            return None

        kinds = [classify(r) for r in runs]
        b = 0
        while b < nh:
            if kinds[b]:
                kind = kinds[b]
                start = b
                zs = []
                while b < nh and kinds[b] == kind:
                    zs.append(runs[b])
                    b += 1
                width = (b - start) * BIN_H
                if width >= MIN_WIDTH:
                    a0, a1 = start * BIN_H, b * BIN_H
                    z0 = float(np.median([r[0] for r in zs]))
                    z1 = float(np.median([r[1] for r in zs]))
                    openings.append(_make_opening(idx, kind, wall.id, axis, fixed, a0, a1, z0, z1))
                    idx += 1
            else:
                b += 1
    return openings


def _make_opening(idx, kind, wall_id, axis, fixed, a0, a1, z0, z1) -> Opening:
    if kind == "door":
        z0 = 0.0
    if axis == "x":
        poly = [[a0, fixed, z0], [a1, fixed, z0], [a1, fixed, z1], [a0, fixed, z1]]
    else:
        poly = [[fixed, a0, z0], [fixed, a1, z0], [fixed, a1, z1], [fixed, a0, z1]]
    return Opening(id=f"opening_{kind}_{idx}", kind=kind, on_wall=wall_id, polygon=poly)
