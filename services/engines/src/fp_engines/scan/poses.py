"""Scan-Bundle-Posen v0: unser kanonisches `poses.json` aus der AR-Aufnahme.

Die Aufnahme-App (iOS ARKit z.B. Voxelio, Android ARCore) exportiert Video +
Posen. App-spezifische Exportformate werden am Rand in DIESES kanonische Format
konvertiert (Konverter folgt mit dem scan-worker, sobald das echte Exportformat
der gewählten App fixiert ist) – Fusion/z-up/Skalierung hängen so nie an einer
bestimmten App (ADR-0012).

Kanonisches Format (JSON):
    {
      "schemaVersion": "0.1.0",
      "source": "arkit" | "arcore" | "sonstig",
      "gravity": [gx, gy, gz],            # Welt-KS der Posen, Richtung genügt
      "frames": [
        {"t": 0.033, "position": [x, y, z], "quaternion": [qx, qy, qz, qw]}
      ]
    }

Einheiten: Meter, Sekunden; Quaternion xyzw (ARKit/ARCore-üblich). Die Posen
sind metrisch (VIO) – genau deshalb entfällt der teure SLAM-Pose-Solve
(Brain: Scan-Laufzeit-Budget-und-Beschleunigung).
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import Any

__all__ = ["PosenFehler", "PosenFrame", "ScanPosen", "parse_posen"]

_QUELLEN = {"arkit", "arcore", "sonstig"}


class PosenFehler(ValueError):
    """`poses.json` verletzt den Scan-Bundle-Vertrag."""


@dataclass(frozen=True)
class PosenFrame:
    t: float
    position: tuple[float, float, float]
    quaternion: tuple[float, float, float, float]  # xyzw


@dataclass(frozen=True)
class ScanPosen:
    schema_version: str
    source: str
    gravity: tuple[float, float, float]
    frames: list[PosenFrame]


def _vec(roh: Any, n: int, was: str) -> tuple[float, ...]:
    if not isinstance(roh, list) or len(roh) != n:
        raise PosenFehler(f"{was}: erwartet Liste mit {n} Zahlen, bekam {roh!r}")
    try:
        return tuple(float(v) for v in roh)
    except (TypeError, ValueError) as e:
        raise PosenFehler(f"{was}: keine Zahl ({e})") from e


def parse_posen(daten: str | dict[str, Any]) -> ScanPosen:
    """Parst und validiert ein kanonisches `poses.json` (String oder Dict).

    Hart geprüft wird alles, worauf Fusion/z-up/Skalierung bauen: monotone
    Zeitstempel, Einheits-Quaternionen, brauchbarer Schwerkraft-Vektor,
    mindestens 2 Frames (sonst gibt es keine Bewegung → keinen Massstab).
    """
    obj: dict[str, Any] = json.loads(daten) if isinstance(daten, str) else daten

    source = obj.get("source")
    if source not in _QUELLEN:
        raise PosenFehler(f"source muss aus {sorted(_QUELLEN)} sein, ist {source!r}.")
    version = obj.get("schemaVersion")
    if not isinstance(version, str) or not version:
        raise PosenFehler("schemaVersion fehlt.")

    gravity = _vec(obj.get("gravity"), 3, "gravity")
    if math.hypot(*gravity) < 1.0:
        raise PosenFehler(f"gravity {gravity} ist zu kurz – Richtung nicht bestimmbar.")

    roh_frames = obj.get("frames")
    if not isinstance(roh_frames, list) or len(roh_frames) < 2:
        raise PosenFehler("Mindestens 2 Frames nötig (sonst kein Massstab aus Bewegung).")

    frames: list[PosenFrame] = []
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
        norm = math.sqrt(sum(q * q for q in quat))
        if abs(norm - 1.0) > 0.01:
            raise PosenFehler(f"Frame {i}: Quaternion nicht normiert (|q|={norm:.4f}).")
        frames.append(
            PosenFrame(
                t=t,
                position=(pos[0], pos[1], pos[2]),
                quaternion=(quat[0], quat[1], quat[2], quat[3]),
            )
        )

    return ScanPosen(
        schema_version=version,
        source=source,
        gravity=(gravity[0], gravity[1], gravity[2]),
        frames=frames,
    )
