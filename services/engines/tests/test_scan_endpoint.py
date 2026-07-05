"""POST /scan – Scan-Bundle (vorberechnetes layout.txt) → Raummodell (Fahrplan §4).

Beweist die Naht bis zur API-Grenze: hochgeladenes SpatialLM-Layout des R1-WC
ergibt dasselbe Ground-Truth-Polygon wie der Adapter-Unit-Test, und das Ergebnis
ist schema-valide (also direkt im Klickpfad /solve verwendbar).
"""

import io
import json
import zipfile
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

from fp_engines.api import app

client = TestClient(app)

REPO_ROOT = Path(__file__).resolve().parents[3]
SCAN_FIXTURES = REPO_ROOT / "packages" / "shared" / "fixtures" / "scan"
SCHEMAS = REPO_ROOT / "packages" / "shared" / "schemas"
ARTEFAKTE = REPO_ROOT / "packages" / "shared" / "fixtures" / "artefakte"


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


_REGISTRY = Registry().with_resources(
    (f.name, Resource.from_contents(_load(f))) for f in SCHEMAS.glob("*.schema.json")
)


def _layout_bytes() -> bytes:
    return (SCAN_FIXTURES / "r1-wc.layout.txt").read_bytes()


def test_scan_layout_txt_ergibt_r1_geometrie() -> None:
    resp = client.post(
        "/scan",
        files={"bundle": ("layout.txt", _layout_bytes(), "text/plain")},
        data={"roomType": "bad", "name": "R1-WC (Scan)"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    room = body["room"]
    fixture = _load(ARTEFAKTE / "raummodell.r1-wc.json")
    assert room["shell"]["floor"]["polygon"] == fixture["shell"]["floor"]["polygon"]
    assert room["roomType"] == "bad"

    schema = _load(SCHEMAS / "raummodell.schema.json")
    Draft202012Validator(
        schema, registry=_REGISTRY, format_checker=FormatChecker()
    ).validate(room)
    # Scan liefert keine Anschlüsse → ehrliche Warnung an den Nutzer.
    assert any("Anschlüsse" in w for w in body["warnungen"])


def test_scan_zip_bundle_mit_poses() -> None:
    puffer = io.BytesIO()
    with zipfile.ZipFile(puffer, "w") as z:
        z.writestr("layout.txt", _layout_bytes())
        z.writestr("poses.json", (SCAN_FIXTURES / "r1-wc.poses.json").read_bytes())
    resp = client.post(
        "/scan",
        files={"bundle": ("bundle.zip", puffer.getvalue(), "application/zip")},
        data={"roomType": "bad"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["room"]["shell"]["floor"]["area"] == 1.56


def test_scan_ungueltige_poses_warnt_bricht_nicht_ab() -> None:
    puffer = io.BytesIO()
    with zipfile.ZipFile(puffer, "w") as z:
        z.writestr("layout.txt", _layout_bytes())
        z.writestr("poses.json", b"{kein json")
    resp = client.post(
        "/scan",
        files={"bundle": ("bundle.zip", puffer.getvalue(), "application/zip")},
        data={"roomType": "bad"},
    )
    assert resp.status_code == 200, resp.text
    assert any("poses.json ignoriert" in w for w in resp.json()["warnungen"])


def test_scan_unbekannter_roomtype() -> None:
    resp = client.post(
        "/scan",
        files={"bundle": ("layout.txt", _layout_bytes(), "text/plain")},
        data={"roomType": "villa"},
    )
    assert resp.status_code == 400
    assert resp.json()["code"] == "SCAN_INVALID"


def test_scan_ohne_layout() -> None:
    resp = client.post(
        "/scan",
        files={"bundle": ("clip.mp4", b"\x00\x00\x00\x18ftyp", "video/mp4")},
        data={"roomType": "bad"},
    )
    assert resp.status_code == 400
    assert resp.json()["code"] == "SCAN_NO_LAYOUT"


def test_scan_kaputtes_layout() -> None:
    resp = client.post(
        "/scan",
        files={"bundle": ("layout.txt", b"wall_0=Wall(1,2,3)", "text/plain")},
        data={"roomType": "bad"},
    )
    assert resp.status_code == 400
    assert resp.json()["code"] == "SCAN_INVALID"
