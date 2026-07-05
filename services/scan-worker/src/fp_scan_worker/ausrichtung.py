"""z-up-Ausrichtung der Punktwolke – SpatialLM erwartet z-up, metrisch.

Vorrang hat die **Schwerkraft aus den AR-Posen** (``gravity``): sie liefert die
«oben»-Richtung direkt, ohne Raten. Fehlt sie, greift die Fallback-Kaskade aus
dem Brain (Raumerfassung-Detailkonzept, Stufe 3): Boden per RANSAC-Ebene finden
und deren Normale auf +z drehen.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

__all__ = ["boden_ransac", "richte_zup", "rotation_zu_zup"]


def _rotation_auf_z(a: NDArray[np.float64]) -> NDArray[np.float64]:
    """3x3-Rotation, die den (nicht-null) Vektor ``a`` auf +z dreht (Rodrigues).

    Sonderfälle: ``a`` schon parallel zu +z → Identität; antiparallel → 180°-Kippe
    um die x-Achse (``diag(1, -1, -1)``).
    """
    norm = float(np.linalg.norm(a))
    if norm == 0.0:
        raise ValueError("Nullvektor lässt sich nicht auf +z drehen.")
    a = a / norm
    z = np.array([0.0, 0.0, 1.0])
    v = np.cross(a, z)
    c = float(np.dot(a, z))
    s = float(np.linalg.norm(v))
    if s < 1e-12:
        if c > 0.0:
            return np.eye(3, dtype=np.float64)
        return np.diag([1.0, -1.0, -1.0]).astype(np.float64)
    vx = np.array(
        [
            [0.0, -v[2], v[1]],
            [v[2], 0.0, -v[0]],
            [-v[1], v[0], 0.0],
        ],
        dtype=np.float64,
    )
    return np.eye(3, dtype=np.float64) + vx + vx @ vx * ((1.0 - c) / (s * s))


def rotation_zu_zup(gravity: tuple[float, float, float]) -> NDArray[np.float64]:
    """3x3-Rotation, die «oben» (= −gravity) exakt auf +z legt."""
    oben = -np.asarray(gravity, dtype=np.float64)
    if float(np.linalg.norm(oben)) == 0.0:
        raise ValueError("gravity ist der Nullvektor – keine «oben»-Richtung bestimmbar.")
    return _rotation_auf_z(oben)


def richte_zup(
    punkte: NDArray[np.float64],
    gravity: tuple[float, float, float],
) -> NDArray[np.float64]:
    """Dreht die Wolke nach z-up und verschiebt sie, sodass der Boden ≈ z = 0 liegt.

    Der Boden wird über das **2. z-Perzentil** geschätzt (robust gegen einzelne
    Ausreisser unter dem Boden) und auf 0 verschoben.
    """
    r = rotation_zu_zup(gravity)
    rotiert = np.asarray(punkte, dtype=np.float64) @ r.T
    if rotiert.shape[0] == 0:
        return rotiert
    boden_z = float(np.percentile(rotiert[:, 2], 2.0))
    rotiert = rotiert.copy()
    rotiert[:, 2] -= boden_z
    return rotiert


def boden_ransac(
    punkte: NDArray[np.float64],
    iterationen: int = 200,
    schwelle: float = 0.03,
    seed: int = 0,
) -> NDArray[np.float64]:
    """Fallback ohne Schwerkraft: Boden-Ebene per RANSAC, Rotation ihrer Normale → +z.

    v0 der Fallback-Kaskade aus dem Brain (Raumerfassung-Detailkonzept, Stufe 3),
    wenn keine brauchbare ``gravity`` vorliegt. Es werden 3-Punkt-Stichproben
    gezogen (``np.random.default_rng(seed)`` → **deterministisch**); gewertet
    werden nur **~horizontale** Ebenen (|n_z| ≥ 0.7, sonst ist es eher eine Wand).
    Gewinner ist die Ebene mit den meisten Inliern; bei Gleichstand die tiefer
    liegende (der Boden, nicht die Decke). Rückgabe = Rotation, die die (nach oben
    orientierte) Ebenen-Normale auf +z dreht.
    """
    p = np.asarray(punkte, dtype=np.float64)
    n = p.shape[0]
    if n < 3:
        raise ValueError("Für eine RANSAC-Ebene sind mindestens 3 Punkte nötig.")
    rng = np.random.default_rng(seed)

    beste_normale: NDArray[np.float64] | None = None
    beste_inlier = -1
    beste_hoehe = np.inf
    for _ in range(iterationen):
        idx = rng.choice(n, size=3, replace=False)
        p0, p1, p2 = p[idx[0]], p[idx[1]], p[idx[2]]
        normale = np.cross(p1 - p0, p2 - p0)
        laenge = float(np.linalg.norm(normale))
        if laenge < 1e-9:
            continue  # kollineare Stichprobe → keine Ebene
        normale = normale / laenge
        if abs(float(normale[2])) < 0.7:
            continue  # nicht ~horizontal → kein Bodenkandidat
        if normale[2] < 0.0:
            normale = -normale  # Normale nach oben orientieren

        abstand = np.abs((p - p0) @ normale)
        maske = abstand < schwelle
        inlier = int(np.count_nonzero(maske))
        hoehe = float(np.mean(p[maske] @ normale))
        if inlier > beste_inlier or (inlier == beste_inlier and hoehe < beste_hoehe):
            beste_inlier = inlier
            beste_normale = normale
            beste_hoehe = hoehe

    if beste_normale is None:
        raise ValueError("Keine ~horizontale Ebene gefunden – Boden-Fallback gescheitert.")
    return _rotation_auf_z(beste_normale)
