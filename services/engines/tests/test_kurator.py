"""Kurator-Port: Erdung, Validierung, Repair, Fallback – mit gemocktem LLM."""

import json
from pathlib import Path
from typing import Any

import httpx
import pytest

from fp_engines.kurator import BaselineKurator, LlmKurator, _validiere, vorfilter

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURES = REPO_ROOT / "packages" / "shared" / "fixtures" / "artefakte"


def _load(name: str) -> Any:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


ROOM = _load("raummodell.bad-sample.json")
CATALOG = json.loads((REPO_ROOT / "data" / "catalog" / "bad.json").read_text())
PROFIL = _load("stilprofil.beispiel.json")


def test_vorfilter_slots_und_budget() -> None:
    slots = vorfilter(PROFIL, ROOM, CATALOG, budget=None)
    assert {"wc", "lavabo", "dusche"} <= set(slots)
    # Budget filtert teure Items aus den Kandidaten
    slots_budget = vorfilter(PROFIL, ROOM, CATALOG, budget=1000)
    assert "dusche" not in slots_budget  # Dusche kostet 1800


def test_baseline_deterministisch_und_valide() -> None:
    a = BaselineKurator().kuratiere(PROFIL, ROOM, CATALOG, None, seed=3)
    b = BaselineKurator().kuratiere(PROFIL, ROOM, CATALOG, None, seed=3)
    assert a == b
    slots = vorfilter(PROFIL, ROOM, CATALOG, None)
    assert _validiere(a, slots, "bad", None) is None


def test_validierung_lehnt_fremde_ids_ab() -> None:
    slots = vorfilter(PROFIL, ROOM, CATALOG, None)
    fehler = _validiere({"auswahl": ["99999999-0000-4000-8000-000000000000"]}, slots, "bad", None)
    assert fehler is not None and "ausserhalb" in fehler


def _llm_mit_antworten(monkeypatch: pytest.MonkeyPatch, antworten: list[Any]) -> LlmKurator:
    """LLM-Port mit gestubbtem HTTP: gibt die Antworten der Reihe nach zurück."""
    rest = list(antworten)

    def fake_post(url: str, **kwargs: Any) -> httpx.Response:
        inhalt = rest.pop(0)
        if isinstance(inhalt, Exception):
            raise inhalt
        body = {"choices": [{"message": {"content": json.dumps(inhalt)}}]}
        return httpx.Response(200, json=body, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "post", fake_post)
    return LlmKurator(url="http://test/v1", model="test", api_key=None)


def test_llm_gueltige_antwort_wird_uebernommen(monkeypatch: pytest.MonkeyPatch) -> None:
    gueltig = {
        "auswahl": [c["id"] for c in CATALOG if c["priorityClass"] == "P1"],
        "relationaleAbsichten": [],
        "begruendung": "Test",
    }
    port = _llm_mit_antworten(monkeypatch, [gueltig])
    assert port.kuratiere(PROFIL, ROOM, CATALOG, None, seed=1) == gueltig


def test_llm_repair_retry_korrigiert(monkeypatch: pytest.MonkeyPatch) -> None:
    schlecht = {"auswahl": ["99999999-0000-4000-8000-000000000000"]}
    gut = {
        "auswahl": [c["id"] for c in CATALOG if c["priorityClass"] == "P1"],
        "relationaleAbsichten": [],
        "begruendung": "korrigiert",
    }
    port = _llm_mit_antworten(monkeypatch, [schlecht, gut])
    assert port.kuratiere(PROFIL, ROOM, CATALOG, None, seed=1)["begruendung"] == "korrigiert"


def test_llm_fallback_auf_baseline(monkeypatch: pytest.MonkeyPatch) -> None:
    """Zweimal ungültig (nach Repair) → Baseline; der Nutzer bekommt IMMER ein Set."""
    schlecht = {"auswahl": ["99999999-0000-4000-8000-000000000000"]}
    port = _llm_mit_antworten(monkeypatch, [schlecht, schlecht])
    ergebnis = port.kuratiere(PROFIL, ROOM, CATALOG, None, seed=1)
    assert "CURATOR_FALLBACK_USED" in ergebnis["begruendung"]
    assert ergebnis["auswahl"]


def test_llm_http_fehler_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    port = _llm_mit_antworten(monkeypatch, [httpx.ConnectError("down")])
    ergebnis = port.kuratiere(PROFIL, ROOM, CATALOG, None, seed=1)
    assert "CURATOR_FALLBACK_USED" in ergebnis["begruendung"]
