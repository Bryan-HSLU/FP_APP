"""Beweist den Metrik-Kern (eval_metrics) gegen die R1-Ground-Truth – GPU-frei.

Läuft ohne externe Abhängigkeiten:  python3 test_eval_metrics.py
(notebooks/ ist bewusst nicht im CI der Engines; dieser Test ist die lokale
«Tests = Beweis»-Absicherung des Mess-Kerns.)
"""

from __future__ import annotations

import json
from pathlib import Path

import eval_metrics as em

GT = json.loads((Path(__file__).parent / "ground-truth" / "r1.json").read_text("utf-8"))
GT_POLY: list[tuple[float, float]] = [(float(x), float(z)) for x, z in GT["grundriss_polygon_m"]]


def test_perfekte_schaetzung_null_fehler() -> None:
    """Polygon == Ground Truth → 0 Wandfehler, 0 Flächenfehler, 0° (rechtwinklig)."""
    r = em.evaluate(GT, est_polygon=list(GT_POLY))
    assert r["wandlaengen_fehler_median_cm"] == 0.0
    assert r["wandlaengen_fehler_max_cm"] == 0.0
    assert r["raumflaechen_fehler_pct"] == 0.0
    assert r["rechtwinkel_abweichung_grad"] == 0.0
    assert em.gate(r) == "go"
    assert em.gate(r, mit_ecken_antippen=True) == "go-bedingt"


def test_flaeche_und_umfang_stimmen_mit_ground_truth() -> None:
    """Shoelace/Kanten reproduzieren die dokumentierten 1.56 m² / 5.6 m."""
    assert round(em.flaeche(GT_POLY), 2) == GT["raumflaeche_m2"] == 1.56
    assert round(sum(em.kantenlaengen(GT_POLY)), 2) == GT["umfang_m"] == 5.6


def test_perturbation_wird_als_fehler_erkannt() -> None:
    """Eine um 5 cm verschobene Ecke → max-Wandfehler ~5 cm, Median klein."""
    gestoert = list(GT_POLY)
    gestoert[1] = (gestoert[1][0] + 0.05, gestoert[1][1])  # Ecke [1,0] → [1.05,0]
    r = em.evaluate(GT, est_polygon=gestoert)
    assert 4.9 <= r["wandlaengen_fehler_max_cm"] <= 5.1
    assert r["wandlaengen_fehler_median_cm"] < 1.0
    assert r["raumflaechen_fehler_pct"] > 0.0


def test_kantenzahl_mismatch_wird_gemeldet() -> None:
    """Falsche Eckenzahl (z.B. Rechteck statt L) → kein stiller Fehlwert."""
    rechteck = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.8), (0.0, 1.8)]
    wl = em.wandlaengen_fehler_cm(rechteck, GT_POLY)
    assert wl["median_cm"] is None
    assert wl.get("kanten_mismatch") is True


def test_objekt_recall_und_verpasst() -> None:
    """3 von 4 GT-Objekten erkannt (Spiegel verpasst) → Recall 75 %."""
    r = em.evaluate(GT, erkannte_labels=["a toilet", "a sink", "door", "a window"])
    assert r["objekt_recall_pct"] == 75.0
    assert r["objekt_detail"]["verpasst"] == ["mirror"]


def _run() -> None:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"ok  {t.__name__}")
    print(f"\n{len(tests)} Tests grün.")


if __name__ == "__main__":
    _run()
