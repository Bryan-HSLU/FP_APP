from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from fp_engines.api import app


def test_health() -> None:
    res = TestClient(app).get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_health_build_env_override(monkeypatch: pytest.MonkeyPatch) -> None:
    """FP_BUILD_SHA hat Vorrang vor der BUILD_SHA-Datei."""
    monkeypatch.setenv("FP_BUILD_SHA", "abc123")
    res = TestClient(app).get("/health")
    assert res.json()["build"] == "abc123"


def test_health_build_dev_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ohne Env-Variable und ohne BUILD_SHA-Datei im Repo-Root → "dev"."""
    monkeypatch.delenv("FP_BUILD_SHA", raising=False)
    # REPO_ROOT selbst umbiegen (statt die echte BUILD_SHA im Repo anzufassen),
    # damit der Test unabhängig davon ist, ob lokal/im Space eine Datei liegt.
    monkeypatch.setattr("fp_engines.api.REPO_ROOT", Path("/nonexistent-repo-root"))
    res = TestClient(app).get("/health")
    assert res.json()["build"] == "dev"


def test_health_build_from_file(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """Ohne Env-Variable, aber mit BUILD_SHA-Datei im (umgebogenen) Repo-Root."""
    monkeypatch.delenv("FP_BUILD_SHA", raising=False)
    (tmp_path / "BUILD_SHA").write_text("def456\n", encoding="utf-8")
    monkeypatch.setattr("fp_engines.api.REPO_ROOT", tmp_path)
    res = TestClient(app).get("/health")
    assert res.json()["build"] == "def456"
