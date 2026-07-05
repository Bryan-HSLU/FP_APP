"""fp_scan_worker – GPU-Scan-Worker für «Future Planning».

Läuft produktiv auf Google Colab (T4): AR-Posen (`poses.json`) + Video-Frames →
known-pose Tiefen-Fusion (Depth Anything V2 Small) → z-up → metrische Punktwolke
(`scene.ply`) → SpatialLM → `layout.txt`. Der serverseitige Adapter in
`fp_engines.scan` macht daraus das Raummodell – dieser Worker importiert NIE aus
den Engines (Brain: ADR-0012, POC-Demo-Architektur-HF).

Der **Geometrie-Kern** (`kamera`, `fusion`, `ausrichtung`, `skalierung`, `ply`,
`pipeline`) läuft CPU-only mit numpy und ist getestet. GPU-/Colab-Bausteine
(Depth Anything, SpatialLM, open3d, cv2, gradio) sind ausschliesslich guarded
Imports mit klarer Fehlermeldung.
"""

from __future__ import annotations

__all__ = ["__version__"]

__version__ = "0.1.0"
