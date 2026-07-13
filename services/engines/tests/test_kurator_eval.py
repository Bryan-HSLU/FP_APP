"""Smoke-Test Kurator-Eval (Kurator-Pipeline-v3-Konzept, Welle 4).

`scripts/kurator_eval.py` liegt bewusst unter `scripts/` (kein Package unter
`src/fp_engines`) – wird hier per Pfad geladen statt importiert. Deckt NUR den
Baseline-Pfad ab: kein LLM-Call in Tests (Vorgabe), daher ein kleines Testset
(1 Raum × 1 Profil × 2 Seeds statt der vollen 3×3×5-Matrix) – reiner
Durchlauf-/Vertrags-Test der Metrik-Funktion, keine Qualitätsaussage.
"""

import importlib.util
import sys
from pathlib import Path
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT = REPO_ROOT / "services" / "engines" / "scripts" / "kurator_eval.py"


def _lade_eval_modul() -> Any:
    spec = importlib.util.spec_from_file_location("kurator_eval", SCRIPT)
    assert spec is not None and spec.loader is not None
    modul = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = modul
    spec.loader.exec_module(modul)
    return modul


kurator_eval = _lade_eval_modul()

_ERWARTETE_KEYS = {
    "validitaet_pct",
    "stil_treue_mittel",
    "diversitaet_sets",
    "ueberlebensrate_mittel",
    "auslastung_mittel",
    "palette_treffer_mittel",
    "norm_korrektur_pct",
    "invariante_gehalten",
    "laeufe",
}


def test_miss_baseline_smoke(monkeypatch: pytest.MonkeyPatch) -> None:
    from fp_engines.kurator import BaselineKurator

    # Kleines Testset statt der vollen 3 Räume × 3 Profile × 5 Seeds – Smoke,
    # kein Qualitätsbeweis (der läuft real per `uv run python
    # scripts/kurator_eval.py`, s. Docstring des Skripts).
    monkeypatch.setattr(kurator_eval, "RAEUME", {"bad": kurator_eval.RAEUME["bad"]})
    monkeypatch.setattr(
        kurator_eval,
        "RAUM_KATALOG_REGELN",
        {"bad": kurator_eval.RAUM_KATALOG_REGELN["bad"]},
    )
    monkeypatch.setattr(
        kurator_eval,
        "PROFILE",
        {"warm-natuerlich (extrem)": kurator_eval.PROFILE["warm-natuerlich (extrem)"]},
    )
    monkeypatch.setattr(kurator_eval, "SEEDS", range(1, 3))

    ergebnis = kurator_eval._miss(BaselineKurator())

    assert _ERWARTETE_KEYS <= set(ergebnis)
    assert ergebnis["laeufe"] == 2
    assert 0.0 <= ergebnis["validitaet_pct"] <= 100.0
    assert 0.0 <= ergebnis["ueberlebensrate_mittel"] <= 1.0
    assert 1 <= ergebnis["diversitaet_sets"] <= 2
    # Solver-Invariante (0 harte Verstösse) hält – `_miss` würde sonst per
    # assert intern schon abbrechen; hier zusätzlich am Rückgabewert geprüft.
    assert ergebnis["invariante_gehalten"] is True
    # Baseline hat keinen Norm-Repair-Pfad (kein LLM-Call C) → nicht messbar.
    assert ergebnis["norm_korrektur_pct"] == "n/a"


def test_miss_baseline_kein_llm_call(monkeypatch: pytest.MonkeyPatch) -> None:
    """`_miss` ruft nie `waehle_port`/das LLM auf – der Port kommt vom Aufrufer."""
    from fp_engines.kurator import BaselineKurator

    monkeypatch.delenv("FP_KURATOR_URL", raising=False)
    monkeypatch.setattr(kurator_eval, "RAEUME", {"bad": kurator_eval.RAEUME["bad"]})
    monkeypatch.setattr(
        kurator_eval,
        "RAUM_KATALOG_REGELN",
        {"bad": kurator_eval.RAUM_KATALOG_REGELN["bad"]},
    )
    monkeypatch.setattr(
        kurator_eval,
        "PROFILE",
        {"mittig-unentschieden": kurator_eval.PROFILE["mittig-unentschieden"]},
    )
    monkeypatch.setattr(kurator_eval, "SEEDS", range(1, 3))

    ergebnis = kurator_eval._miss(BaselineKurator())

    assert ergebnis["laeufe"] == 2
