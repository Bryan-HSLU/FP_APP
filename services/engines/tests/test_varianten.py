"""K-Varianten (generate-and-select) – Kurator-Pipeline v3, Welle 5.

Beweist: (1) Determinismus – gleicher Input + seed ⇒ identische Wahl + identisches
varianteInfo; (2) best ≥ single – die gewählte Variante ist nie schlechter als
Variante 0 (= Basis-seed); (3) jede Variante hat 0 ❌ (Solver-Invariante).
"""

import json
from pathlib import Path
from typing import Any

from fp_engines.baseline import baseline_auswahl
from fp_engines.solver import solve
from fp_engines.varianten import _SUBSEED_XOR, K_VARIANTEN, loese_mit_varianten

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURES = REPO_ROOT / "packages" / "shared" / "fixtures" / "artefakte"


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _rules(room_type: str) -> Any:
    return _load(REPO_ROOT / "data" / "rules" / "basis.json") + _load(
        REPO_ROOT / "data" / "rules" / f"{room_type}.json"
    )


def _catalog(room_type: str) -> Any:
    return _load(REPO_ROOT / "data" / "catalog" / f"{room_type}.json")


WOHNEN = _load(FIXTURES / "raummodell.wohnen-sample.json")
WOHNEN_CATALOG = _catalog("wohnen")
WOHNEN_RULES = _rules("wohnen")


def _loese(seed: int) -> tuple[dict[str, Any], dict[str, Any]]:
    sel = baseline_auswahl(WOHNEN, WOHNEN_CATALOG)
    return loese_mit_varianten(
        WOHNEN,
        sel["auswahl"],
        sel["relationaleAbsichten"],
        WOHNEN_CATALOG,
        WOHNEN_RULES,
        seed=seed,
        anordnung=sel.get("anordnung"),
        created_at="2026-06-11T12:00:00Z",
    )


def test_variante_0_nutzt_basis_seed() -> None:
    """Sub-Seed-Ableitung: Index 0 = Basis-seed (macht «best ≥ single» wörtlich)."""
    assert _SUBSEED_XOR[0] == 0x0
    _, info = _loese(7)
    assert info["varianten"][0]["seed"] == 7
    assert info["anzahl"] == K_VARIANTEN


def test_determinismus_identische_wahl_und_info() -> None:
    """2× gleicher Aufruf ⇒ byte-identischer Plan UND identisches varianteInfo."""
    plan_a, info_a = _loese(3)
    plan_b, info_b = _loese(3)
    assert plan_a == plan_b
    assert info_a == info_b
    assert 0 <= info_a["gewaehlt"] < K_VARIANTEN


def test_best_mindestens_so_gut_wie_variante_0() -> None:
    """Die gewählte Variante hat ein Score-Tupel ≥ Variante 0 (Selektion maximiert).

    Ausnahme (dokumentiert, Welle D): greift die Begehbarkeits-Leiter, wird die
    beste BEGEHBARE Variante geliefert – dann garantiert der Eintrag
    `begehbarkeit` in varianteInfo die Nachvollziehbarkeit statt des Tupels."""
    _, info = _loese(5)
    g = info["gewaehlt"]

    def _tupel(v: dict[str, Any]) -> tuple[int, int, float]:
        # (platziert, −knapp, relationScore) – höher = besser (wie in varianten._bewerte).
        return (v["platziert"], -v["knapp"], v["relationScore"])

    if "begehbarkeit" in info:
        assert info["begehbarkeit"]["massnahme"] in {"andere-variante", "reduktion", "hinweis"}
    else:
        assert _tupel(info["varianten"][g]) >= _tupel(info["varianten"][0])


def test_jede_variante_hat_0_verletzt() -> None:
    """0-❌-Invariante je Variante: alle K Sub-Seed-Läufe sind normkonform."""
    sel = baseline_auswahl(WOHNEN, WOHNEN_CATALOG)
    for x in _SUBSEED_XOR:
        plan = solve(
            WOHNEN,
            sel["auswahl"],
            sel["relationaleAbsichten"],
            WOHNEN_CATALOG,
            WOHNEN_RULES,
            seed=17 ^ x,
            anordnung=sel.get("anordnung"),
            created_at="2026-06-11T12:00:00Z",
        )
        assert plan["constraintReport"]["hard"]["summary"]["verletzt"] == 0
    best, _ = _loese(17)
    assert best["constraintReport"]["hard"]["summary"]["verletzt"] == 0


def test_variante_0_gleich_baseline_solve() -> None:
    """Variante 0 (Basis-seed) entspricht einem einzelnen solve(seed) – 0 Läufe extra
    für den Nicht-Varianten-Pfad, gleiche Signale (Überlebensrate/Knappheit)."""
    sel = baseline_auswahl(WOHNEN, WOHNEN_CATALOG)
    single = solve(
        WOHNEN,
        sel["auswahl"],
        sel["relationaleAbsichten"],
        WOHNEN_CATALOG,
        WOHNEN_RULES,
        seed=9,
        anordnung=sel.get("anordnung"),
        created_at="2026-06-11T12:00:00Z",
    )
    _, info = _loese(9)
    v0 = info["varianten"][0]
    assert v0["platziert"] == len(single["placements"])
    assert v0["knapp"] == single["constraintReport"]["hard"]["summary"]["knapp"]
