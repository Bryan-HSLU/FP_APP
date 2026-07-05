"""Pipeline-Kern: synthetischer Boxraum, Keyframe-Hebel, Posen-Validierung."""

from __future__ import annotations

from typing import Any

import numpy as np
import pytest

from fp_scan_worker.pipeline import PosenFehler, baue_punktwolke, parse_posen_lite

_BREITE, _HOEHE = 8, 6
_KAMERAHOEHE = 1.5


def _k() -> np.ndarray:
    return np.array(
        [[100.0, 0.0, _BREITE / 2.0], [0.0, 100.0, _HOEHE / 2.0], [0.0, 0.0, 1.0]],
        dtype=np.float64,
    )


def _posen_dict(anzahl: int) -> dict[str, Any]:
    """Kameras blicken senkrecht nach unten (Quaternion 180° um x = [1,0,0,0]).

    So liegt der Boden konsequent bei Welt-z = 0 (Kamera auf Höhe 1.5 m, Tiefe zum
    Boden = 1.5 m); die Kamera wandert in x/y über den Raum.
    """
    frames = []
    for i in range(anzahl):
        px = 0.1 * i  # Kamera fährt monoton in x
        py = 0.05 * i  # und leicht in y
        frames.append(
            {
                "t": round(0.033 * i, 4),
                "position": [px, py, _KAMERAHOEHE],
                "quaternion": [1.0, 0.0, 0.0, 0.0],
            }
        )
    return {"source": "arkit", "gravity": [0.0, 0.0, -9.81], "frames": frames}


def _zaehlender_provider() -> tuple[Any, list[int]]:
    aufrufe: list[int] = []
    tiefe = np.full((_HOEHE, _BREITE), _KAMERAHOEHE, dtype=np.float32)

    def provider(index: int) -> np.ndarray:
        aufrufe.append(index)
        return tiefe

    return provider, aufrufe


def test_boxraum_boden_auf_null_und_ausdehnung() -> None:
    posen = parse_posen_lite(_posen_dict(30))
    provider, _ = _zaehlender_provider()
    wolke = baue_punktwolke(posen, provider, _k(), keyframe_schritt=5)

    assert wolke.shape[0] > 0
    assert np.allclose(wolke[:, 2], 0.0, atol=1e-6)  # Boden ≈ z = 0
    # plausible Ausdehnung in x/y (Kamerafahrt + Bildkegel)
    ausdehnung = wolke[:, :2].max(axis=0) - wolke[:, :2].min(axis=0)
    assert np.all(ausdehnung > 0.1)


def test_keyframe_schritt_reduziert_frames() -> None:
    posen = parse_posen_lite(_posen_dict(30))

    provider_dicht, aufrufe_dicht = _zaehlender_provider()
    baue_punktwolke(posen, provider_dicht, _k(), keyframe_schritt=1)

    provider_grob, aufrufe_grob = _zaehlender_provider()
    baue_punktwolke(posen, provider_grob, _k(), keyframe_schritt=10)

    assert len(aufrufe_dicht) == 30
    assert aufrufe_grob == [0, 10, 20]  # nur jeder 10. Original-Frame-Index
    assert len(aufrufe_grob) < len(aufrufe_dicht)


def test_parse_posen_lite_fehlerfaelle() -> None:
    basis = _posen_dict(3)

    with pytest.raises(PosenFehler, match="2 Frames"):
        parse_posen_lite({**basis, "frames": basis["frames"][:1]})

    unsortiert = [basis["frames"][1], basis["frames"][0], basis["frames"][2]]
    with pytest.raises(PosenFehler, match="monoton"):
        parse_posen_lite({**basis, "frames": unsortiert})

    krumm = {**basis["frames"][1], "quaternion": [1.0, 1.0, 0.0, 0.0]}
    with pytest.raises(PosenFehler, match="normiert"):
        parse_posen_lite({**basis, "frames": [basis["frames"][0], krumm]})

    with pytest.raises(PosenFehler, match="gravity"):
        parse_posen_lite({**basis, "gravity": [0.0, 0.0, -0.5]})


def test_parse_posen_lite_akzeptiert_json_string() -> None:
    import json

    posen = parse_posen_lite(json.dumps(_posen_dict(2)))
    assert posen.source == "arkit"
    assert len(posen.frames) == 2
