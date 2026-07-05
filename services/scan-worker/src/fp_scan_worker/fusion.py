"""Punktwolken-Fusion: viele Keyframe-Wolken → eine, per Voxel-Downsampling.

Ohne Downsampling wächst die Punktzahl linear mit den Keyframes und sprengt
SpatialLM/Speicher (Brain: Scan-Laufzeit-Budget). Voxel-Downsampling ist der
einfache, deterministische Hebel: pro belegtem Voxel bleibt genau ein Zentroid.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

__all__ = ["fuse"]


def fuse(punktwolken: list[NDArray[np.float64]], voxel: float = 0.02) -> NDArray[np.float64]:
    """Konkateniert Wolken und dünnt sie per Voxel-Downsampling aus.

    Jeder Punkt fällt über ``floor(p / voxel)`` in eine Voxel-Zelle; pro Zelle
    wird der Zentroid der enthaltenen Punkte zurückgegeben. Die Ausgabe ist nach
    Voxel-Index sortiert und damit **deterministisch** (gleiche Eingabe ⇒ gleiche
    Ausgabe, unabhängig von der Punktreihenfolge innerhalb einer Zelle).

    Args:
        punktwolken: Liste von (N_i, 3)-Arrays.
        voxel: Kantenlänge der Voxelzelle in Metern (Default 2 cm).

    Returns:
        (M, 3)-Array der Voxel-Zentroide (float64).
    """
    if not punktwolken:
        return np.empty((0, 3), dtype=np.float64)
    punkte = np.concatenate(punktwolken, axis=0).astype(np.float64)
    if punkte.shape[0] == 0:
        return np.empty((0, 3), dtype=np.float64)

    index = np.floor(punkte / voxel).astype(np.int64)
    _, inverse = np.unique(index, axis=0, return_inverse=True)
    inverse = inverse.reshape(-1)

    anzahl_voxel = int(inverse.max()) + 1
    summe = np.zeros((anzahl_voxel, 3), dtype=np.float64)
    np.add.at(summe, inverse, punkte)
    zaehler = np.bincount(inverse, minlength=anzahl_voxel).astype(np.float64)
    return summe / zaehler[:, None]
