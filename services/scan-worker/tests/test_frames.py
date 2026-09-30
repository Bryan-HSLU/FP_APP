"""Frame-Auswahl: schärfstes je Zeitfenster, verwackelte raus, dichter bei Bedarf."""

from __future__ import annotations

import numpy as np
import pytest

from fp_scan_worker.frames import schaerfe, waehle_frames


def _kanten_bild(seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return rng.integers(0, 256, size=(60, 80)).astype(np.float64)


def _unscharf(bild: np.ndarray, laenge: int = 7) -> np.ndarray:
    # horizontale Bewegungsunschärfe (gleitender Mittelwert)
    kern = np.ones(laenge) / laenge
    return np.apply_along_axis(lambda z: np.convolve(z, kern, mode="same"), 1, bild)


def test_schaerfe_erkennt_bewegungsunschaerfe() -> None:
    scharf = _kanten_bild()
    assert schaerfe(_unscharf(scharf)) < 0.2 * schaerfe(scharf)


def test_schaerfe_konstantes_bild_ist_null() -> None:
    assert schaerfe(np.full((10, 10), 128, dtype=np.uint8)) == 0.0


def test_schaerfe_lehnt_falsche_form_ab() -> None:
    with pytest.raises(ValueError):
        schaerfe(np.zeros((2, 2)))


def test_ziel_fps_bestimmt_die_anzahl() -> None:
    t = np.arange(0, 20.0, 1 / 30)  # 20 s Video, 30 fps
    s = np.ones_like(t)
    assert len(waehle_frames(t, s, ziel_fps=3.0)) == 60
    # zügiger Durchgang → höhere Dichte einstellbar
    assert len(waehle_frames(t, s, ziel_fps=5.0)) == 100


def test_obergrenze_verteilt_ueber_ganzes_video() -> None:
    t = np.arange(0, 60.0, 1 / 30)  # 60 s bei 3 fps wären 180
    s = np.ones_like(t)
    wahl = waehle_frames(t, s, ziel_fps=3.0, max_frames=50)
    assert len(wahl) == 50
    # Abdeckung bis ans Ende, nicht nur die ersten 50 Fenster
    assert t[wahl[-1]] > 58.0
    assert t[wahl[0]] < 1.5


def test_kurzes_video_bekommt_mindestanzahl() -> None:
    t = np.arange(0, 2.0, 1 / 30)  # 2 s → bei 3 fps nur 6
    s = np.ones_like(t)
    assert len(waehle_frames(t, s, ziel_fps=3.0, min_frames=12)) == 12


def test_schaerfstes_je_fenster_und_unscharfe_raus() -> None:
    t = np.arange(10) * 0.1  # 1 s, 10 Frames
    s = np.array([5, 9, 5, 5, 5, 0.1, 0.2, 0.1, 0.3, 0.1], dtype=np.float64)
    # 2 Fenster: [0.0, 0.45) und [0.45, 0.9]; das zweite ist komplett verwackelt
    wahl = waehle_frames(t, s, ziel_fps=2.0, min_frames=1)
    assert wahl == [1]


def test_deterministisch_und_frueherer_bei_gleichstand() -> None:
    t = np.arange(0, 4.0, 0.1)
    s = np.ones_like(t)
    a = waehle_frames(t, s, ziel_fps=1.0, min_frames=1)
    assert a == waehle_frames(t, s, ziel_fps=1.0, min_frames=1)
    # je Fenster der erste Frame (Gleichstand)
    assert a == [0, 10, 20, 30]


def test_leere_und_ungueltige_eingaben() -> None:
    assert waehle_frames([], []) == []
    with pytest.raises(ValueError):
        waehle_frames([0.0, 1.0], [1.0])
    with pytest.raises(ValueError):
        waehle_frames([1.0, 0.0], [1.0, 1.0])
    with pytest.raises(ValueError):
        waehle_frames([0.0], [1.0], ziel_fps=0)
