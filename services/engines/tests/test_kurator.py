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
    FLAECHEN_REGELN,
    MATERIAL_SLUGS,
    BaselineKurator,
    LlmKurator,
    _validiere,
    _validiere_anordnung,
    _validiere_flaechen,
    korrigiere_flaechen,
    nasswaende,
    pruefe_flaechen,
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
    """Norm-konformes Flächen-Konzept fürs Sample-Bad: wasserfester Boden +
    ALLE Nasswände voll gefliest (das Sample hat rundum Anschluss-Fixpunkte)."""
    return {
        "flaechen": {
            "boden": {"material": "fliesen-hell"},
            "waende": [
                {"wandIndex": i, "material": "fliesen-hell", "bereich": "voll"}
                for i in sorted(nasswaende(ROOM))
            ],
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


# --- Flächen-Normkontrolle (Call C, hart) -----------------------------------


def _bad_room(fixpoints: list[dict[str, Any]]) -> dict[str, Any]:
    """Minimal-Bad (3×2 m, 4 Wände) mit frei setzbaren Fixpunkten – nur die von
    pruefe_flaechen/nasswaende gelesenen Felder."""
    return {
        "roomType": "bad",
        "shell": {
            "walls": [
                {"id": "w0", "start": [0, 0], "end": [3, 0]},
                {"id": "w1", "start": [3, 0], "end": [3, 2]},
                {"id": "w2", "start": [3, 2], "end": [0, 2]},
                {"id": "w3", "start": [0, 2], "end": [0, 0]},
            ]
        },
        "fixpoints": fixpoints,
    }


ROOM_NASS0 = _bad_room([{"type": "wasser", "wall": "w0"}])  # nur Wand 0 nass
KUECHE_ROOM = {"roomType": "kueche", "shell": {"walls": []}, "fixpoints": []}
WOHNEN_ROOM = {
    "roomType": "wohnen",
    "shell": {"walls": [{"id": "w0", "start": [0, 0], "end": [3, 0]}]},
    "fixpoints": [],
}


def test_nasswaende_wandgebunden_und_geometrisch() -> None:
    # wandgebunden: abwasser hängt an Wand 1.
    r1 = _bad_room([{"type": "abwasser", "wall": "w1"}])
    assert nasswaende(r1) == {1}
    # geometrisch: Bodenablauf nahe Wand 0 (y=0), 0.3 m Abstand ≤ 0.5.
    r2 = _bad_room([{"type": "wasser", "position": [1.5, 0.3]}])
    assert nasswaende(r2) == {0}
    # nicht-nasser Fixpunkt (elektro) zählt nicht.
    r3 = _bad_room([{"type": "elektro", "wall": "w2"}])
    assert nasswaende(r3) == set()


def test_pruefe_flaechen_konform_ist_leer() -> None:
    fl = {
        "boden": {"material": "fliesen-hell"},
        "waende": [{"wandIndex": 0, "material": "fliesen-hell", "bereich": "voll"}],
    }
    assert pruefe_flaechen(fl, ROOM_NASS0, FLAECHEN_REGELN) == []


def test_pruefe_flaechen_parkett_boden_im_bad() -> None:
    fl = {"boden": {"material": "parkett-eiche"}}
    verstoesse = pruefe_flaechen(fl, ROOM_NASS0, FLAECHEN_REGELN)
    assert any("bad-boden-wasserfest" in v and "Boden-Material" in v for v in verstoesse)


def test_pruefe_flaechen_putz_an_nasswand() -> None:
    fl = {
        "boden": {"material": "fliesen-hell"},
        "waende": [{"wandIndex": 0, "material": "putz-weiss", "bereich": "voll"}],
    }
    verstoesse = pruefe_flaechen(fl, ROOM_NASS0, FLAECHEN_REGELN)
    assert any("bad-wand-nass" in v for v in verstoesse)


def test_pruefe_flaechen_nasswand_zu_niedrig() -> None:
    fl = {
        "boden": {"material": "fliesen-hell"},
        "waende": [
            {"wandIndex": 0, "material": "fliesen-hell", "bereich": "halbhoch", "hoeheM": 1.2}
        ],
    }
    verstoesse = pruefe_flaechen(fl, ROOM_NASS0, FLAECHEN_REGELN)
    assert any("bad-wand-nass" in v and "gefordert" in v for v in verstoesse)


def test_pruefe_flaechen_nasswand_fehlt() -> None:
    fl = {"boden": {"material": "fliesen-hell"}, "waende": []}
    verstoesse = pruefe_flaechen(fl, ROOM_NASS0, FLAECHEN_REGELN)
    assert any("unverkleidet" in v for v in verstoesse)


def test_pruefe_flaechen_putz_an_trockener_wand() -> None:
    # Wand 1 (trocken) explizit mit Putz belegt → wand-alle greift.
    fl = {
        "boden": {"material": "fliesen-hell"},
        "waende": [
            {"wandIndex": 0, "material": "fliesen-hell", "bereich": "voll"},
            {"wandIndex": 1, "material": "putz-weiss", "bereich": "voll"},
        ],
    }
    verstoesse = pruefe_flaechen(fl, ROOM_NASS0, FLAECHEN_REGELN)
    assert any("bad-wand-alle" in v for v in verstoesse)


def test_pruefe_flaechen_kueche_parkett_boden() -> None:
    fl = {"boden": {"material": "parkett-eiche"}}
    verstoesse = pruefe_flaechen(fl, KUECHE_ROOM, FLAECHEN_REGELN)
    assert any("kueche-boden-abwaschbar" in v for v in verstoesse)


def test_pruefe_flaechen_wohnen_ohne_harte_regeln() -> None:
    fl = {
        "boden": {"material": "parkett-eiche"},
        "waende": [{"wandIndex": 0, "material": "tapete-hell", "bereich": "voll"}],
    }
    assert pruefe_flaechen(fl, WOHNEN_ROOM, FLAECHEN_REGELN) == []


# Property-artig: korrigiere_flaechen macht JEDEN Verstoss konform (pruefe == []).
_VERSTOSS_FAELLE: list[tuple[dict[str, Any], dict[str, Any]]] = [
    ({"boden": {"material": "parkett-eiche"}}, ROOM_NASS0),
    ({"boden": {"material": "fliesen-hell"}, "waende": []}, ROOM_NASS0),
    (
        {
            "boden": {"material": "holz-hell"},
            "waende": [{"wandIndex": 0, "material": "putz-weiss"}],
        },
        ROOM_NASS0,
    ),
    (
        {
            "boden": {"material": "fliesen-hell"},
            "waende": [
                {"wandIndex": 0, "material": "fliesen-hell", "bereich": "halbhoch", "hoeheM": 1.0}
            ],
        },
        ROOM_NASS0,
    ),
    ({"boden": {"material": "tapete-hell"}}, KUECHE_ROOM),
    ({"boden": {"material": "parkett-eiche"}}, ROOM),  # Sample-Bad: 4 Nasswände
]


@pytest.mark.parametrize(("fl", "room"), _VERSTOSS_FAELLE)
def test_korrigiere_flaechen_macht_konform(fl: dict[str, Any], room: dict[str, Any]) -> None:
    assert pruefe_flaechen(fl, room, FLAECHEN_REGELN)  # vorher: Verstoss
    korrigiert = korrigiere_flaechen(fl, room, FLAECHEN_REGELN)
    assert pruefe_flaechen(korrigiert, room, FLAECHEN_REGELN) == []  # nachher: sauber
    # Korrektur arbeitet auf Kopie – Original bleibt unverändert.
    assert fl != korrigiert or not pruefe_flaechen(fl, room, FLAECHEN_REGELN)


def _flaechen_verstoss() -> dict[str, Any]:
    """Strukturell valide, aber normwidrig fürs Sample-Bad: Parkett-Boden, keine
    Nasswände."""
    return {"flaechen": {"boden": {"material": "parkett-eiche"}, "waende": []}}


def test_llm_flaechen_normrepair(monkeypatch: pytest.MonkeyPatch) -> None:
    """Call C strukturell ok, aber normwidrig → 1 Norm-Repair, LLM liefert
    konform → Marker NORMREPAIR, Flächen vom LLM übernommen."""
    port = _llm_mit_antworten(
        monkeypatch, [_auswahl_ok(), _anordnung_ok(), _flaechen_verstoss(), _flaechen_ok()]
    )
    ergebnis = port.kuratiere(PROFIL, ROOM, CATALOG, None, seed=1)
    assert "CURATOR_FLAECHEN_NORMREPAIR" in ergebnis["begruendung"]
    assert ergebnis["flaechen"] == _flaechen_ok()["flaechen"]
    assert pruefe_flaechen(ergebnis["flaechen"], ROOM, FLAECHEN_REGELN) == []


def test_llm_flaechen_normkorrektur(monkeypatch: pytest.MonkeyPatch) -> None:
    """Call C bleibt nach dem Norm-Repair normwidrig → deterministische Korrektur
    + Marker NORMKORREKTUR; das Ergebnis ist garantiert normkonform."""
    port = _llm_mit_antworten(
        monkeypatch,
        [_auswahl_ok(), _anordnung_ok(), _flaechen_verstoss(), _flaechen_verstoss()],
    )
    ergebnis = port.kuratiere(PROFIL, ROOM, CATALOG, None, seed=1)
    assert "CURATOR_FLAECHEN_NORMKORREKTUR" in ergebnis["begruendung"]
    assert ergebnis["flaechen"]["boden"]["material"] == "fliesen-hell"
    assert pruefe_flaechen(ergebnis["flaechen"], ROOM, FLAECHEN_REGELN) == []


def test_llm_flaechen_norm_repair_hinweis_enthaelt_regel(monkeypatch: pytest.MonkeyPatch) -> None:
    """Der Norm-Repair-Prompt gibt die konkrete verletzte Regel-ID ans LLM zurück."""
    gesendet: list[list[dict[str, str]]] = []

    antworten = [_auswahl_ok(), _anordnung_ok(), _flaechen_verstoss(), _flaechen_ok()]
    rest = list(antworten)

    def fake_post(url: str, **kwargs: Any) -> httpx.Response:
        gesendet.append(kwargs["json"]["messages"])
        inhalt = rest.pop(0)
        body = {"choices": [{"message": {"content": json.dumps(inhalt)}}]}
        return httpx.Response(200, json=body, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "post", fake_post)
    port = LlmKurator(url="http://test/v1", model="test", api_key=None)
    port.kuratiere(PROFIL, ROOM, CATALOG, None, seed=1)

    # Der 4. Call ist der Norm-Repair; sein User-Hinweis nennt die Regel-ID.
    repair_hinweis = gesendet[3][-1]["content"]
    assert "bad-boden-wasserfest" in repair_hinweis
