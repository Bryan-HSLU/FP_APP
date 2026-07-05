"""Kameramodell und Posen: Pixel + Tiefe → Weltpunkte (known-pose Fusion).

Kamera-Achsen-Konvention (fix, gilt im ganzen Worker):
    Kamerakoordinaten = OpenCV-Pinhole – +X rechts, +Y runter, +Z Blickrichtung.
    Pose = ``T_wc`` (Kamera→Welt): ``X_welt = R(q) @ X_kamera + position``.
Der ARKit-Konverter (kommt später serverseitig) muss ``R @ diag(1, -1, -1)``
anwenden, um von der ARKit-Kamera (Y hoch, -Z Blick) in diese Konvention zu
drehen (siehe Docstring in ``fp_engines.scan.poses``).
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

__all__ = ["pose_matrix", "unproject"]


def unproject(
    depth: NDArray[np.float32],
    k: NDArray[np.float64],
    t_wc: NDArray[np.float64],
) -> NDArray[np.float64]:
    """Hebt eine Tiefen-Map über die Pose ``T_wc`` in Weltkoordinaten.

    OpenCV-Pinhole: für jedes Pixel (u, v) mit Tiefe d > 0 gilt
    ``X_kamera = d * K^-1 @ [u, v, 1]`` (d ist die Tiefe entlang der optischen
    Achse +Z), danach ``X_welt = R @ X_kamera + t`` mit ``R = T_wc[:3, :3]`` und
    ``t = T_wc[:3, 3]``. Nur Pixel mit gültiger (positiver) Tiefe fliessen ein.

    Args:
        depth: Tiefen-Map (H, W) in Metern; Werte ≤ 0 gelten als ungültig.
        k: 3x3-Intrinsics (fx, fy, cx, cy).
        t_wc: 4x4-Pose Kamera→Welt.

    Returns:
        (N, 3)-Array der Weltpunkte (float64), N = Anzahl gültiger Pixel.
    """
    hoehe, breite = depth.shape
    us, vs = np.meshgrid(np.arange(breite), np.arange(hoehe))
    d = depth.reshape(-1).astype(np.float64)
    gueltig = d > 0.0
    d = d[gueltig]
    if d.size == 0:
        return np.empty((0, 3), dtype=np.float64)

    pixel = np.stack(
        [us.reshape(-1)[gueltig], vs.reshape(-1)[gueltig], np.ones(d.shape[0])],
        axis=0,
    )  # (3, N)
    strahlen = np.linalg.inv(k) @ pixel  # (3, N), Richtung bei z = 1
    x_kamera = strahlen * d  # spaltenweise mit der Tiefe skaliert → (3, N)

    r = t_wc[:3, :3]
    t = t_wc[:3, 3]
    x_welt = r @ x_kamera + t[:, None]  # (3, N)
    return np.ascontiguousarray(x_welt.T, dtype=np.float64)


def pose_matrix(
    position: tuple[float, float, float],
    quaternion: tuple[float, float, float, float],
) -> NDArray[np.float64]:
    """Baut die 4x4-Pose ``T_wc`` (Kamera→Welt) aus Position + Quaternion (xyzw).

    Rotationsmatrix aus dem Einheits-Quaternion (x, y, z, w)::

        R = [[1-2(y²+z²),  2(xy-zw),    2(xz+yw)  ],
             [2(xy+zw),    1-2(x²+z²),  2(yz-xw)  ],
             [2(xz-yw),    2(yz+xw),    1-2(x²+y²)]]

    Die Translation steht in der letzten Spalte; die untere Zeile ist [0,0,0,1].
    """
    x, y, z, w = quaternion
    r = np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ],
        dtype=np.float64,
    )
    m = np.eye(4, dtype=np.float64)
    m[:3, :3] = r
    m[:3, 3] = position
    return m
