"""Mini-Eval Kurations-Qualität (Kurator-Mechanik-Detailkonzept, Gate).

Festes Testset: 3 Stilprofile (zwei Extreme + mittig-unentschieden) × Raumtyp
Bad. Metriken: Validität (nach Repair), Stil-Treue (cos Profil↔Auswahl),
Diversität (distinkte Sets über 5 Seeds). Vergleich LLM vs. Baseline.

Gate: Schlägt der Kurator die Baseline NICHT, bleibt die Baseline aktiv –
Architektur identisch (Port), kein Umbau. Ohne FP_KURATOR_URL wird nur die
Baseline gemessen (= aktueller Stand des Gates).

Aufruf: uv run python scripts/kurator_eval.py   (aus services/engines/)
"""

import json
import os
from pathlib import Path
from typing import Any

from fp_engines.kurator import BaselineKurator, KuratorPort, stil_score, waehle_port

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURES = REPO_ROOT / "packages" / "shared" / "fixtures" / "artefakte"

ROOM = json.loads((FIXTURES / "raummodell.bad-sample.json").read_text(encoding="utf-8"))
CATALOG = json.loads((REPO_ROOT / "data" / "catalog" / "bad.json").read_text(encoding="utf-8"))

PROFILE = {
    "warm-natuerlich (extrem)": {
        "styleVector": {"temperatur": 0.9, "materialitaet": 0.9, "farbigkeit": 0.5},
        "derivedRequirements": [],
        "palette": ["#3a5a40"],
    },
    "kuehl-minimal (extrem)": {
        "styleVector": {"temperatur": -0.9, "opulenz": -0.9, "epoche": 0.9},
        "derivedRequirements": [],
        "palette": ["#f5f5f5"],
    },
    "mittig-unentschieden": {
        "styleVector": {"temperatur": 0.1, "opulenz": -0.1},
        "derivedRequirements": [],
        "palette": [],
    },
}
SEEDS = range(1, 6)


def _miss(port: KuratorPort) -> dict[str, Any]:
    by_id = {c["id"]: c for c in CATALOG}
    gueltig = 0
    laeufe = 0
    treue: list[float] = []
    sets: set[str] = set()
    for profil in PROFILE.values():
        for seed in SEEDS:
            antwort = port.kuratiere(profil, ROOM, CATALOG, None, seed)
            laeufe += 1
            if antwort.get("auswahl"):
                gueltig += 1
                scores = [stil_score(profil, by_id[i]) for i in antwort["auswahl"]]
                treue.append(sum(scores) / len(scores))
                sets.add(json.dumps(sorted(antwort["auswahl"])))
    return {
        "validitaet_pct": round(100 * gueltig / laeufe, 1),
        "stil_treue_mittel": round(sum(treue) / len(treue), 3) if treue else 0.0,
        "diversitaet_sets": len(sets),
        "laeufe": laeufe,
    }


def main() -> None:
    baseline = _miss(BaselineKurator())
    zeilen = [("baseline", baseline)]
    if os.environ.get("FP_KURATOR_URL"):
        zeilen.append(("llm-api", _miss(waehle_port())))
    else:
        print("Hinweis: FP_KURATOR_URL nicht gesetzt → nur Baseline gemessen.\n")

    print("| Port | Validität % | Stil-Treue (cos) | Diversität (Sets) | Läufe |")
    print("|---|---|---|---|---|")
    for name, m in zeilen:
        print(
            f"| {name} | {m['validitaet_pct']} | {m['stil_treue_mittel']} "
            f"| {m['diversitaet_sets']} | {m['laeufe']} |"
        )
    if len(zeilen) == 2:
        llm = zeilen[1][1]
        schlaegt = (
            llm["stil_treue_mittel"] >= baseline["stil_treue_mittel"]
            and llm["diversitaet_sets"] > baseline["diversitaet_sets"]
        )
        print(f"\nGate: {'✅ LLM schlägt Baseline' if schlaegt else '❌ Baseline bleibt aktiv'}")
    else:
        print("\nGate-Stand: Baseline aktiv (kein LLM konfiguriert).")


if __name__ == "__main__":
    main()
