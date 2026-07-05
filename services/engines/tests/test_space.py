"""Space-Verdrahtung (space.py): Engines unter /api, Bild-Static weiterhin erreichbar."""

from fastapi.testclient import TestClient

from fp_engines.space import REPO_ROOT, app

client = TestClient(app)


def test_health_unter_api() -> None:
    """Die Engines-Routen sind unter dem gemounteten Präfix /api erreichbar."""
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_bilder_bleiben_unter_api_bilder_erreichbar() -> None:
    """api.py mountet /bilder auf sich selbst; unter /api landet das bei /api/bilder/..."""
    bad_dir = REPO_ROOT / "data" / "images" / "bad"
    erste_datei = sorted(p.name for p in bad_dir.iterdir() if p.is_file())[0]

    res = client.get(f"/api/bilder/bad/{erste_datei}")

    assert res.status_code == 200
