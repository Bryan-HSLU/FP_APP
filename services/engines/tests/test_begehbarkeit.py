"""Begehbarkeit hart am Planende (Weg «hart am Ende») + ehrliche softScores (Welle D).

Property ⭐: **jeder gelieferte Plan** (bad/wohnen über `solve_begehbar` bzw.
`loese_mit_varianten`, Küche über `solve_kueche`) hat eine begehbare
circulation ODER trägt den sichtbaren Reduktions-Hinweis im Report – und
behält dabei die 0-❌-Invariante. Die circulation-Regel selbst bleibt im
Regel-JSON soft (Parität/Goldens unberührt, Begründung in fp_engines.solver).

softScore stil/relation: vom Solver echt befüllt (Muster Küchen-Ergonomie),
deterministisch, diskriminierend (erfüllt/unerfüllt), dokumentierte Bereiche.
"""

import json
from pathlib import Path
from typing import Any

import pytest

import fp_engines.solver as solver_mod
from fp_engines.baseline import baseline_auswahl
from fp_engines.kueche import formwahl, solve_kueche
from fp_engines.solver import (
    baue_rel_map,
    circulation_verletzt,
    reduzierte_auswahl,
    softscore_relation,
    solve,
    solve_begehbar,
)
from fp_engines.varianten import loese_mit_varianten

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


def _hat_hinweis(plan: dict[str, Any]) -> bool:
    return any(
        "BEGEHBARKEIT" in (res.get("hinweis") or "")
        for res in plan["constraintReport"]["results"]
    )


def _begehbar_oder_hinweis(plan: dict[str, Any], rules: list[dict[str, Any]]) -> bool:
    """Die Liefer-Garantie: circulation nicht verletzt ODER sichtbarer Hinweis."""
    return not circulation_verletzt(plan["constraintReport"], rules) or _hat_hinweis(plan)


# --- Property ⭐: jeder gelieferte Plan ist begehbar oder ehrlich markiert ----

_RAEUME = [
    ("raummodell.bad-sample", "bad"),
    ("raummodell.bad-gross", "bad"),
    ("raummodell.r1-wc", "bad"),
    ("raummodell.wohnen-sample", "wohnen"),
    ("raummodell.wohnen-lang", "wohnen"),
]


@pytest.mark.parametrize(("room_name", "room_type"), _RAEUME)
@pytest.mark.parametrize("seed", range(6))
def test_property_begehbar_oder_hinweis(room_name: str, room_type: str, seed: int) -> None:
    room = _load(FIXTURES / f"{room_name}.json")
    catalog = _catalog(room_type)
    rules = _rules(room_type)
    sel = baseline_auswahl(room, catalog)
    plan = solve_begehbar(
        room,
        sel["auswahl"],
        sel["relationaleAbsichten"],
        catalog,
        rules,
        seed=seed,
        anordnung=sel.get("anordnung"),
        created_at="2026-07-15T12:00:00Z",
    )
    # 0-❌-Invariante bleibt (circulation ist soft, zählt nie in hard.summary).
    assert plan["constraintReport"]["hard"]["summary"]["verletzt"] == 0
    assert _begehbar_oder_hinweis(plan, rules)


@pytest.mark.parametrize("room_name", ["raummodell.kueche-sample", "raummodell.kueche-gross"])
@pytest.mark.parametrize("seed", range(4))
def test_property_kueche_begehbar_oder_hinweis(room_name: str, seed: int) -> None:
    room = _load(FIXTURES / f"{room_name}.json")
    catalog = _catalog("kueche")
    rules = _rules("kueche")
    top = formwahl(room, None, "ch")
    plan = solve_kueche(
        room,
        catalog,
        rules,
        form=top[0]["form"] if top else "i",
        norm_profile="ch",
        seed=seed,
        created_at="2026-07-15T12:00:00Z",
    )
    assert plan["constraintReport"]["hard"]["summary"]["verletzt"] == 0
    assert _begehbar_oder_hinweis(plan, rules)


@pytest.mark.parametrize("seed", range(6))
def test_property_varianten_begehbar_oder_hinweis(seed: int) -> None:
    """K-Varianten-Pfad: Leiter (andere Variante → Reduktion → Hinweis) liefert
    begehbar-oder-markiert; die Massnahme steht additiv in varianteInfo."""
    room = _load(FIXTURES / "raummodell.wohnen-sample.json")
    catalog = _catalog("wohnen")
    rules = _rules("wohnen")
    sel = baseline_auswahl(room, catalog)
    plan, info = loese_mit_varianten(
        room,
        sel["auswahl"],
        sel["relationaleAbsichten"],
        catalog,
        rules,
        seed=seed,
        anordnung=sel.get("anordnung"),
        created_at="2026-07-15T12:00:00Z",
    )
    assert plan["constraintReport"]["hard"]["summary"]["verletzt"] == 0
    assert _begehbar_oder_hinweis(plan, rules)
    beg = info.get("begehbarkeit")
    if beg is not None:
        assert beg["massnahme"] in {"andere-variante", "reduktion", "hinweis"}
        # «andere-variante» liefert wirklich eine begehbare Variante.
        if beg["massnahme"] == "andere-variante":
            assert not circulation_verletzt(plan["constraintReport"], rules)


def test_determinismus_begehbarkeits_leiter() -> None:
    """Gleicher Input + seed ⇒ gleiche Leiter ⇒ byte-identischer Plan (beide Pfade)."""
    room = _load(FIXTURES / "raummodell.wohnen-sample.json")
    catalog = _catalog("wohnen")
    rules = _rules("wohnen")
    sel = baseline_auswahl(room, catalog)

    def _direkt() -> dict[str, Any]:
        return solve_begehbar(
            room, sel["auswahl"], sel["relationaleAbsichten"], catalog, rules,
            seed=0, anordnung=sel.get("anordnung"), created_at="2026-07-15T12:00:00Z",
        )

    def _varianten() -> tuple[dict[str, Any], dict[str, Any]]:
        return loese_mit_varianten(
            room, sel["auswahl"], sel["relationaleAbsichten"], catalog, rules,
            seed=0, anordnung=sel.get("anordnung"), created_at="2026-07-15T12:00:00Z",
        )

    assert _direkt() == _direkt()
    assert _varianten() == _varianten()


def test_hinweis_bei_unloesbarem_bestands_engpass() -> None:
    """Echter unfixbarer Fall: eine Bestands-Trennwand (room.objects) pincht den
    Korridor zwischen zwei Türen – keine Reduktion kann helfen (nichts zu
    reduzieren) ⇒ der Plan kommt MIT sichtbarem Hinweis, statt still verletzt."""
    room = _load(FIXTURES / "raummodell.flur-test.json")
    room["objects"].append(
        {
            "id": "99990009-4000-8000-0000-000000000009",
            "label": "trennwand-bestand",
            "geometry": {"repr": "bbox", "bbox": {"w": 1.8, "d": 0.4, "h": 2.0}},
            "pose": {"pos": [1.2, 1.2], "yawDeg": 0},
            "movable": False,
            "confidence": 1.0,
        }
    )
    rules = _load(REPO_ROOT / "data" / "rules" / "basis.json")
    plan = solve_begehbar(room, [], [], [], rules, seed=1, created_at="2026-07-15T12:00:00Z")
    assert circulation_verletzt(plan["constraintReport"], rules)  # ehrlich: bleibt verletzt
    assert _hat_hinweis(plan)
    assert plan["constraintReport"]["hard"]["summary"]["verletzt"] == 0


def test_reduktion_liefert_reduzierten_plan_ohne_hinweis(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Leiter-Mechanik isoliert: meldet der Check den vollen Plan als verletzt und
    den reduzierten als ok, liefert solve_begehbar den REDUZIERTEN Plan (ohne das
    letzte reduzierbare Item) und ohne Hinweis."""
    room = _load(FIXTURES / "raummodell.wohnen-sample.json")
    catalog = _catalog("wohnen")
    rules = _rules("wohnen")
    sel = baseline_auswahl(room, catalog)
    by_id = {c["id"]: c for c in catalog}
    red = reduzierte_auswahl(sel["auswahl"], None, by_id, 1)
    assert red is not None
    entfernt = set(sel["auswahl"]) - set(red[0])
    assert len(entfernt) == 1

    aufrufe = {"n": 0}

    def fake_verletzt(report: dict[str, Any], rules_: list[dict[str, Any]]) -> bool:
        aufrufe["n"] += 1
        return aufrufe["n"] == 1  # voller Plan «verletzt», erster Re-Solve ok

    monkeypatch.setattr(solver_mod, "circulation_verletzt", fake_verletzt)
    plan = solver_mod.solve_begehbar(
        room, sel["auswahl"], sel["relationaleAbsichten"], catalog, rules,
        seed=1, anordnung=sel.get("anordnung"), created_at="2026-07-15T12:00:00Z",
    )
    assert aufrufe["n"] >= 2
    ids = {p["catalogItemId"] for p in plan["placements"]}
    assert not (ids & entfernt)
    assert not _hat_hinweis(plan)


def test_reduzierte_auswahl_mechanik() -> None:
    """Reduktion entfernt vom ENDE nur P3-/Ergänzungs-Items OHNE ankerTyp;
    verankerte Ergänzungen (Stühle) und der Kern bleiben; erschöpft ⇒ None."""
    catalog = _catalog("wohnen")
    by_id = {c["id"]: c for c in catalog}
    sofa = next(c["id"] for c in catalog if c["funktionsTyp"] == "sofa")
    stuhl = next(c["id"] for c in catalog if c["funktionsTyp"] == "stuhl")  # ankerTyp esstisch
    pflanze = next(c["id"] for c in catalog if c["funktionsTyp"] == "pflanze")  # P3, frei
    teppich = next(c["id"] for c in catalog if c["funktionsTyp"] == "teppich")  # P3, frei
    auswahl = [sofa, stuhl, pflanze, teppich]

    red1 = reduzierte_auswahl(auswahl, {stuhl: 4}, by_id, 1)
    assert red1 is not None
    assert red1[0] == [sofa, stuhl, pflanze]  # letztes freies P3 (teppich) fällt
    assert red1[1] == {stuhl: 4}  # mengen unbeteiligter Items bleiben

    red2 = reduzierte_auswahl(auswahl, None, by_id, 2)
    assert red2 is not None
    assert red2[0] == [sofa, stuhl]  # Kern + verankerte Ergänzung unangetastet

    assert reduzierte_auswahl(auswahl, None, by_id, 3) is None  # erschöpft


def test_varianten_rangfolge_stabil_dokumentiert() -> None:
    """Rangfolge-Semantik unverändert: ist die Score-beste Variante begehbar,
    gibt es keinen begehbarkeit-Eintrag und gewaehlt == argmax des dokumentierten
    lexikografischen Tupels (platziert, −knapp, relationScore, −index)."""
    room = _load(FIXTURES / "raummodell.wohnen-sample.json")
    catalog = _catalog("wohnen")
    rules = _rules("wohnen")
    sel = baseline_auswahl(room, catalog)
    geprueft = 0
    for seed in range(8):
        _, info = loese_mit_varianten(
            room, sel["auswahl"], sel["relationaleAbsichten"], catalog, rules,
            seed=seed, anordnung=sel.get("anordnung"), created_at="2026-07-15T12:00:00Z",
        )
        if "begehbarkeit" in info:
            continue  # Leiter griff – hier zählt die Garantie, nicht die Rangfolge
        tupel = [
            (v["platziert"], -v["knapp"], v["relationScore"], -v["index"])
            for v in info["varianten"]
        ]
        assert info["gewaehlt"] == max(range(len(tupel)), key=lambda i: tupel[i])
        geprueft += 1
    assert geprueft > 0  # mindestens ein Seed ohne Leiter-Eingriff


# --- softScore stil/relation: echt befüllt, deterministisch, diskriminierend --

_PROFIL = {
    "styleVector": {"opulenz": -0.4, "epoche": 0.5, "raumgefuehl": 0.3},
    "derivedRequirements": [],
    "palette": [],
}


@pytest.mark.parametrize(
    ("room_name", "room_type"),
    [("raummodell.bad-sample", "bad"), ("raummodell.wohnen-sample", "wohnen")],
)
def test_softscore_bad_wohnen_echt_befuellt(room_name: str, room_type: str) -> None:
    """Mit Stilprofil + Baseline-Relationen sind stil/relation nicht mehr fix 0.0
    (der v3-Fund) – und deterministisch (zweiter Lauf byte-identisch)."""
    room = _load(FIXTURES / f"{room_name}.json")
    catalog = _catalog(room_type)
    rules = _rules(room_type)
    sel = baseline_auswahl(room, catalog)

    def _lauf() -> dict[str, Any]:
        return solve(
            room, sel["auswahl"], sel["relationaleAbsichten"], catalog, rules,
            seed=1, anordnung=sel.get("anordnung"), style_profile=_PROFIL,
            created_at="2026-07-15T12:00:00Z",
        )

    plan = _lauf()
    ss = plan["constraintReport"]["softScore"]
    assert ss["stil"] != 0.0  # mittlerer Stil-Cosinus der platzierten Items
    assert 0.0 < ss["relation"] <= 1.0  # Anteil erfüllter Baseline-Wünsche
    assert ss["ergonomie"] == 0.0  # bleibt Küchen-spezifisch
    assert plan == _lauf()  # Determinismus (inkl. softScore)


def test_softscore_relation_misst_erfuellung() -> None:
    """relation diskriminiert: erfüllter near-Wunsch 1.0, unerfüllter 0.0 –
    dieselbe Relations-Quelle wie der Solver (baue_rel_map, kein Drift)."""
    room = _load(FIXTURES / "raummodell.wohnen-sample.json")
    catalog = _catalog("wohnen")
    by_id = {c["id"]: c for c in catalog}
    sofa = next(c["id"] for c in catalog if c["funktionsTyp"] == "sofa")
    ct = next(c["id"] for c in catalog if c["funktionsTyp"] == "couchtisch")
    rel_map = baue_rel_map([{"itemId": ct, "relation": "near:sofa:0.5"}], None)
    floor = [(float(p[0]), float(p[1])) for p in room["shell"]["floor"]["polygon"]]

    def _pl(iid: str, pos: tuple[float, float]) -> dict[str, Any]:
        return {"catalogItemId": iid, "pose": {"pos": list(pos), "yawDeg": 0.0}}

    nah = [_pl(sofa, (1.0, 1.0)), _pl(ct, (1.3, 1.0))]
    fern = [_pl(sofa, (1.0, 1.0)), _pl(ct, (3.5, 3.0))]
    assert softscore_relation(nah, by_id, rel_map, floor) == 1.0
    assert softscore_relation(fern, by_id, rel_map, floor) == 0.0
    # Fehlender Anker (Typ nicht platziert) zählt als unerfüllt.
    assert softscore_relation([_pl(ct, (1.0, 1.0))], by_id, rel_map, floor) == 0.0


def test_softscore_ohne_profil_und_wuensche_dokumentierte_defaults() -> None:
    """Ohne Stilprofil ist stil ehrlich 0.0; ohne Relations-Wünsche ist relation
    vakuum-wahr 1.0 (dokumentierte Konvention, alle Raumtypen)."""
    room = _load(FIXTURES / "raummodell.wohnen-sample.json")
    catalog = _catalog("wohnen")
    rules = _rules("wohnen")
    sofa = next(c["id"] for c in catalog if c["funktionsTyp"] == "sofa")
    plan = solve(room, [sofa], [], catalog, rules, seed=1, created_at="2026-07-15T12:00:00Z")
    ss = plan["constraintReport"]["softScore"]
    assert ss["stil"] == 0.0
    assert ss["relation"] == 1.0


def test_softscore_kueche_stil_mit_profil() -> None:
    """Konsistenz über Raumtypen: auch der Küchen-Solver befüllt stil (und
    relation vakuum-wahr), ergonomie bleibt das gemessene Arbeitsdreieck."""
    room = _load(FIXTURES / "raummodell.kueche-sample.json")
    catalog = _catalog("kueche")
    rules = _rules("kueche")
    plan = solve_kueche(
        room, catalog, rules, form="i", norm_profile="ch", seed=2,
        style_profile=_PROFIL, created_at="2026-07-15T12:00:00Z",
    )
    ss = plan["constraintReport"]["softScore"]
    assert ss["stil"] != 0.0
    assert ss["relation"] == 1.0
    assert 0.0 < ss["ergonomie"] <= 1.0
