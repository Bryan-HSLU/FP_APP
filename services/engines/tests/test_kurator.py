"""Kurator-Pipeline v2: Erdung + je-Call Validierung/Repair/Fallback (gemocktes LLM).

Drei entkoppelte Calls (Auswahl/Anordnung/Flächen): das gestubbte HTTP gibt die
Antworten der Reihe nach zurück, sodass jeder Call gezielt gültig/ungültig/mit
Repair oder Exception bedient werden kann.
"""

import json
from pathlib import Path
from typing import Any

import httpx
import pytest

from fp_engines.kurator import (
    MATERIAL_SLUGS,
    BaselineKurator,
    LlmKurator,
    _validiere,
    _validiere_anordnung,
    _validiere_flaechen,
    vorfilter,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURES = REPO_ROOT / "packages" / "shared" / "fixtures" / "artefakte"


def _load(name: str) -> Any:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


ROOM = _load("raummodell.bad-sample.json")
CATALOG = json.loads((REPO_ROOT / "data" / "catalog" / "bad.json").read_text())
PROFIL = _load("stilprofil.beispiel.json")
N_WALLS = len(ROOM["shell"]["walls"])
P1_IDS = [c["id"] for c in CATALOG if c["priorityClass"] == "P1"]


def _auswahl_ok(begruendung: str = "Test") -> dict[str, Any]:
    return {"auswahl": P1_IDS, "begruendung": begruendung}


def _anordnung_ok() -> dict[str, Any]:
    return {
        "anordnung": [
            {"itemId": P1_IDS[0], "wandIndex": 0, "relationen": ["against-wall"], "prioritaet": 1}
        ]
    }


def _flaechen_ok() -> dict[str, Any]:
    return {
        "flaechen": {
            "boden": {"material": MATERIAL_SLUGS[0]},
            "waende": [{"wandIndex": 0, "material": MATERIAL_SLUGS[0], "bereich": "voll"}],
        }
    }


# --- Vorfilter / Baseline ---------------------------------------------------


def test_vorfilter_slots_und_budget() -> None:
    slots = vorfilter(PROFIL, ROOM, CATALOG, budget=None)
    assert {"wc", "lavabo", "dusche"} <= set(slots)
    slots_budget = vorfilter(PROFIL, ROOM, CATALOG, budget=1000)
    assert "dusche" not in slots_budget  # Dusche kostet 1800


def test_baseline_deterministisch_und_valide() -> None:
    a = BaselineKurator().kuratiere(PROFIL, ROOM, CATALOG, None, seed=3)
    b = BaselineKurator().kuratiere(PROFIL, ROOM, CATALOG, None, seed=3)
    assert a == b
    slots = vorfilter(PROFIL, ROOM, CATALOG, None)
    assert _validiere(a, slots, "bad", None) is None


def test_baseline_liefert_anordnung_und_flaechen_none() -> None:
    """Neue Felder: anordnung (aus relationalRules, prioritaet nach Klasse), flaechen=None."""
    a = BaselineKurator().kuratiere(PROFIL, ROOM, CATALOG, None, seed=1)
    assert a["flaechen"] is None
    assert isinstance(a["anordnung"], list) and a["anordnung"]
    ids = {e["itemId"] for e in a["anordnung"]}
    assert ids == set(a["auswahl"])
    assert all("prioritaet" in e for e in a["anordnung"])
    # Antwort-Shape kompatibel: relationaleAbsichten = flach aus anordnung.
    assert _validiere_anordnung(a, a["auswahl"], N_WALLS) is None


# --- Validierung je Call ----------------------------------------------------


def test_validierung_lehnt_fremde_ids_ab() -> None:
    slots = vorfilter(PROFIL, ROOM, CATALOG, None)
    fehler = _validiere({"auswahl": ["99999999-0000-4000-8000-000000000000"]}, slots, "bad", None)
    assert fehler is not None and "ausserhalb" in fehler


def test_validiere_anordnung_gueltig() -> None:
    assert _validiere_anordnung(_anordnung_ok(), P1_IDS, N_WALLS) is None


def test_validiere_anordnung_fremde_id() -> None:
    schlecht = {"anordnung": [{"itemId": "99999999-0000-4000-8000-000000000000"}]}
    fehler = _validiere_anordnung(schlecht, P1_IDS, N_WALLS)
    assert fehler is not None and "ausserhalb der Auswahl" in fehler


def test_validiere_anordnung_wandindex_ausserhalb() -> None:
    schlecht = {"anordnung": [{"itemId": P1_IDS[0], "wandIndex": N_WALLS}]}
    fehler = _validiere_anordnung(schlecht, P1_IDS, N_WALLS)
    assert fehler is not None and "wandIndex" in fehler


def test_validiere_anordnung_fehlt() -> None:
    assert _validiere_anordnung({}, P1_IDS, N_WALLS) is not None


def test_validiere_flaechen_gueltig() -> None:
    assert _validiere_flaechen(_flaechen_ok(), N_WALLS, MATERIAL_SLUGS) is None


def test_validiere_flaechen_unbekannter_slug() -> None:
    schlecht = {"flaechen": {"boden": {"material": "gold-glitzer"}}}
    fehler = _validiere_flaechen(schlecht, N_WALLS, MATERIAL_SLUGS)
    assert fehler is not None and "Slug-Liste" in fehler


def test_validiere_flaechen_hoehe_ausserhalb() -> None:
    schlecht = {
        "flaechen": {"waende": [{"wandIndex": 0, "material": MATERIAL_SLUGS[0], "hoeheM": 9.0}]}
    }
    fehler = _validiere_flaechen(schlecht, N_WALLS, MATERIAL_SLUGS)
    assert fehler is not None and "hoeheM" in fehler


# --- LLM-Pipeline (3 Calls) -------------------------------------------------


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


def test_llm_pipeline_alle_calls_gueltig(monkeypatch: pytest.MonkeyPatch) -> None:
    port = _llm_mit_antworten(monkeypatch, [_auswahl_ok(), _anordnung_ok(), _flaechen_ok()])
    ergebnis = port.kuratiere(PROFIL, ROOM, CATALOG, None, seed=1)
    assert ergebnis["auswahl"] == P1_IDS
    assert ergebnis["anordnung"] == _anordnung_ok()["anordnung"]
    assert ergebnis["flaechen"] == _flaechen_ok()["flaechen"]
    # relationaleAbsichten flach aus der anordnung abgeleitet.
    assert ergebnis["relationaleAbsichten"] == [{"itemId": P1_IDS[0], "relation": "against-wall"}]


def test_llm_auswahl_repair(monkeypatch: pytest.MonkeyPatch) -> None:
    schlecht = {"auswahl": ["99999999-0000-4000-8000-000000000000"]}
    port = _llm_mit_antworten(
        monkeypatch, [schlecht, _auswahl_ok("korrigiert"), _anordnung_ok(), _flaechen_ok()]
    )
    ergebnis = port.kuratiere(PROFIL, ROOM, CATALOG, None, seed=1)
    assert ergebnis["begruendung"].startswith("korrigiert")
    assert ergebnis["flaechen"] == _flaechen_ok()["flaechen"]


def test_llm_auswahl_fallback_alles_baseline(monkeypatch: pytest.MonkeyPatch) -> None:
    """Call A zweimal ungültig → komplette Baseline (B/C brauchen die Auswahl)."""
    schlecht = {"auswahl": ["99999999-0000-4000-8000-000000000000"]}
    port = _llm_mit_antworten(monkeypatch, [schlecht, schlecht])
    ergebnis = port.kuratiere(PROFIL, ROOM, CATALOG, None, seed=1)
    assert "CURATOR_FALLBACK_USED" in ergebnis["begruendung"]
    assert ergebnis["auswahl"]
    assert ergebnis["flaechen"] is None


def test_llm_teilfallback_anordnung(monkeypatch: pytest.MonkeyPatch) -> None:
    """Nur Call B scheitert → Baseline-Anordnung, Auswahl+Flächen bleiben vom LLM."""
    schlecht = {"anordnung": [{"itemId": "99999999-0000-4000-8000-000000000000"}]}
    port = _llm_mit_antworten(monkeypatch, [_auswahl_ok(), schlecht, schlecht, _flaechen_ok()])
    ergebnis = port.kuratiere(PROFIL, ROOM, CATALOG, None, seed=1)
    assert "CURATOR_ANORDNUNG_FALLBACK" in ergebnis["begruendung"]
    assert "CURATOR_FALLBACK_USED" not in ergebnis["begruendung"]
    assert ergebnis["auswahl"] == P1_IDS
    assert ergebnis["flaechen"] == _flaechen_ok()["flaechen"]
    # Baseline-Anordnung deckt genau die Auswahl ab.
    assert {e["itemId"] for e in ergebnis["anordnung"]} == set(P1_IDS)


def test_llm_teilfallback_flaechen(monkeypatch: pytest.MonkeyPatch) -> None:
    """Nur Call C scheitert → flaechen=None, Rest vom LLM."""
    schlecht = {"flaechen": {"boden": {"material": "gold-glitzer"}}}
    port = _llm_mit_antworten(monkeypatch, [_auswahl_ok(), _anordnung_ok(), schlecht, schlecht])
    ergebnis = port.kuratiere(PROFIL, ROOM, CATALOG, None, seed=1)
    assert "CURATOR_FLAECHEN_FALLBACK" in ergebnis["begruendung"]
    assert ergebnis["flaechen"] is None
    assert ergebnis["anordnung"] == _anordnung_ok()["anordnung"]


def test_llm_http_fehler_auswahl_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    port = _llm_mit_antworten(monkeypatch, [httpx.ConnectError("down")])
    ergebnis = port.kuratiere(PROFIL, ROOM, CATALOG, None, seed=1)
    assert "CURATOR_FALLBACK_USED" in ergebnis["begruendung"]


def test_llm_http_fehler_anordnung_teilfallback(monkeypatch: pytest.MonkeyPatch) -> None:
    """HTTP-Fehler in Call B → Teil-Fallback Anordnung, Flächen laufen weiter."""
    port = _llm_mit_antworten(
        monkeypatch, [_auswahl_ok(), httpx.ConnectError("down"), _flaechen_ok()]
    )
    ergebnis = port.kuratiere(PROFIL, ROOM, CATALOG, None, seed=1)
    assert "CURATOR_ANORDNUNG_FALLBACK" in ergebnis["begruendung"]
    assert ergebnis["flaechen"] == _flaechen_ok()["flaechen"]
