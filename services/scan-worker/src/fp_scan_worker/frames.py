"""Frame-Auswahl aus einem normalen Handy-Video (ohne AR-Posen, ohne LiDAR).

Die Rekonstruktion (MapAnything) braucht genug **Überlappung** zwischen den
Bildern. Ein fester Schritt («jedes 10. Frame») reicht bei langsamem Filmen,
reisst aber bei einem zügigen Durchgang Lücken: pro Sekunde dreht sich die
Kamera weiter, zwischen zwei Keyframes fehlt dann der gemeinsame Bildinhalt.
Darum wird hier **zeitbasiert** ausgewählt – eine feste Zahl Bilder pro Sekunde
Video, in jedem Zeitfenster das **schärfste** – und verwackelte Frames fallen
weg (Bewegungsunschärfe ist bei schnellem Filmen der zweite Feind).

Reine numpy-Funktionen (CPU-testbar); das Dekodieren des Videos liegt im
Worker (guarded cv2).
"""

from __future__ import annotations

import math

import numpy as np
from numpy.typing import NDArray

__all__ = ["schaerfe", "waehle_frames"]

# Laplace-Kern (4-Nachbarschaft) – Varianz der Antwort = klassisches Schärfemass.
_LAPLACE = np.array([[0.0, 1.0, 0.0], [1.0, -4.0, 1.0], [0.0, 1.0, 0.0]])


def schaerfe(grau: NDArray[np.floating] | NDArray[np.uint8]) -> float:
    """Schärfe eines Graustufenbilds = Varianz des Laplace-Filters.

    Scharfe Bilder haben viele harte Kanten → grosse Laplace-Antworten → grosse
    Varianz; Bewegungsunschärfe glättet die Kanten → kleine Varianz. Der Wert ist
    nur **relativ** innerhalb eines Videos aussagekräftig (hängt von Motiv und
    Auflösung ab) – deshalb vergleicht ``waehle_frames`` gegen den Median.
    """
    g = np.asarray(grau, dtype=np.float64)
    if g.ndim != 2 or g.shape[0] < 3 or g.shape[1] < 3:
        raise ValueError("schaerfe erwartet ein 2D-Graustufenbild ≥ 3×3.")
    # «valid»-Faltung ohne scipy: die 5 Nicht-Null-Einträge des Kerns direkt.
    antwort = g[:-2, 1:-1] + g[2:, 1:-1] + g[1:-1, :-2] + g[1:-1, 2:] - 4.0 * g[1:-1, 1:-1]
    return float(antwort.var())


def waehle_frames(
    zeitstempel: NDArray[np.floating] | list[float],
    schaerfen: NDArray[np.floating] | list[float],
    *,
    ziel_fps: float = 3.0,
    max_frames: int = 120,
    min_frames: int = 12,
    min_schaerfe_rel: float = 0.35,
) -> list[int]:
    """Wählt Keyframe-Indizes: je Zeitfenster das schärfste, unscharfe verworfen.

    Args:
        zeitstempel: Zeit (s) je Kandidaten-Frame, aufsteigend.
        schaerfen: Schärfe je Kandidaten-Frame (``schaerfe``), gleiche Länge.
        ziel_fps: gewünschte Keyframes pro Sekunde Video. **Höher = robuster bei
            zügigem Filmen** (mehr Überlappung), aber mehr GPU-Speicher/Zeit.
        max_frames: Obergrenze (GPU-Speicher der Rekonstruktion). Würde
            ``ziel_fps`` sie überschreiten, werden die Fenster gleichmässig
            breiter – die Abdeckung bleibt über das ganze Video verteilt.
        min_frames: Untergrenze für sehr kurze Videos (dann dichtere Fenster).
        min_schaerfe_rel: Frames unter diesem Anteil der **Median**-Schärfe
            gelten als verwackelt und werden nie gewählt. Hat ein Fenster nur
            verwackelte Frames, bleibt es leer (lieber Lücke als Unschärfe).

    Returns:
        Aufsteigende Indizes in die Kandidatenliste. Deterministisch: gleiche
        Eingabe ⇒ gleiche Auswahl (Gleichstand → früherer Frame).
    """
    t = np.asarray(zeitstempel, dtype=np.float64)
    s = np.asarray(schaerfen, dtype=np.float64)
    if t.shape != s.shape or t.ndim != 1:
        raise ValueError("zeitstempel und schaerfen müssen gleich lange 1D-Folgen sein.")
    if ziel_fps <= 0 or max_frames < 1 or min_frames < 1:
        raise ValueError("ziel_fps > 0, max_frames ≥ 1 und min_frames ≥ 1 erwartet.")
    n = t.shape[0]
    if n == 0:
        return []
    if np.any(np.diff(t) < 0):
        raise ValueError("zeitstempel müssen aufsteigend sein.")

    dauer = float(t[-1] - t[0])
    # Anzahl Fenster: ziel_fps · Dauer, begrenzt auf [min_frames, max_frames]
    # und nie mehr als es Kandidaten gibt.
    anzahl = math.ceil(dauer * ziel_fps) if dauer > 0 else 1
    anzahl = max(min(anzahl, max_frames), min(min_frames, max_frames))
    anzahl = min(anzahl, n)

    schwelle = min_schaerfe_rel * float(np.median(s))
    grenzen = np.linspace(t[0], t[-1], anzahl + 1)
    # Fenster-Zugehörigkeit je Frame; der letzte Frame gehört ins letzte Fenster.
    fenster = np.clip(np.searchsorted(grenzen, t, side="right") - 1, 0, anzahl - 1)

    auswahl: list[int] = []
    for f in range(anzahl):
        kandidaten = np.flatnonzero((fenster == f) & (s >= schwelle))
        if kandidaten.size == 0:
            continue
        # argmax liefert bei Gleichstand den ersten (= früheren) Frame.
        auswahl.append(int(kandidaten[int(np.argmax(s[kandidaten]))]))
    return auswahl
