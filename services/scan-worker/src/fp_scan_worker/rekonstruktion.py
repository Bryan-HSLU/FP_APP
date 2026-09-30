"""Nachbearbeitung der MapAnything-Rekonstruktion: Punkte → z-up, metrisch.

Weg ohne AR-App (Brain: ADR-0016): MapAnything liefert aus einem normalen Video
je Keyframe Weltpunkte, Kamera-Posen (OpenCV-Konvention +X rechts, +Y runter,
+Z Blick, cam2world) und Intrinsics – **metrisch**, aber in einem beliebig
gedrehten Weltsystem (dem der ersten Kamera). Es fehlt die Schwerkraft, die
bisher aus den AR-Posen kam. Sie wird hier aus den Kameras selbst geschätzt:

Wer einen Raum filmt, hält das Handy grob **aufrecht** und dreht sich im Raum.
Die Bild-«oben»-Richtung jeder Kamera (−Y) zeigt darum bei allen Frames
ungefähr nach oben, während Blick- und Seitenrichtung mit der Drehung umlaufen
und sich im Mittel aufheben. Der Mittelwert von −Y über alle Kameras ist also
eine robuste «oben»-Schätzung; eine RANSAC-Bodenebene verfeinert sie danach.

Reine numpy-Funktionen (CPU-testbar); das Modell selbst läuft im Worker (Colab).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from fp_scan_worker.ausrichtung import boden_ransac, rotation_zu_zup

__all__ = [
    "Ausrichtung",
    "oben_aus_kameras",
    "punkte_aus_vorhersagen",
    "richte_rekonstruktion_aus",
]

# Konsistenz der Bild-oben-Achse über alle Kameras (Länge des Mittelvektors):
# 1 = alle exakt gleich, ~0 = rundum verteilt. Aufrecht gefilmt liegt sie > 0.9;
# unter dieser Schwelle ist die Achse nicht die Hochachse (z. B. gedrehtes Video).
_MIN_KONSISTENZ = 0.6
# Die RANSAC-Verfeinerung darf die Kamera-Schätzung nur nachjustieren. Mehr als
# ~10° Korrektur heisst: sie hat eine schräge Fläche (Dachschräge, Tisch) erwischt.
_MAX_KORREKTUR_GRAD = 10.0
_RANSAC_STICHPROBE = 20_000
# Unteres Höhenband für die Bodensuche (nach der Grob-Ausrichtung, ≤ ~10° Rest-
# Neigung): die untersten 20 % der Punkte sind fast nur Boden.
_BODEN_BAND_PERZENTIL = 20.0


@dataclass(frozen=True)
class Ausrichtung:
    """Ergebnis + Diagnose der Ausrichtung (landet im Worker-Statustext)."""

    punkte: NDArray[np.float64]
    rotation: NDArray[np.float64]
    boden_versatz: float
    oben_achse: str
    konsistenz: float
    korrektur_grad: float
    raumhoehe: float
    kamerahoehe_median: float


def oben_aus_kameras(
    posen_c2w: NDArray[np.float64],
    punkte: NDArray[np.float64] | None = None,
) -> tuple[NDArray[np.float64], str, float]:
    """Schätzt die Hochachse (Einheitsvektor, Weltsystem) aus den Kamera-Posen.

    Normalfall: −Y der Kameras (Bild-oben). Ist das Video gedreht gespeichert
    (Hochformat ohne ausgewertete Orientierung), ist stattdessen die X-Achse die
    konsistente – gewählt wird die Achse mit dem **konsistentesten** Mittelwert.
    Bei der X-Achse ist das Vorzeichen nicht aus dem Bild ableitbar; dann gilt
    «die Kameras sind über der Mehrheit der Punkte» (Möbel, Boden, untere Wände
    liegen unter Augenhöhe) – dafür braucht es ``punkte``.

    Returns:
        (oben, achse, konsistenz) – achse ∈ {"-Y", "+X", "-X"} zur Diagnose.
    """
    posen = np.asarray(posen_c2w, dtype=np.float64)
    if posen.ndim != 3 or posen.shape[1:] != (4, 4) or posen.shape[0] == 0:
        raise ValueError("posen_c2w muss die Form (N, 4, 4) haben, N ≥ 1.")
    mittel_y = -posen[:, :3, 1].mean(axis=0)
    mittel_x = posen[:, :3, 0].mean(axis=0)
    kons_y = float(np.linalg.norm(mittel_y))
    kons_x = float(np.linalg.norm(mittel_x))

    if kons_y >= _MIN_KONSISTENZ and kons_y >= kons_x:
        return mittel_y / kons_y, "-Y", kons_y
    if kons_x < _MIN_KONSISTENZ:
        raise ValueError(
            "Keine konsistente Hochachse in den Kamera-Posen (Handy nicht aufrecht "
            f"gehalten? Konsistenz −Y {kons_y:.2f}, X {kons_x:.2f})."
        )
    if punkte is None or len(punkte) == 0:
        raise ValueError("Gedrehtes Video: für das Vorzeichen der Hochachse fehlen Punkte.")
    oben = mittel_x / kons_x
    kamera_hoehen = posen[:, :3, 3] @ oben
    punkt_hoehen = np.asarray(punkte, dtype=np.float64) @ oben
    if float(np.median(punkt_hoehen)) > float(np.median(kamera_hoehen)):
        return -oben, "-X", kons_x
    return oben, "+X", kons_x


def punkte_aus_vorhersagen(
    punkte_je_view: list[NDArray[np.floating]],
    masken_je_view: list[NDArray[np.bool_]],
    bilder_je_view: list[NDArray[np.floating]] | list[NDArray[np.uint8]],
    pixel_schritt: int = 2,
) -> tuple[NDArray[np.float64], NDArray[np.uint8]]:
    """Sammelt gültige Weltpunkte + Farben aller Views (MapAnything ``pts3d``).

    ``pixel_schritt`` dünnt jedes Bild vorab aus (2 → ein Viertel der Pixel): die
    Voxel-Fusion (2 cm) verwirft die Dichte ohnehin, spart aber Speicher/Zeit bei
    100+ Keyframes. Farben dürfen 0..1 (float, ``img_no_norm``) oder 0..255 sein.
    """
    if not (len(punkte_je_view) == len(masken_je_view) == len(bilder_je_view)):
        raise ValueError("Punkte, Masken und Bilder brauchen je View einen Eintrag.")
    if pixel_schritt < 1:
        raise ValueError("pixel_schritt muss ≥ 1 sein.")
    alle_p: list[NDArray[np.float64]] = []
    alle_f: list[NDArray[np.float64]] = []
    s = pixel_schritt
    for p, m, b in zip(punkte_je_view, masken_je_view, bilder_je_view, strict=True):
        p_s = np.asarray(p, dtype=np.float64)[::s, ::s]
        m_s = np.asarray(m, dtype=bool)[::s, ::s] & np.all(np.isfinite(p_s), axis=-1)
        b_s = np.asarray(b)[::s, ::s].astype(np.float64)
        if b_s.size and float(b_s.max()) <= 1.0:
            b_s = b_s * 255.0
        alle_p.append(p_s[m_s])
        alle_f.append(b_s[m_s])
    if not alle_p:
        return np.empty((0, 3), dtype=np.float64), np.empty((0, 3), dtype=np.uint8)
    punkte = np.concatenate(alle_p, axis=0)
    farben = np.clip(np.rint(np.concatenate(alle_f, axis=0)), 0, 255).astype(np.uint8)
    return punkte, farben


def _winkel_grad(r: NDArray[np.float64]) -> float:
    """Drehwinkel einer 3×3-Rotation in Grad."""
    c = (float(np.trace(r)) - 1.0) / 2.0
    return float(np.degrees(np.arccos(np.clip(c, -1.0, 1.0))))


def _ebene_nachfitten(band_zup: NDArray[np.float64], schwelle: float = 0.04) -> NDArray[np.float64]:
    """Kleine Restrotation: Bodenebene per Ausgleichsrechnung (SVD) statt 3 Punkten.

    RANSAC wählt die Ebene aus einer 3-Punkt-Stichprobe – bei Rauschen bleibt so
    eine Restneigung von ~0.5° (2 cm über 4 m). Hier werden die Punkte nahe der
    Bodenhöhe (25. Perzentil des Bands, ± ``schwelle``) genommen und ihre
    kleinste Hauptachse als Normale gefittet.
    """
    z = band_zup[:, 2]
    boden_z = float(np.percentile(z, 25.0))
    inlier = band_zup[np.abs(z - boden_z) < schwelle]
    if inlier.shape[0] < 3:
        return np.eye(3)
    zentriert = inlier - inlier.mean(axis=0)
    normale = np.linalg.svd(zentriert, full_matrices=False)[2][-1]
    if normale[2] < 0:
        normale = -normale
    return rotation_zu_zup((-float(normale[0]), -float(normale[1]), -float(normale[2])))


def richte_rekonstruktion_aus(
    punkte: NDArray[np.float64],
    posen_c2w: NDArray[np.float64],
    *,
    seed: int = 0,
) -> Ausrichtung:
    """Dreht die Rekonstruktion nach z-up und legt den Boden auf z = 0.

    1. Grobe Hochachse aus den Kameras (``oben_aus_kameras``) → auf +z drehen.
    2. Verfeinern: RANSAC-Bodenebene (bzw. Decke – beide liefern dieselbe
       Normale) auf einer Stichprobe; nur übernommen, wenn die Korrektur
       ≤ 10° ist (sonst hat RANSAC eine schräge Fläche erwischt).
    3. Boden = 2. z-Perzentil → z = 0 (wie ``richte_zup``).

    Deterministisch (fester ``seed`` für Stichprobe und RANSAC).
    """
    p = np.asarray(punkte, dtype=np.float64).reshape(-1, 3)
    if p.shape[0] < 3:
        raise ValueError("Zu wenige Punkte für die Ausrichtung.")
    posen = np.asarray(posen_c2w, dtype=np.float64)
    oben, achse, konsistenz = oben_aus_kameras(posen, p)

    # rotation_zu_zup erwartet die Schwerkraft = «unten» = −oben.
    r_grob = rotation_zu_zup((-float(oben[0]), -float(oben[1]), -float(oben[2])))
    p_grob = p @ r_grob.T

    # Nur das untere Höhenband: dort liegt fast nur Boden. Über die ganze Wolke
    # ist der Boden ~10 % der Punkte – 3-Punkt-Stichproben treffen ihn dann zu
    # selten, RANSAC landet auf Zufallsebenen (im Test so passiert).
    rng = np.random.default_rng(seed)
    band = p_grob[p_grob[:, 2] <= np.percentile(p_grob[:, 2], _BODEN_BAND_PERZENTIL)]
    stichprobe = (
        band[rng.choice(band.shape[0], size=_RANSAC_STICHPROBE, replace=False)]
        if band.shape[0] > _RANSAC_STICHPROBE
        else band
    )
    try:
        r_fein = boden_ransac(stichprobe, iterationen=500, schwelle=0.04, seed=seed)
        r_fein = _ebene_nachfitten(stichprobe @ r_fein.T) @ r_fein
        korrektur = _winkel_grad(r_fein)
        if korrektur > _MAX_KORREKTUR_GRAD:
            r_fein, korrektur = np.eye(3), 0.0
    except ValueError:
        r_fein, korrektur = np.eye(3), 0.0

    rotation = r_fein @ r_grob
    ausgerichtet = p @ rotation.T
    boden = float(np.percentile(ausgerichtet[:, 2], 2.0))
    ausgerichtet[:, 2] -= boden
    decke = float(np.percentile(ausgerichtet[:, 2], 98.0))
    kamera_z = posen[:, :3, 3] @ rotation.T
    return Ausrichtung(
        punkte=ausgerichtet,
        rotation=rotation,
        boden_versatz=boden,
        oben_achse=achse,
        konsistenz=konsistenz,
        korrektur_grad=korrektur,
        raumhoehe=decke,
        kamerahoehe_median=float(np.median(kamera_z[:, 2])) - boden,
    )
