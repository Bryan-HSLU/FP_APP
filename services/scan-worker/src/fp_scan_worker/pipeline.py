"""Pipeline-Kern: Posen + Tiefen → fusionierte, z-up-ausgerichtete Punktwolke.

Bewusst **ohne** Import aus ``fp_engines`` (strikte Repo-Trennung): das
``poses.json`` wird hier als schlanke ``PosenLite`` erneut geparst – Feld-Layout
identisch zum kanonischen Scan-Bundle-Vertrag (siehe ``fp_engines.scan.poses``),
nur ohne die Server-Abhängigkeiten. So bleibt der Worker eigenständig
Colab-deploybar.
"""

from __future__ import annotations

import json
import math
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import numpy as np
from numpy.typing import NDArray

from fp_scan_worker.ausrichtung import richte_zup
from fp_scan_worker.fusion import fuse
from fp_scan_worker.kamera import pose_matrix, unproject

__all__ = [
    "FrameLite",
    "PosenFehler",
    "PosenLite",
    "TiefenProvider",
    "baue_punktwolke",
    "outlier_filter",
    "parse_posen_lite",
]

# Frame-Index → Tiefen-Map (H, W). In Tests synthetisch, auf Colab Depth Anything.
TiefenProvider = Callable[[int], NDArray[np.float32]]


class PosenFehler(ValueError):
    """`poses.json` verletzt den (schlanken) Scan-Bundle-Vertrag."""


@dataclass(frozen=True)
class FrameLite:
    """Ein Posen-Frame; Layout identisch zum ``poses.json``-Vertrag."""

    t: float
    position: tuple[float, float, float]
    quaternion: tuple[float, float, float, float]  # xyzw


@dataclass(frozen=True)
class PosenLite:
    """Schlanke Sicht auf ``poses.json`` – Feld-Layout wie ``fp_engines.scan.poses``."""

    source: str
    gravity: tuple[float, float, float]
    frames: list[FrameLite]


def _vec(roh: Any, n: int, was: str) -> tuple[float, ...]:
    if not isinstance(roh, list) or len(roh) != n:
        raise PosenFehler(f"{was}: erwartet Liste mit {n} Zahlen, bekam {roh!r}")
    try:
        return tuple(float(v) for v in roh)
    except (TypeError, ValueError) as e:
        raise PosenFehler(f"{was}: keine Zahl ({e})") from e


def parse_posen_lite(text_oder_dict: str | dict[str, Any]) -> PosenLite:
    """Parst/validiert ein ``poses.json`` minimal (analog ``fp_engines.scan.poses``).

    Geprüft wird, worauf Fusion/z-up bauen: ≥ 2 Frames, streng monotone
    Zeitstempel, Einheits-Quaternionen (|q| ≈ 1) und ein brauchbarer
    Schwerkraft-Vektor (Norm > 1). Ehrliches Scheitern statt stiller Rate-Werte.
    """
    obj: dict[str, Any] = (
        json.loads(text_oder_dict) if isinstance(text_oder_dict, str) else text_oder_dict
    )

    source = obj.get("source")
    if not isinstance(source, str) or not source:
        raise PosenFehler("source fehlt.")

    gravity = _vec(obj.get("gravity"), 3, "gravity")
    if math.hypot(*gravity) <= 1.0:
        raise PosenFehler(f"gravity {gravity} ist zu kurz – Richtung nicht bestimmbar.")

    roh_frames = obj.get("frames")
    if not isinstance(roh_frames, list) or len(roh_frames) < 2:
        raise PosenFehler("Mindestens 2 Frames nötig (sonst kein Massstab aus Bewegung).")

    frames: list[FrameLite] = []
    letzte_t = -math.inf
    for i, f in enumerate(roh_frames):
        if not isinstance(f, dict):
            raise PosenFehler(f"Frame {i} ist kein Objekt.")
        try:
            t = float(f["t"])
        except (KeyError, TypeError, ValueError) as e:
            raise PosenFehler(f"Frame {i}: t fehlt/ungültig ({e}).") from e
        if t <= letzte_t:
            raise PosenFehler(f"Frame {i}: Zeitstempel nicht streng monoton ({t} ≤ {letzte_t}).")
        letzte_t = t
        pos = _vec(f.get("position"), 3, f"Frame {i} position")
        quat = _vec(f.get("quaternion"), 4, f"Frame {i} quaternion")
        if abs(math.sqrt(sum(q * q for q in quat)) - 1.0) > 0.01:
            raise PosenFehler(f"Frame {i}: Quaternion nicht normiert.")
        frames.append(
            FrameLite(
                t=t,
                position=(pos[0], pos[1], pos[2]),
                quaternion=(quat[0], quat[1], quat[2], quat[3]),
            )
        )

    return PosenLite(
        source=source,
        gravity=(gravity[0], gravity[1], gravity[2]),
        frames=frames,
    )


def baue_punktwolke(
    posen: PosenLite,
    tiefen: TiefenProvider,
    k: NDArray[np.float64],
    *,
    keyframe_schritt: int = 10,
    voxel: float = 0.02,
) -> NDArray[np.float64]:
    """Baut die z-up-Punktwolke aus Keyframes (unproject → fuse → richte_zup).

    Nur jeder ``keyframe_schritt``-te Frame wird genutzt – der zentrale
    Laufzeit-Hebel (Brain: Scan-Laufzeit-Budget). Der ``TiefenProvider`` bekommt
    den **Original-Frame-Index**, damit er die passende Tiefen-Map liefern kann.
    """
    if keyframe_schritt < 1:
        raise ValueError("keyframe_schritt muss ≥ 1 sein.")

    wolken: list[NDArray[np.float64]] = []
    for i in range(0, len(posen.frames), keyframe_schritt):
        frame = posen.frames[i]
        depth = tiefen(i)
        t_wc = pose_matrix(frame.position, frame.quaternion)
        wolken.append(unproject(depth, k, t_wc))

    fusioniert = fuse(wolken, voxel=voxel)
    return richte_zup(fusioniert, posen.gravity)


def outlier_filter(
    punkte: NDArray[np.float64],
    nachbarn: int = 10,
    std_ratio: float = 1.5,
) -> NDArray[np.float64]:
    """Statistischer Ausreisser-Filter (SpatialLM-Empfehlung), guarded über open3d.

    open3d ist nur auf Colab installiert. Fehlt es (CPU-Kern, Tests), werden die
    Punkte **unverändert** zurückgegeben – der Filter ist eine Qualitäts-, keine
    Korrektheitsstufe.
    """
    try:
        import open3d as o3d
    except ImportError:
        return punkte

    pcd = o3d.geometry.PointCloud()
    pcd.points = o3d.utility.Vector3dVector(np.asarray(punkte, dtype=np.float64))
    gefiltert, _ = pcd.remove_statistical_outlier(nb_neighbors=nachbarn, std_ratio=std_ratio)
    return np.asarray(gefiltert.points, dtype=np.float64)
