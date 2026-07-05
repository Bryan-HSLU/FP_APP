"""Skalierungs-Fallback aus der Raumhöhe (robust gegen Ausreisser)."""

from __future__ import annotations

import numpy as np

from fp_scan_worker.skalierung import skala_aus_wandhoehe


def test_faktor_aus_z_spanne() -> None:
    # 2.–98. Perzentil spannen 0 … 1.25 → Faktor 2.5 / 1.25 = 2.0
    z = np.concatenate([np.zeros(50), np.full(50, 1.25)])
    punkte = np.column_stack([np.zeros_like(z), np.zeros_like(z), z])
    assert np.isclose(skala_aus_wandhoehe(punkte, ziel_hoehe=2.5), 2.0)


def test_ausreisser_stoeren_perzentile_nicht() -> None:
    z = np.concatenate([np.zeros(50), np.full(50, 1.25), [100.0, -100.0]])
    punkte = np.column_stack([np.zeros_like(z), np.zeros_like(z), z])
    # Ausreisser bei ±100 liegen ausserhalb 2./98. Perzentil → Faktor bleibt ~2.0
    assert np.isclose(skala_aus_wandhoehe(punkte, ziel_hoehe=2.5), 2.0, atol=1e-6)


def test_eigene_zielhoehe() -> None:
    z = np.linspace(0.0, 2.0, 1000)
    punkte = np.column_stack([np.zeros_like(z), np.zeros_like(z), z])
    faktor = skala_aus_wandhoehe(punkte, ziel_hoehe=4.0)
    # z-Spanne (2./98. Perzentil) ≈ 1.92 → Faktor ≈ 4.0 / 1.92
    assert faktor > 2.0
