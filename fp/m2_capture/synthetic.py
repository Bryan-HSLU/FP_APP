"""Generate a synthetic dense room point cloud (with door + window gaps).

Lets the M2 reconstruction->room-model->M3 chain run end-to-end without native
COLMAP/OpenMVS or a recorded video, so the algorithm is demonstrable offline.
The real pipeline (frames -> COLMAP -> OpenMVS) produces an equivalent cloud.
"""

from __future__ import annotations

import numpy as np


def generate_room_cloud(
    w: float = 4.0,
    l: float = 5.0,
    h: float = 2.6,
    *,
    density: int = 12000,
    door=(0.5, 1.4),       # span on the south wall (y=0), full height from floor
    window=(1.5, 3.0),     # span on the north wall (y=l), mid-height band
    window_z=(0.9, 2.0),
    noise: float = 0.01,
    seed: int = 0,
) -> np.ndarray:
    rng = np.random.default_rng(seed)
    pts: list[np.ndarray] = []

    def sample(n, xr, yr, zr):
        return np.column_stack([
            rng.uniform(*xr, n), rng.uniform(*yr, n), rng.uniform(*zr, n)
        ])

    pts.append(sample(density, (0, w), (0, l), (0, 0)))      # floor
    pts.append(sample(density // 2, (0, w), (0, l), (h, h)))  # ceiling

    # south wall (y=0) with a door gap
    n = density
    s = sample(n, (0, w), (0, 0), (0, h))
    keep = ~((s[:, 0] >= door[0]) & (s[:, 0] <= door[1]))
    pts.append(s[keep])

    # north wall (y=l) with a window gap (only mid-height band removed)
    nrt = sample(n, (0, w), (l, l), (0, h))
    win = (nrt[:, 0] >= window[0]) & (nrt[:, 0] <= window[1]) & \
          (nrt[:, 2] >= window_z[0]) & (nrt[:, 2] <= window_z[1])
    pts.append(nrt[~win])

    pts.append(sample(n, (0, 0), (0, l), (0, h)))   # west wall
    pts.append(sample(n, (w, w), (0, l), (0, h)))   # east wall

    cloud = np.vstack(pts)
    cloud += rng.normal(0, noise, cloud.shape)
    return cloud
