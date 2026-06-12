"""M6 Phase B – Küchen-Solver: Formwahl + lineare Baugruppe.

Beweist: (1) Formwahl filtert/rankt korrekt (Insel ausgeschlossen, Anschlusswand
enthalten, Stil verschiebt das Ranking), (2) die lineare Baugruppe ist über
Profile/Seeds/Räume normkonform (0 ❌), schema-valide, deterministisch und hält
die Slot-Regeln (GS neben Spüle, Kochfeld-Abstand, eine Assembly je Zeile,
Rasterabstände), (3) der Grossraum wird über die Zone geplant.
"""

import json
import math
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator, FormatChecker

from fp_engines.kueche import formwahl, solve_kueche
from fp_engines.zonen import zone_room

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURES = REPO_ROOT / "packages" / "shared" / "fixtures" / "artefakte"
SCHEMAS = REPO_ROOT / "packages" / "shared" / "schemas"

KUECHE_ZONE = "aaaa0001-3000-4000-8000-000000003001"
GRID = {"ch": 0.55, "eu": 0.60}


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


CATALOG = _load(REPO_ROOT / "data" / "catalog" / "kueche.json")
RULES = _load(REPO_ROOT / "data" / "rules" / "basis.json") + _load(
    REPO_ROOT / "data" / "rules" / "kueche.json"
)
BY_ID = {c["id"]: c for c in CATALOG}
PLAN_VALIDATOR = Draft202012Validator(
    _load(SCHEMAS / "plan.schema.json"), format_checker=FormatChecker()
)


def _kueche() -> dict[str, Any]:
    return _load(FIXTURES / "raummodell.kueche-sample.json")


def _grossraum_zone() -> dict[str, Any]:
    return zone_room(_load(FIXTURES / "raummodell.grossraum-sample.json"), KUECHE_ZONE)


def _typ(p: dict[str, Any]) -> str:
    return BY_ID[p["catalogItemId"]]["funktionsTyp"]


def _pos_je_typ(plan: dict[str, Any]) -> dict[str, list[list[float]]]:
    out: dict[str, list[list[float]]] = {}
    for p in plan["placements"]:
        out.setdefault(_typ(p), []).append(p["pose"]["pos"])
    return out


# --- Formwahl ---------------------------------------------------------------- #


def test_formwahl_insel_ausgeschlossen_kleiner_raum() -> None:
    """3.2 × 2.6 m ohne Boden-Fixpunkt → keine Insel; I/L/Galley plausibel."""
    formen = formwahl(_kueche(), None, "ch")
    namen = {f["form"] for f in formen}
    assert "insel" not in namen
    assert namen <= {"i", "l", "u", "galley"}
    assert len(formen) <= 3


def test_formwahl_anschlusswand_in_jeder_topform() -> None:
    """Harte Bedingung: die Anschlusswand (Wasser/Abwasser) ist in jeder Form."""
    room = _kueche()
    formen = formwahl(room, None, "ch")
    # Anschlusswand = Wand mit den Wasser-Fixpunkten (y = 2.6).
    anker = "cccccccc-2003-4000-8000-000000002003"
    for f in formen:
        assert anker in f["anchorWallIds"], f


def test_formwahl_stil_verschiebt_ranking() -> None:
    """«geborgen» (U/Galley) hebt die geborgenen Formen, «offen» senkt sie –
    das Ranking reagiert auf das Stilprofil (im kleinen Raum ohne Insel
    verschiebt sich die Reihenfolge, nicht zwingend zu einer offenen Form)."""
    room = _kueche()
    geborgen = {"styleVector": {"raumgefuehl": -0.9, "opulenz": -0.4}}
    offen = {"styleVector": {"raumgefuehl": 0.9, "opulenz": 0.6, "epoche": 0.7}}
    g = {f["form"]: f["score"] for f in formwahl(room, geborgen, "ch")}
    o = {f["form"]: f["score"] for f in formwahl(room, offen, "ch")}
    # Galley (geborgen) rankt unter «geborgen» höher als unter «offen».
    assert g.get("galley", 0) > o.get("galley", 0)


# --- Lineare Baugruppe: Property-Test --------------------------------------- #

RAEUME = [("kueche", _kueche), ("grossraum", _grossraum_zone)]


@pytest.mark.parametrize(("name", "raum_fn"), RAEUME)
@pytest.mark.parametrize("norm", ["ch", "eu"])
@pytest.mark.parametrize("seed", range(6))
def test_baugruppe_invariante_und_schema(
    name: str, raum_fn: Any, norm: str, seed: int
) -> None:
    raum = raum_fn()
    plan = solve_kueche(raum, CATALOG, RULES, form="i", norm_profile=norm, seed=seed)
    # 0 ❌ (Solver-Invariante)
    assert plan["constraintReport"]["hard"]["summary"]["verletzt"] == 0
    assert plan["constraintReport"]["hard"]["ok"] is True
    # schema-valide (inkl. assemblies)
    errors = [f"{e.json_path}: {e.message}" for e in PLAN_VALIDATOR.iter_errors(plan)]
    assert errors == []
    assert plan["assemblies"][0]["type"] == "kuechenzeile"
    assert plan["meta"]["normProfile"] == norm


@pytest.mark.parametrize("norm", ["ch", "eu"])
def test_baugruppe_deterministisch(norm: str) -> None:
    a = solve_kueche(_kueche(), CATALOG, RULES, form="i", norm_profile=norm, seed=4)
    b = solve_kueche(_kueche(), CATALOG, RULES, form="i", norm_profile=norm, seed=4)
    assert json.dumps(a["placements"]) == json.dumps(b["placements"])


@pytest.mark.parametrize("norm", ["ch", "eu"])
def test_gs_grenzt_an_spuele_und_kochfeld_abstand(norm: str) -> None:
    grid = GRID[norm]
    plan = solve_kueche(_kueche(), CATALOG, RULES, form="i", norm_profile=norm, seed=1)
    pos = _pos_je_typ(plan)
    sp, gs, kf = pos["spuele"][0], pos["geschirrspueler"][0], pos["kochfeld"][0]

    def dist(a: list[float], b: list[float]) -> float:
        return math.hypot(a[0] - b[0], a[1] - b[1])

    # GS direkt neben Spüle (genau ein Rasterschritt)
    assert dist(sp, gs) <= grid + 1e-3
    # Kochfeld ↔ Spüle ≥ 1 Slot «Vorbereiten» (≥ 0.6 m Slotabstand)
    assert dist(sp, kf) >= 0.6 - 1e-6


def test_eine_assembly_id_je_zeile() -> None:
    plan = solve_kueche(_kueche(), CATALOG, RULES, form="i", norm_profile="ch", seed=1)
    aid = plan["assemblies"][0]["id"]
    # Alle Zeilen-Placements (nicht Deko) teilen dieselbe Assembly-ID.
    for p in plan["placements"]:
        if _typ(p) in ("deko", "pflanze"):
            continue
        assert p.get("assembly") == aid


def test_rasterpositionen_konsistent() -> None:
    """Korpus-Slots liegen auf einem gemeinsamen Raster: die Zentren der
    Unterschrank-/Geräte-Slots haben paarweise Abstände, die Vielfache von grid
    sind (Füllstücke füllen den Rest auf eigenem Feinraster und sind ausgenommen)."""
    grid = 0.55
    plan = solve_kueche(_kueche(), CATALOG, RULES, form="i", norm_profile="ch", seed=1)
    # Korpus-Slots der I-Form (Anschlusswand y = 2.6): nur x variiert.
    korpus = {"spuele", "geschirrspueler", "kochfeld", "kuehlschrank", "hochschrank",
              "unterschrank"}
    xs = sorted(
        p["pose"]["pos"][0]
        for p in plan["placements"]
        if p.get("assembly") and _typ(p) in korpus
    )
    assert len(xs) >= 3
    for a, b in zip(xs, xs[1:], strict=False):
        k = round((b - a) / grid)
        assert abs((b - a) - k * grid) < 1e-2, (a, b, b - a)


@pytest.mark.parametrize(("norm", "variante"), [("ch", "ch55"), ("eu", "eu60")])
def test_normvariante_im_plan(norm: str, variante: str) -> None:
    plan = solve_kueche(_kueche(), CATALOG, RULES, form="i", norm_profile=norm, seed=1)
    varianten = {
        BY_ID[p["catalogItemId"]].get("normProfileVariante")
        for p in plan["placements"]
        if BY_ID[p["catalogItemId"]].get("normProfileVariante")
    }
    assert varianten == {variante}


def test_grossraum_placements_in_zonen_polygon() -> None:
    """Im Grossraum-Teilraum liegen alle Placements in der Küchenzone (x ≤ 2.8)."""
    zr = _grossraum_zone()
    plan = solve_kueche(zr, CATALOG, RULES, form="i", norm_profile="ch", seed=1)
    assert all(p["pose"]["pos"][0] <= 2.8 + 1e-6 for p in plan["placements"])


def test_seed_variation() -> None:
    """«Variante würfeln»: verschiedene Seeds liefern verschiedene Pläne."""
    posen = {
        json.dumps([p["pose"] for p in solve_kueche(
            _kueche(), CATALOG, RULES, form="i", norm_profile="ch", seed=s
        )["placements"]])
        for s in range(6)
    }
    assert len(posen) > 1
