"""Kameramodell: unproject-Ebene und Quaternion-Rotation."""

from __future__ import annotations

import numpy as np

from fp_scan_worker.kamera import pose_matrix, unproject


def _intrinsics(breite: int, hoehe: int, f: float) -> np.ndarray:
    return np.array(
        [[f, 0.0, breite / 2.0], [0.0, f, hoehe / 2.0], [0.0, 0.0, 1.0]],
        dtype=np.float64,
    )


def test_unproject_frontoparallele_ebene() -> None:
    """Konstante Tiefe + Identitäts-Pose → alle Punkte liegen exakt auf z = d."""
    breite, hoehe = 8, 6
    d = 2.5
    depth = np.full((hoehe, breite), d, dtype=np.float32)
    k = _intrinsics(breite, hoehe, f=100.0)
    t_wc = np.eye(4, dtype=np.float64)

    punkte = unproject(depth, k, t_wc)

    assert punkte.shape == (breite * hoehe, 3)
    # optische Achse = +Z → Tiefe landet exakt als z-Komponente
    assert np.allclose(punkte[:, 2], d)
    # Bildmitte (cx, cy) projiziert auf x = y = 0
    mitte = punkte[np.isclose(punkte[:, 0], 0.0) & np.isclose(punkte[:, 1], 0.0)]
    assert len(mitte) >= 1


def test_unproject_verwirft_nicht_positive_tiefe() -> None:
    depth = np.array([[1.0, 0.0], [-3.0, 2.0]], dtype=np.float32)
    k = _intrinsics(2, 2, f=50.0)
    punkte = unproject(depth, k, np.eye(4))
    assert punkte.shape == (2, 3)  # nur die beiden positiven Tiefen


def test_pose_matrix_90_grad_um_z() -> None:
    """90°-Drehung um z (Quaternion xyzw) dreht (1,0,0) → (0,1,0)."""
    q = (0.0, 0.0, np.sin(np.pi / 4), np.cos(np.pi / 4))
    m = pose_matrix((0.0, 0.0, 0.0), q)
    gedreht = m[:3, :3] @ np.array([1.0, 0.0, 0.0])
    assert np.allclose(gedreht, [0.0, 1.0, 0.0], atol=1e-9)


def test_pose_matrix_translation() -> None:
    m = pose_matrix((1.0, -2.0, 3.0), (0.0, 0.0, 0.0, 1.0))
    assert np.allclose(m[:3, 3], [1.0, -2.0, 3.0])
    assert np.allclose(m[:3, :3], np.eye(3))
    assert np.allclose(m[3], [0.0, 0.0, 0.0, 1.0])
