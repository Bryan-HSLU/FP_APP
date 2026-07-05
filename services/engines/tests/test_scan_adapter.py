"""Scan-Vertrags-Naht: SpatialLM-Layout → Raummodell (Fahrplan Schritt 1).

Kernbeweis: Das handgebaute R1-WC-Layout (z-up) ergibt nach dem Adapter EXAKT
die Geometrie des Ground-Truth-Fixtures `raummodell.r1-wc.json` – damit ist die
Achsabbildung (z-up→y-up, kein Spiegel) und die Normierung festgenagelt.
"""

import json
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

from fp_engines.generated.raummodell import Raummodell
from fp_engines.scan import (
    AdapterFehler,
    PosenFehler,
    layout_to_raummodell,
    parse_layout,
    parse_posen,
)
from fp_engines.scan.spatiallm import LayoutParseFehler, SpatialLmLayout

REPO_ROOT = Path(__file__).resolve().parents[3]
SCHEMAS = REPO_ROOT / "packages" / "shared" / "schemas"
SCAN_FIXTURES = REPO_ROOT / "packages" / "shared" / "fixtures" / "scan"
ARTEFAKTE = REPO_ROOT / "packages" / "shared" / "fixtures" / "artefakte"


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


_REGISTRY = Registry().with_resources(
    (f.name, Resource.from_contents(_load(f))) for f in SCHEMAS.glob("*.schema.json")
)


def _layout_text() -> str:
    return (SCAN_FIXTURES / "r1-wc.layout.txt").read_text(encoding="utf-8")


def _raummodell() -> dict[str, Any]:
    return layout_to_raummodell(parse_layout(_layout_text()), name="R1-WC (Scan)", room_type="bad")


def test_layout_parsen() -> None:
    layout = parse_layout(_layout_text())
    assert len(layout.walls) == 6
    assert len(layout.doors) == 1
    assert len(layout.windows) == 1
    assert len(layout.bboxes) == 1
    assert layout.bboxes[0].label == "toilet"
    assert layout.walls[0].height == 2.4


def test_layout_kaputte_zeile() -> None:
    with pytest.raises(LayoutParseFehler):
        parse_layout("wall_0=Wall(1,2,3)")  # zu wenige Zahlen
    with pytest.raises(LayoutParseFehler):
        parse_layout("irgendwas ohne format")


def test_adapter_geometrie_gleich_r1_fixture() -> None:
    """Der Contract-Beweis: gleiche Hülle wie die Ground Truth (Fahrplan §1)."""
    modell = _raummodell()
    fixture = _load(ARTEFAKTE / "raummodell.r1-wc.json")
    assert modell["shell"]["floor"]["polygon"] == fixture["shell"]["floor"]["polygon"]
    assert modell["shell"]["floor"]["area"] == pytest.approx(1.56)
    assert len(modell["shell"]["walls"]) == 6
    assert modell["shell"]["ceiling"]["height"] == 2.4


def test_adapter_schema_und_pydantic_valide() -> None:
    modell = _raummodell()
    schema = _load(SCHEMAS / "raummodell.schema.json")
    Draft202012Validator(
        schema, registry=_REGISTRY, format_checker=FormatChecker()
    ).validate(modell)
    Raummodell.model_validate(modell)


def test_adapter_openings() -> None:
    modell = _raummodell()
    tuer = next(o for o in modell["openings"] if o["type"] == "door")
    fenster = next(o for o in modell["openings"] if o["type"] == "window")
    wand_ids = {w["id"] for w in modell["shell"]["walls"]}

    assert tuer["width"] == 0.7 and tuer["sill"] == 0.0
    assert tuer["offset"] == pytest.approx(0.55)
    assert fenster["offset"] == pytest.approx(0.25)
    assert fenster["sill"] == pytest.approx(1.1)  # Zentrum 1.5 − Höhe/2
    assert {tuer["hostWall"], fenster["hostWall"]} <= wand_ids
    # Rückverweis: Host-Wand kennt ihre Öffnung
    hosts = {
        oid for w in modell["shell"]["walls"] for oid in w.get("openings", [])
    }
    assert {tuer["id"], fenster["id"]} <= hosts


def test_adapter_objekt() -> None:
    obj = _raummodell()["objects"][0]
    assert obj["label"] == "toilet"
    assert obj["pose"]["pos"] == [0.35, 1.5]
    assert obj["pose"]["yawDeg"] == 0.0
    assert obj["geometry"]["bbox"] == {"w": 0.37, "d": 0.6, "h": 0.4}
    assert obj["needsReview"] is True and obj["movable"] is True


def test_adapter_deterministisch() -> None:
    a, b = _raummodell(), _raummodell()
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


def test_adapter_segmentreihenfolge_egal() -> None:
    """Wände dürfen ungeordnet/umgedreht ankommen – die Hülle schliesst trotzdem."""
    layout = parse_layout(_layout_text())
    w = list(layout.walls)
    w[2], w[4] = w[4], w[2]
    w3 = w[3]
    gedreht = type(w3)(w3.id, w3.bx, w3.by, w3.bz, w3.ax, w3.ay, w3.az, w3.height, w3.thickness)
    w[3] = gedreht
    modell = layout_to_raummodell(
        SpatialLmLayout(walls=w, doors=[], windows=[], bboxes=[]), name="R1-WC (Scan)"
    )
    erwartet = {tuple(p) for p in _raummodell()["shell"]["floor"]["polygon"]}
    assert {tuple(p) for p in modell["shell"]["floor"]["polygon"]} == erwartet
    assert modell["shell"]["floor"]["area"] == pytest.approx(1.56)


def test_adapter_offene_huelle_ehrlich() -> None:
    layout = parse_layout(_layout_text())
    kaputt = SpatialLmLayout(walls=layout.walls[:-1], doors=[], windows=[], bboxes=[])
    with pytest.raises(AdapterFehler, match="nicht geschlossen"):
        layout_to_raummodell(kaputt, name="kaputt")


def test_posen_fixture_valide() -> None:
    posen = parse_posen((SCAN_FIXTURES / "r1-wc.poses.json").read_text(encoding="utf-8"))
    assert posen.source == "arkit"
    assert len(posen.frames) == 3
    assert posen.frames[0].t < posen.frames[-1].t


def test_posen_fehler() -> None:
    basis: dict[str, Any] = _load(SCAN_FIXTURES / "r1-wc.poses.json")

    zu_wenig = {**basis, "frames": basis["frames"][:1]}
    with pytest.raises(PosenFehler, match="2 Frames"):
        parse_posen(zu_wenig)

    unsortiert = {**basis, "frames": [basis["frames"][1], basis["frames"][0], basis["frames"][2]]}
    with pytest.raises(PosenFehler, match="monoton"):
        parse_posen(unsortiert)

    krummes_quat = {**basis["frames"][1], "quaternion": [1, 1, 0, 0]}
    schief = {**basis, "frames": [basis["frames"][0], krummes_quat]}
    with pytest.raises(PosenFehler, match="normiert"):
        parse_posen(schief)
