"""Fusion: Voxel-Downsampling dedupliziert und ist deterministisch."""

from __future__ import annotations

import numpy as np

from fp_scan_worker.fusion import fuse


def _wolke() -> np.ndarray:
    # Punkte in klar getrennten Voxeln (Abstand >> voxel=0.02)
    return np.array(
        [
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [1.0, 1.0, 1.0],
        ],
        dtype=np.float64,
    )


def test_doppelte_wolke_wird_dedupliziert() -> None:
    wolke = _wolke()
    fusioniert = fuse([wolke, wolke], voxel=0.02)
    assert fusioniert.shape == (4, 3)
    # Zentroid je Voxel = Originalpunkt (beide Kopien identisch)
    erwartet = {tuple(p) for p in wolke}
    assert {tuple(np.round(p, 6)) for p in fusioniert} == erwartet


def test_nahe_punkte_fallen_in_ein_voxel() -> None:
    p = np.array([[0.0, 0.0, 0.0], [0.005, 0.005, 0.0]], dtype=np.float64)
    fusioniert = fuse([p], voxel=0.02)
    assert fusioniert.shape == (1, 3)
    assert np.allclose(fusioniert[0], [0.0025, 0.0025, 0.0])


def test_deterministisch() -> None:
    wolke = _wolke()
    a = fuse([wolke, wolke * 1.0], voxel=0.05)
    b = fuse([wolke, wolke * 1.0], voxel=0.05)
    assert np.array_equal(a, b)


def test_leere_eingabe() -> None:
    assert fuse([]).shape == (0, 3)
    assert fuse([np.empty((0, 3))]).shape == (0, 3)
