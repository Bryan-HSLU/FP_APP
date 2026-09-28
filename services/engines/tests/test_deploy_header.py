"""Deploy-Verdrahtung (Vercel → HF-Space): Cache-Header + PWA-Manifest-MIME-Typ.

Deckt beide Betriebsarten ab (direkt & unter /api gemountet), weil Starlette bei
einem gemounteten Sub-App `request.url.path` NICHT auf den Mount abschneidet –
nur `scope["root_path"]` wird gesetzt (siehe Kommentar bei der Middleware in
`api.py`). Ein Test nur im direkten Betrieb hätte das nicht abgedeckt.
"""

import mimetypes
from pathlib import Path
from urllib.parse import quote

from fastapi.testclient import TestClient

from fp_engines.api import app as api_app

REPO_ROOT = Path(__file__).resolve().parents[3]
BAD_BILDER = REPO_ROOT / "data" / "images" / "bad"


def _echte_bilddatei_mit_leerzeichen() -> str:
    """Eine echte Datei unter data/images/bad/ mit Leerzeichen im Namen (Kodier-Test)."""
    treffer = sorted(p.name for p in BAD_BILDER.glob("*") if p.is_file() and " " in p.name)
    assert treffer, "erwartet mindestens eine Bilddatei mit Leerzeichen im Namen"
    return treffer[0]


DATEINAME = _echte_bilddatei_mit_leerzeichen()


def test_direkt_health_hat_no_store() -> None:
    res = TestClient(api_app).get("/health")
    assert res.status_code == 200
    assert res.headers["cache-control"] == "no-store"


def test_direkt_bild_hat_kein_no_store() -> None:
    res = TestClient(api_app).get(f"/bilder/bad/{quote(DATEINAME)}")
    assert res.status_code == 200
    assert res.headers.get("cache-control") != "no-store"


def test_gemountet_health_hat_no_store() -> None:
    from fp_engines.space import app as space_app

    res = TestClient(space_app).get("/api/health")
    assert res.status_code == 200
    assert res.headers["cache-control"] == "no-store"


def test_gemountet_bild_hat_kein_no_store() -> None:
    from fp_engines.space import app as space_app

    res = TestClient(space_app).get(f"/api/bilder/bad/{quote(DATEINAME)}")
    assert res.status_code == 200
    assert res.headers.get("cache-control") != "no-store"


def test_webmanifest_mime_typ() -> None:
    """space.py registriert den MIME-Typ beim Import (sonst application/octet-stream)."""
    import fp_engines.space  # noqa: F401 - Import löst die Registrierung aus

    assert mimetypes.guess_type("x.webmanifest")[0] == "application/manifest+json"
