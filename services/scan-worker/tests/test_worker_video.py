"""Verdrahtung des Video-Wegs (ADR-0016) mit ersetzten GPU-Teilen.

Video-Dekodierung, MapAnything und SpatialLM laufen nur auf Colab. Hier werden
sie durch Stubs ersetzt, damit die Kette dazwischen – Frame-Auswahl, Ausrichtung,
Massstab, Fusion, PLY, Speicher-Rückfall – auf der CPU geprüft ist.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import pytest
from test_rekonstruktion import HOEHE, _beliebige_welt, _kameras, _raum, _transformiere

from fp_scan_worker import worker
from fp_scan_worker.ply import lies_ply


def _stubs(monkeypatch: pytest.MonkeyPatch, oom_bis_frames: int = 0) -> dict[str, Any]:
    aufrufe: dict[str, Any] = {"mapanything": []}
    rng = np.random.default_rng(0)
    punkte, posen = _transformiere(_raum(rng), _kameras(), _beliebige_welt())

    def kandidaten(video: Path) -> tuple[np.ndarray, np.ndarray]:
        zeiten = np.arange(0, 20.0, 1 / 30)  # 20 s Video
        return zeiten, np.ones_like(zeiten)

    def speichere(video: Path, indizes: list[int], ziel: Path) -> list[Path]:
        return [ziel / f"{i:06d}.jpg" for i in indizes]

    def mapanything(pfade: list[Path]) -> dict[str, Any]:
        aufrufe["mapanything"].append(len(pfade))
        if len(pfade) > oom_bis_frames > 0:
            raise RuntimeError("CUDA out of memory. Tried to allocate 2.00 GiB")
        # eine «View» mit allen Raumpunkten (H=N, W=1) – reicht für die Kette
        return {
            "punkte": [punkte[:, None, :]],
            "masken": [np.ones((len(punkte), 1), dtype=bool)],
            "bilder": [np.full((len(punkte), 1, 3), 0.5)],
            "posen": posen,
        }

    monkeypatch.setattr(worker, "_kandidaten_aus_video", kandidaten)
    monkeypatch.setattr(worker, "_speichere_frames", speichere)
    monkeypatch.setattr(worker, "_mapanything", mapanything)
    monkeypatch.setattr(worker, "_lauf_spatiallm", lambda ply: "wall_0=Wall(0,0,0,4,0,0,2.5,0.1)")
    return aufrufe


def test_video_weg_liefert_aufrechte_ply_und_layout(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _stubs(monkeypatch)
    status, ply, layout = worker.scanne_video(Path("r1.mov"), tmp_path, ziel_fps=3.0)
    assert status.startswith("OK: 60 Keyframes")
    assert "Hochachse -Y" in status
    xyz, rgb = lies_ply(ply)
    assert abs(float(np.percentile(xyz[:, 2], 98)) - HOEHE) < 0.05
    assert float(np.percentile(xyz[:, 2], 2)) > -0.05
    assert np.all(rgb == 128)
    assert layout.read_text(encoding="utf-8").startswith("wall_0")


def test_bekannte_raumhoehe_setzt_massstab(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _stubs(monkeypatch)
    status, ply, _ = worker.scanne_video(Path("r1.mov"), tmp_path, raumhoehe_m=2.6)
    xyz, _ = lies_ply(ply)
    assert "Massstab aus Raumhöhe 2.60 m" in status
    assert abs(float(np.percentile(xyz[:, 2], 98)) - 2.6) < 0.05


def test_speicherfehler_halbiert_die_frames(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    aufrufe = _stubs(monkeypatch, oom_bis_frames=40)
    status, _, _ = worker.scanne_video(Path("r1.mov"), tmp_path, ziel_fps=5.0)
    assert aufrufe["mapanything"] == [100, 50, 25]
    assert "mit 25 Frames wiederholt" in status


def test_scanne_leitet_nach_dateityp(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _stubs(monkeypatch)
    video = tmp_path / "raum.MOV"
    video.write_bytes(b"")
    status, ply, layout = worker._scanne(str(video))
    assert status.startswith("OK") and ply and layout
    assert worker._scanne(str(tmp_path / "notiz.txt"))[0].startswith("Bitte ein Video")
    assert worker._scanne(None)[0].startswith("Kein Video")
