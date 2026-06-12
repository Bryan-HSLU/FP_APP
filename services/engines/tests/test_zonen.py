"""Zonen-Ableitung (M6 Phase A): Grossraum → Teilraum je Zone.

Beweist, dass aus dem Grossraum-Sample ein eigenständiges, schema-valides
Küchen-Raummodell entsteht, auf dem Solver/Interpreter unverändert laufen.
"""

import json
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

from fp_engines.zonen import zone_room

REPO_ROOT = Path(__file__).resolve().parents[3]
SCHEMAS = REPO_ROOT / "packages" / "shared" / "schemas"
FIXTURES = REPO_ROOT / "packages" / "shared" / "fixtures" / "artefakte"

GROSSRAUM = "raummodell.grossraum-sample.json"
KUECHE_ZONE = "aaaa0001-3000-4000-8000-000000003001"


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


_REGISTRY = Registry().with_resources(
    (f.name, Resource.from_contents(_load(f))) for f in SCHEMAS.glob("*.schema.json")
)


def _raummodell_validator() -> Draft202012Validator:
    schema = _load(SCHEMAS / "raummodell.schema.json")
    return Draft202012Validator(schema, registry=_REGISTRY, format_checker=FormatChecker())


def _grossraum() -> dict[str, Any]:
    return _load(FIXTURES / GROSSRAUM)


def test_teilraum_schema_valide() -> None:
    teil = zone_room(_grossraum(), KUECHE_ZONE)
    errors = [f"{e.json_path}: {e.message}" for e in _raummodell_validator().iter_errors(teil)]
    assert errors == []


def test_floor_polygon_ist_zonen_polygon() -> None:
    room = _grossraum()
    teil = zone_room(room, KUECHE_ZONE)
    zone = next(z for z in room["zones"] if z["id"] == KUECHE_ZONE)
    assert teil["shell"]["floor"]["polygon"] == [list(p) for p in zone["polygon"]]
    # Küchenzone 2.8 × 4.5 = 12.6 m²
    assert teil["shell"]["floor"]["area"] == 12.6


def test_roomtype_und_name() -> None:
    teil = zone_room(_grossraum(), KUECHE_ZONE)
    assert teil["roomType"] == "kueche"
    assert "Küche" in teil["name"]


def test_nur_kuechen_fixpunkte() -> None:
    room = _grossraum()
    teil = zone_room(room, KUECHE_ZONE)
    # Alle 5 Fixpunkte gehören der Küchenzone; Typen vollständig übernommen.
    typen = sorted(fp["type"] for fp in teil["fixpoints"])
    assert typen == ["abwasser", "elektro", "lueftung", "starkstrom", "wasser"]
    assert all(fp.get("zone") == KUECHE_ZONE for fp in teil["fixpoints"])


def test_offene_zonengrenze_nicht_montierbar() -> None:
    """Die Zonengrenze (x = 2.8) ist im Sample explizit `offen` → Solver montiert
    nichts daran (kind != massiv). Die Kante bleibt also non-massiv."""
    teil = zone_room(_grossraum(), KUECHE_ZONE)
    grenze = [
        w for w in teil["shell"]["walls"] if w["start"][0] == 2.8 and w["end"][0] == 2.8
    ]
    assert len(grenze) == 1
    assert grenze[0]["kind"] == "offen"


def test_virtuelle_kante_wenn_keine_huellenwand() -> None:
    """Zonenkante OHNE deckende Hüllenwand → synthetisch `virtuell` (geschlossen,
    aber nichts montierbar). Hier: dieselbe Zone, aber ohne die offene Kante im
    Sample – die Grenze muss dann virtuell synthetisiert werden."""
    room = _grossraum()
    room["shell"]["walls"] = [
        w for w in room["shell"]["walls"] if not (w["start"][0] == 2.8 and w["end"][0] == 2.8)
    ]
    teil = zone_room(room, KUECHE_ZONE)
    virtuell = [w for w in teil["shell"]["walls"] if w["kind"] == "virtuell"]
    assert len(virtuell) == 1
    assert virtuell[0]["start"][0] == 2.8 and virtuell[0]["end"][0] == 2.8


def test_massive_stirnwand_erhalten() -> None:
    """Die Anschlusswand der Küchenzone (Hüllen-Stirnwand x = 0) bleibt massiv."""
    teil = zone_room(_grossraum(), KUECHE_ZONE)
    massiv = [w for w in teil["shell"]["walls"] if w["kind"] == "massiv"]
    # Stirnwand x = 0 muss dabei sein (trägt die Fixpunkte der Küchenzeile)
    assert any(w["start"][0] == 0 and w["end"][0] == 0 for w in massiv)
    # Hülle bleibt geschlossen: 4 Kanten total (3 massiv + 1 offen)
    assert len(teil["shell"]["walls"]) == 4


def test_reine_funktion() -> None:
    room = _grossraum()
    vorher = json.dumps(room, sort_keys=True)
    zone_room(room, KUECHE_ZONE)
    assert json.dumps(room, sort_keys=True) == vorher
