"""PLY-I/O: exakter Roundtrip und Header (SpatialLM-Contract)."""

from __future__ import annotations

from pathlib import Path

import numpy as np

from fp_scan_worker.ply import lies_ply, schreibe_ply


def test_roundtrip_exakt(tmp_path: Path) -> None:
    rng = np.random.default_rng(0)
    punkte = rng.uniform(-5.0, 5.0, size=(37, 3)).astype(np.float32)
    farben = rng.integers(0, 256, size=(37, 3), dtype=np.uint8)

    pfad = tmp_path / "scene.ply"
    schreibe_ply(pfad, punkte, farben)
    gelesen_p, gelesen_f = lies_ply(pfad)

    # float32-Rundung ist verlustfrei, weil schon float32 geschrieben wird
    assert np.array_equal(gelesen_p, punkte)
    assert np.array_equal(gelesen_f, farben)


def test_ohne_farben_neutralgrau(tmp_path: Path) -> None:
    punkte = np.zeros((3, 3), dtype=np.float64)
    pfad = tmp_path / "grau.ply"
    schreibe_ply(pfad, punkte)
    _, farben = lies_ply(pfad)
    assert np.all(farben == 128)


def test_header_binary_little_endian(tmp_path: Path) -> None:
    pfad = tmp_path / "h.ply"
    schreibe_ply(pfad, np.ones((5, 3), dtype=np.float64))
    kopf = pfad.read_bytes()[:200]
    assert kopf.startswith(b"ply\n")
    assert b"format binary_little_endian 1.0" in kopf
    assert b"element vertex 5" in kopf
    assert b"property float x" in kopf
    assert b"property uchar red" in kopf
