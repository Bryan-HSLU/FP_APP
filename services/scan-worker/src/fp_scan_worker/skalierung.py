"""Metrik-Fallback: Skalierung aus der Raumhöhe.

NUR Fallback: Die AR-Posen sind bereits metrisch (VIO), die Punktwolke ist damit
normalerweise 1:1 in Metern und der Faktor ≈ 1.0 (Brain: Scan-Laufzeit-Budget).
Erst wenn die Posen ausnahmsweise ohne Massstab kommen (reines SfM), schätzt
diese Funktion den Faktor über eine angenommene Wand-/Raumhöhe.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

__all__ = ["skala_aus_wandhoehe"]


def skala_aus_wandhoehe(punkte_zup: NDArray[np.float64], ziel_hoehe: float = 2.5) -> float:
    """Faktor, der die z-Spanne der Wolke auf ``ziel_hoehe`` (Meter) streckt.

    Die z-Spanne wird robust über das 2.–98. Perzentil bestimmt (Ausreisser an
    Boden/Decke stören nicht). Faktor = ``ziel_hoehe / spanne``.
    """
    z = np.asarray(punkte_zup, dtype=np.float64)[:, 2]
    unten, oben = np.percentile(z, [2.0, 98.0])
    spanne = float(oben - unten)
    if spanne <= 0.0:
        raise ValueError("z-Spanne ist null – keine Skala aus der Höhe bestimmbar.")
    return ziel_hoehe / spanne
