"""Erzeugt die goldenen Reports für den Regel-Paritätstest (bewusster Akt!).

Läuft den PYTHON-Interpreter über die Paritäts-Fälle und schreibt die
erwarteten constraintReports nach packages/shared/fixtures/rule-parity/expected/.
Der Paritätstest prüft danach BEIDE Interpreter gegen diese Goldens – die
TS-Seite muss identisch urteilen, sonst ist die Parität verletzt.

Aufruf: uv run python scripts/update_goldens.py   (aus services/engines/)
Nur ausführen, wenn sich Regeln/Interpreter-Semantik bewusst geändert haben;
Diff der Goldens gehört in denselben Commit wie die Interpreter-Änderung.
"""

import json
from pathlib import Path

from fp_engines.rules import build_scene, evaluate_rules

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURES = REPO_ROOT / "packages" / "shared" / "fixtures"
DATA_RULES = REPO_ROOT / "data" / "rules"


def load(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    cases = load(FIXTURES / "rule-parity" / "cases.json")
    out_dir = FIXTURES / "rule-parity" / "expected"
    out_dir.mkdir(exist_ok=True)
    assert isinstance(cases, list)
    for case in cases:
        room = load(FIXTURES / "artefakte" / f"{case['room']}.json")
        plan = load(FIXTURES / "artefakte" / f"{case['plan']}.json")
        catalog = load(FIXTURES / "artefakte" / f"{case['catalog']}.json")
        rules: list[dict[str, object]] = []
        for ruleset in case["rules"]:
            loaded = load(DATA_RULES / f"{ruleset}.json")
            assert isinstance(loaded, list)
            rules.extend(loaded)
        report = evaluate_rules(build_scene(room, plan, catalog), rules)  # type: ignore[arg-type]
        target = out_dir / f"{case['name']}.json"
        target.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"✅ {target.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
