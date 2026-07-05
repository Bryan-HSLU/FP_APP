"""PLY-I/O für den SpatialLM-Input-Contract.

SpatialLM erwartet eine ``.ply`` mit XYZ + RGB, **z-up, metrisch** (1 = 1 m).
Geschrieben wird ``binary_little_endian 1.0`` mit x/y/z als float32 und
red/green/blue als uchar. ``lies_ply`` deckt genau dieses Format ab – es ist für
Roundtrip-Tests des *eigenen* Formats gedacht, kein allgemeiner PLY-Parser.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from numpy.typing import NDArray

__all__ = ["lies_ply", "schreibe_ply"]

_VERTEX_DTYPE = np.dtype(
    [
        ("x", "<f4"),
        ("y", "<f4"),
        ("z", "<f4"),
        ("red", "u1"),
        ("green", "u1"),
        ("blue", "u1"),
    ]
)

_GRAU = np.array([128, 128, 128], dtype=np.uint8)


def schreibe_ply(
    pfad: str | Path,
    punkte: NDArray[np.float64],
    farben: NDArray[np.uint8] | None = None,
) -> None:
    """Schreibt die Punktwolke als binäres PLY (SpatialLM-Contract).

    Args:
        pfad: Zielpfad der ``.ply``.
        punkte: (N, 3)-Koordinaten (werden auf float32 gecastet).
        farben: (N, 3)-RGB (uint8); ohne Angabe wird alles neutralgrau
            (128, 128, 128).
    """
    xyz = np.asarray(punkte, dtype=np.float32).reshape(-1, 3)
    n = xyz.shape[0]
    if farben is None:
        rgb = np.tile(_GRAU, (n, 1))
    else:
        rgb = np.asarray(farben, dtype=np.uint8).reshape(-1, 3)
        if rgb.shape[0] != n:
            raise ValueError(f"farben ({rgb.shape[0]}) passen nicht zu punkte ({n}).")

    daten = np.empty(n, dtype=_VERTEX_DTYPE)
    daten["x"], daten["y"], daten["z"] = xyz[:, 0], xyz[:, 1], xyz[:, 2]
    daten["red"], daten["green"], daten["blue"] = rgb[:, 0], rgb[:, 1], rgb[:, 2]

    header = (
        "ply\n"
        "format binary_little_endian 1.0\n"
        f"element vertex {n}\n"
        "property float x\n"
        "property float y\n"
        "property float z\n"
        "property uchar red\n"
        "property uchar green\n"
        "property uchar blue\n"
        "end_header\n"
    )
    with open(pfad, "wb") as fh:
        fh.write(header.encode("ascii"))
        fh.write(daten.tobytes())


def lies_ply(pfad: str | Path) -> tuple[NDArray[np.float32], NDArray[np.uint8]]:
    """Liest eine mit ``schreibe_ply`` erzeugte PLY zurück (Roundtrip-Test).

    Returns:
        (punkte float32 (N, 3), farben uint8 (N, 3)).
    """
    with open(pfad, "rb") as fh:
        anzahl = -1
        while True:
            zeile = fh.readline()
            if not zeile:
                raise ValueError("Unerwartetes Dateiende vor end_header.")
            text = zeile.strip()
            if text.startswith(b"element vertex"):
                anzahl = int(text.split()[-1])
            if text == b"end_header":
                break
        if anzahl < 0:
            raise ValueError("Kein 'element vertex' im Header.")
        daten = np.frombuffer(fh.read(anzahl * _VERTEX_DTYPE.itemsize), dtype=_VERTEX_DTYPE)

    punkte = np.stack([daten["x"], daten["y"], daten["z"]], axis=1).astype(np.float32)
    farben = np.stack([daten["red"], daten["green"], daten["blue"]], axis=1).astype(np.uint8)
    return punkte, farben
