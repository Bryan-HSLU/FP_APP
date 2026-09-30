"""Ausrichtung einer posenfreien Rekonstruktion (MapAnything-Weg, ADR-0016).

Synthetischer Raum 4 × 3 m, Höhe 2.5 m, mit Möbelblock; Kameras auf 1.4 m, die
sich einmal im Raum drehen. Alles wird in ein beliebig gedrehtes/verschobenes
Weltsystem transformiert (so liefert MapAnything: Welt = erste Kamera) – die
Ausrichtung muss den Raum wieder aufrecht mit Boden auf z = 0 hinstellen.
"""

from __future__ import annotations

import numpy as np
import pytest

from fp_scan_worker.fusion import fuse, fuse_mit_farben
from fp_scan_worker.rekonstruktion import (
    oben_aus_kameras,
    punkte_aus_vorhersagen,
    richte_rekonstruktion_aus,
)

HOEHE = 2.5


def _raum(rng: np.random.Generator) -> np.ndarray:
    """Punkte eines z-up-Raums (Boden z=0) inkl. Möbelblock unter Augenhöhe."""
    n = 3000
    boden = np.column_stack([rng.uniform(0, 4, n), rng.uniform(0, 3, n), np.zeros(n)])
    decke = np.column_stack(
        [rng.uniform(0, 4, n // 3), rng.uniform(0, 3, n // 3), np.full(n // 3, HOEHE)]
    )
    waende = []
    for _ in range(4):
        z = rng.uniform(0, HOEHE, n // 2)
        u = rng.uniform(0, 1, n // 2)
        waende += [
            np.column_stack([u * 4, np.zeros_like(u), z]),
            np.column_stack([u * 4, np.full_like(u, 3.0), z]),
            np.column_stack([np.zeros_like(u), u * 3, z]),
            np.column_stack([np.full_like(u, 4.0), u * 3, z]),
        ]
    moebel = np.column_stack([rng.uniform(1, 2.5, n), rng.uniform(1, 2, n), rng.uniform(0, 0.8, n)])
    return np.vstack([boden, decke, *waende, moebel])


def _kameras(
    anzahl: int = 36, hochformat_gedreht: bool = False, neigung_grad: float = 8.0
) -> np.ndarray:
    """cam2world (OpenCV) auf 1.4 m, Blick rundum, leicht nach unten geneigt."""
    posen = []
    for i in range(anzahl):
        th = 2 * np.pi * i / anzahl
        neig = np.radians(neigung_grad)
        z_ax = np.array([np.cos(th) * np.cos(neig), np.sin(th) * np.cos(neig), -np.sin(neig)])
        unten = np.array([0.0, 0.0, -1.0])
        y_ax = unten - (unten @ z_ax) * z_ax
        y_ax /= np.linalg.norm(y_ax)
        x_ax = np.cross(y_ax, z_ax)
        if hochformat_gedreht:  # Bild um 90° gedreht gespeichert: Bild-rechts = oben
            x_ax, y_ax = -y_ax, x_ax
        t = np.eye(4)
        t[:3, 0], t[:3, 1], t[:3, 2] = x_ax, y_ax, z_ax
        t[:3, 3] = [2.0 + 0.3 * np.cos(th), 1.5 + 0.3 * np.sin(th), 1.4]
        posen.append(t)
    return np.array(posen)


def _beliebige_welt() -> np.ndarray:
    """Starre Transformation ins «Erste-Kamera»-System (Rotation + Versatz)."""
    rng = np.random.default_rng(42)
    q, _ = np.linalg.qr(rng.normal(size=(3, 3)))
    if np.linalg.det(q) < 0:
        q[:, 0] *= -1
    w = np.eye(4)
    w[:3, :3] = q
    w[:3, 3] = [0.7, -1.3, 2.2]
    return w


def _transformiere(punkte: np.ndarray, posen: np.ndarray, w: np.ndarray):
    p = punkte @ w[:3, :3].T + w[:3, 3]
    return p, np.array([w @ t for t in posen])


@pytest.mark.parametrize("gedreht", [False, True])
def test_raum_steht_wieder_aufrecht(gedreht: bool) -> None:
    rng = np.random.default_rng(0)
    punkte, posen = _transformiere(
        _raum(rng), _kameras(hochformat_gedreht=gedreht), _beliebige_welt()
    )
    a = richte_rekonstruktion_aus(punkte, posen)
    assert a.oben_achse == ("-Y" if not gedreht else a.oben_achse)
    assert abs(a.raumhoehe - HOEHE) < 0.03
    assert abs(a.kamerahoehe_median - 1.4) < 0.03
    # Boden ≈ 0, Wände senkrecht: Bodenpunkte (erste 3000) alle bei z ≈ 0
    assert np.allclose(a.punkte[:3000, 2], 0.0, atol=0.02)
    assert np.isclose(np.linalg.det(a.rotation), 1.0)


def test_verrauschte_kameras_werden_per_ransac_nachjustiert() -> None:
    rng = np.random.default_rng(1)
    roh = _kameras()
    # Handy systematisch 4° gekippt gehalten → grobe Schätzung liegt 4° daneben
    k = np.radians(4.0)
    kipp = np.array([[1, 0, 0], [0, np.cos(k), -np.sin(k)], [0, np.sin(k), np.cos(k)]])
    for t in roh:
        t[:3, :3] = kipp @ t[:3, :3]
    punkte, posen = _transformiere(_raum(rng), roh, _beliebige_welt())
    a = richte_rekonstruktion_aus(punkte, posen)
    assert 2.0 < a.korrektur_grad < 6.0
    assert np.allclose(a.punkte[:3000, 2], 0.0, atol=0.03)


def test_keine_konsistente_hochachse_meldet_fehler() -> None:
    rng = np.random.default_rng(2)
    posen = []
    for _ in range(30):  # völlig zufällige Orientierungen
        q, _ = np.linalg.qr(rng.normal(size=(3, 3)))
        t = np.eye(4)
        t[:3, :3] = q
        posen.append(t)
    with pytest.raises(ValueError, match="Hochachse"):
        oben_aus_kameras(np.array(posen), rng.normal(size=(100, 3)))


def test_punkte_aus_vorhersagen_maske_schritt_und_farben() -> None:
    p = np.arange(4 * 4 * 3, dtype=np.float64).reshape(4, 4, 3)
    m = np.ones((4, 4), dtype=bool)
    m[0, 0] = False
    p[2, 2] = np.nan  # ungültig trotz Maske
    b = np.full((4, 4, 3), 0.5)  # img_no_norm-Stil 0..1
    punkte, farben = punkte_aus_vorhersagen([p], [m], [b], pixel_schritt=2)
    # Schritt 2 → Pixel (0,0),(0,2),(2,0),(2,2); (0,0) maskiert, (2,2) NaN
    assert punkte.shape == (2, 3)
    assert np.all(farben == 128)


def test_fuse_mit_farben_passt_zu_fuse() -> None:
    rng = np.random.default_rng(3)
    p = rng.uniform(0, 1, size=(500, 3))
    f = rng.integers(0, 256, size=(500, 3)).astype(np.uint8)
    punkte, farben = fuse_mit_farben(p, f, voxel=0.1)
    assert np.allclose(punkte, fuse([p], voxel=0.1))
    assert farben.shape == punkte.shape and farben.dtype == np.uint8
