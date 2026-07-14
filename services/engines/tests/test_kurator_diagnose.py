"""Smoke-Test Kurator-Diagnose (ADR-0014 Punkt 6).

`scripts/kurator_diagnose.py` liegt bewusst unter `scripts/` (kein Package
unter `src/fp_engines`) – wird hier per Pfad geladen statt importiert, exakt
wie `test_kurator_eval.py` es für `kurator_eval.py` tut. Deckt NUR den
Baseline-Pfad ab (kein LLM-Call in Tests): 1 Raum × 1 Profil × 1 Seed statt
der vollen 3×3-Matrix – reiner Vertrags-/Rauch-Test der Ausgabe (Abschnitte
vorhanden, Exit 0, deterministisch), keine Qualitätsaussage über die
Kuration selbst (die liefert der reale Lauf, s. Docstring des Skripts).
"""

import importlib.util
import json
import re
import sys
from pathlib import Path
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT = REPO_ROOT / "services" / "engines" / "scripts" / "kurator_diagnose.py"


def _lade_diagnose_modul() -> Any:
    spec = importlib.util.spec_from_file_location("kurator_diagnose", SCRIPT)
    assert spec is not None and spec.loader is not None
    modul = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = modul
    spec.loader.exec_module(modul)
    return modul


kurator_diagnose = _lade_diagnose_modul()

_ERWARTETE_ABSCHNITTE = [
    "# Kurator-Diagnose v3.1",
    "Port: baseline",
    "Konzept:",
    "Haupt:",
    "Ergänzungen:",
    "Farben:",
    "Flächen:",
    "Marker:",
    "Plausibilität:",
    "P1-Pflicht komplett",
    "Anker erfüllt",
    "Instanzzahl im Leitplanken-Korridor",
    "Platz-Auslastung",
    "Farb-Palette-Nähe",
    "Flächen-Normkonformität",
    "Zusammenfassung:",
]

_EIN_RAUM_EIN_PROFIL = ["--raum", "bad", "--profil", "warm-natuerlich (extrem)"]


def test_main_baseline_smoke(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """Ohne FP_KURATOR_URL läuft die Baseline – enthält alle Pflichtabschnitte,
    Exit 0."""
    monkeypatch.delenv("FP_KURATOR_URL", raising=False)

    code = kurator_diagnose.main(_EIN_RAUM_EIN_PROFIL)

    ausgabe = capsys.readouterr().out
    assert code == 0
    for abschnitt in _ERWARTETE_ABSCHNITTE:
        assert abschnitt in ausgabe, f"Abschnitt fehlt in der Ausgabe: {abschnitt!r}"
    assert re.search(r"Zusammenfassung: [01]/1 Kombinationen ohne ⚠️", ausgabe)


def test_main_baseline_deterministisch(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """Gleiche Args + Baseline ⇒ byte-identischer Output (kein Zeitstempel,
    Engineering-Grundlagen §1: gleicher Input + Seed ⇒ gleiches Ergebnis)."""
    monkeypatch.delenv("FP_KURATOR_URL", raising=False)

    kurator_diagnose.main(_EIN_RAUM_EIN_PROFIL)
    erster = capsys.readouterr().out
    kurator_diagnose.main(_EIN_RAUM_EIN_PROFIL)
    zweiter = capsys.readouterr().out

    assert erster == zweiter
    assert erster  # nicht leer


def test_main_matrix_default_neun_kombinationen(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """Ohne --raum/--profil/--seeds: 3 Räume × 3 Profile × 1 Seed = 9 Kombinationen."""
    monkeypatch.delenv("FP_KURATOR_URL", raising=False)

    code = kurator_diagnose.main([])

    ausgabe = capsys.readouterr().out
    assert code == 0
    assert re.search(r"Zusammenfassung: \d+/9 Kombinationen ohne ⚠️", ausgabe)


def test_main_json_export(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("FP_KURATOR_URL", raising=False)
    ziel = tmp_path / "kurator_diagnose.json"

    code = kurator_diagnose.main([*_EIN_RAUM_EIN_PROFIL, "--json", str(ziel)])

    assert code == 0
    assert ziel.is_file()
    daten = json.loads(ziel.read_text(encoding="utf-8"))
    assert daten["port"] == "baseline"
    assert len(daten["kombinationen"]) == 1
    kombi = daten["kombinationen"][0]
    assert kombi["raum"] == "bad"
    assert kombi["profil"] == "warm-natuerlich (extrem)"
    assert "P1-Pflicht komplett" in kombi["ampeln"]
    assert set(kombi["ampeln"]["P1-Pflicht komplett"]) == {"ok", "text"}


def test_main_solve_flag(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """--solve hängt den Solver-Durchstich (platziert/gewählt + 0-❌-Check) an."""
    monkeypatch.delenv("FP_KURATOR_URL", raising=False)

    code = kurator_diagnose.main([*_EIN_RAUM_EIN_PROFIL, "--solve"])

    ausgabe = capsys.readouterr().out
    assert code == 0
    assert "Solver:" in ausgabe


def test_main_ungueltiger_raum_exit_code() -> None:
    """Unbekannter --raum-Wert → argparse-Fehler (Exit-Code != 0), kein Crash
    mit Traceback."""
    with pytest.raises(SystemExit) as exc:
        kurator_diagnose.main(["--raum", "keller"])
    assert exc.value.code != 0
