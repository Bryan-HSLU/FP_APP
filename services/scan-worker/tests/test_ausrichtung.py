"""z-up-Ausrichtung: gravity-Rotation, Boden auf z=0, RANSAC-Fallback."""

from __future__ import annotations

import numpy as np

from fp_scan_worker.ausrichtung import boden_ransac, richte_zup, rotation_zu_zup


def test_schraege_gravity_dreht_oben_auf_z() -> None:
    gravity = (0.3, -9.0, 0.8)  # «unten» leicht verkippt
    r = rotation_zu_zup(gravity)
    oben = -np.asarray(gravity)
    oben = oben / np.linalg.norm(oben)
    assert np.allclose(r @ oben, [0.0, 0.0, 1.0], atol=1e-9)
    # reine Rotation: orthonormal, det = +1
    assert np.allclose(r @ r.T, np.eye(3), atol=1e-9)
    assert np.isclose(np.linalg.det(r), 1.0)


def test_richte_zup_legt_boden_auf_null() -> None:
    rng = np.random.default_rng(1)
    gravity = (0.3, -9.0, 0.8)
    r = rotation_zu_zup(gravity)
    up = r.T @ np.array([0.0, 0.0, 1.0])  # «oben» in Rohkoordinaten
    e1 = np.cross(up, [1.0, 0.0, 0.0])
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(up, e1)
    # Boden-Punkte (Ebene ⟂ up) + Punkte darüber
    uv = rng.uniform(-1.0, 1.0, size=(200, 2))
    boden = uv[:, :1] * e1 + uv[:, 1:2] * e2
    decke = boden + 2.4 * up
    roh = np.vstack([boden, decke])

    ausgerichtet = richte_zup(roh, gravity)
    n = len(boden)
    assert np.allclose(ausgerichtet[:n, 2], 0.0, atol=1e-6)  # Boden ≈ z = 0
    assert np.allclose(ausgerichtet[n:, 2], 2.4, atol=1e-6)  # Decke ≈ z = 2.4


def test_boden_ransac_findet_bodenebene() -> None:
    rng = np.random.default_rng(7)
    # Boden bei z = 0 (Normale +z, viele Punkte) + Wand bei x = 0 (Normale +x)
    boden = np.column_stack(
        [rng.uniform(0, 3, 400), rng.uniform(0, 3, 400), np.zeros(400)]
    )
    wand = np.column_stack(
        [np.zeros(150), rng.uniform(0, 3, 150), rng.uniform(0, 2.4, 150)]
    )
    wolke = np.vstack([boden, wand])

    r = boden_ransac(wolke, seed=0)
    # Boden-Normale ist bereits +z → Rotation ≈ Identität
    assert np.allclose(r @ np.array([0.0, 0.0, 1.0]), [0.0, 0.0, 1.0], atol=1e-6)
    assert np.allclose(r, np.eye(3), atol=1e-6)


def test_boden_ransac_deterministisch() -> None:
    rng = np.random.default_rng(3)
    wolke = np.vstack(
        [
            np.column_stack([rng.uniform(0, 3, 300), rng.uniform(0, 3, 300), np.zeros(300)]),
            np.column_stack([np.zeros(120), rng.uniform(0, 3, 120), rng.uniform(0, 2, 120)]),
        ]
    )
    a = boden_ransac(wolke, seed=42)
    b = boden_ransac(wolke, seed=42)
    assert np.array_equal(a, b)
