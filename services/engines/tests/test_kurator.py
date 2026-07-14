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
    _bereinige_farben,
    _extrahiere_ebenen,
    _footprint,
    _instanz_anzahl,
    _platz_budget,
    _validiere,
    _validiere_anordnung,
    _validiere_ebenen,
    _validiere_farben,
    _validiere_flaechen,
    anzahl_leitplanke,
    bewegungs_hinweise,
    korrigiere_flaechen,
    mengen_aus_antwort,
    nasswaende,
    norm_kontext_flaechen,
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


def _erstes(funktionsTyp: str) -> str:
    return next(c["id"] for c in CATALOG if c["funktionsTyp"] == funktionsTyp)


# P1-Pflicht-vollständige Minimal-Auswahl (je ein WC/Lavabo/Dusche) – hält das
# Platz-Budget ein (die volle P1_IDS-Liste würde es bewusst sprengen).
AUSWAHL_IDS = [_erstes("wc"), _erstes("lavabo"), _erstes("dusche")]


def _auswahl_ok(begruendung: str = "Test") -> dict[str, Any]:
    return {"auswahl": AUSWAHL_IDS, "begruendung": begruendung}


def _anordnung_ok() -> dict[str, Any]:
    return {
        "anordnung": [
            {
                "itemId": AUSWAHL_IDS[0],
                "wandIndex": 0,
                "relationen": ["against-wall"],
                "prioritaet": 1,
            }
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
    assert ergebnis["auswahl"] == AUSWAHL_IDS
    assert ergebnis["anordnung"] == _anordnung_ok()["anordnung"]
    assert ergebnis["flaechen"] == _flaechen_ok()["flaechen"]
    # relationaleAbsichten flach aus der anordnung abgeleitet.
    assert ergebnis["relationaleAbsichten"] == [
        {"itemId": AUSWAHL_IDS[0], "relation": "against-wall"}
    ]


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
    assert ergebnis["auswahl"] == AUSWAHL_IDS
    assert ergebnis["flaechen"] == _flaechen_ok()["flaechen"]
    # Baseline-Anordnung deckt genau die Auswahl ab.
    assert {e["itemId"] for e in ergebnis["anordnung"]} == set(AUSWAHL_IDS)


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


# --- Welle 1: Platz-Budget (harte Kontrolle in Call A) -----------------------


def test_validiere_platz_budget_ueberbelegung() -> None:
    """Boden-Items (WC/Dusche) sprengen ein künstlich kleines Platz-Budget →
    konkreter Fehlertext (beziffert Summe + Budget) durch den Repair."""
    slots = vorfilter(PROFIL, ROOM, CATALOG, None)
    fehler = _validiere({"auswahl": P1_IDS}, slots, "bad", None, platz_budget=1.0)
    assert fehler is not None and "Platz-Budget" in fehler


def test_platz_budget_guard_nie_unerfuellbar() -> None:
    """Unsatisfiability-Guard: selbst bei winziger Bodenfläche lässt das effektive
    Budget eine P1-Pflicht-vollständige Minimal-Auswahl zu (nie unerfüllbar)."""
    slots = vorfilter(PROFIL, ROOM, CATALOG, None)
    min_auswahl = [min(slots[typ], key=_footprint)["id"] for typ in ("wc", "lavabo", "dusche")]
    winzig = {**ROOM, "shell": {**ROOM["shell"], "floor": {"area": 0.1}}}
    eff = _platz_budget(winzig, slots, "bad")
    assert eff > 0.1  # Guard hat auf das Pflicht-Minimum angehoben.
    assert _validiere({"auswahl": min_auswahl}, slots, "bad", None, eff) is None


# --- Welle 1: Relations-Ziel-Validierung (Call B) ----------------------------

_BAD_TYPEN = {"wc", "lavabo", "dusche"}


def test_validiere_anordnung_relation_ziel_gut() -> None:
    gut = {"anordnung": [{"itemId": P1_IDS[0], "relationen": ["near:lavabo:0.5"]}]}
    assert _validiere_anordnung(gut, P1_IDS, N_WALLS, _BAD_TYPEN) is None


# --- Welle 3: Farbwahl (Call A, geerdet auf farbVarianten) -------------------

BY_ID = {c["id"]: c for c in CATALOG}
# Gültige Farben für die AUSWAHL_IDS: je erste (bzw. eine) Variante des Items.
FARBEN_GUELTIG = {iid: BY_ID[iid]["farbVarianten"][0] for iid in AUSWAHL_IDS}


def _auswahl_farben(farben: dict[str, str]) -> dict[str, Any]:
    return {"auswahl": AUSWAHL_IDS, "farben": farben, "begruendung": "Test"}


def test_validiere_farben_gueltig() -> None:
    assert _validiere_farben(FARBEN_GUELTIG, AUSWAHL_IDS, BY_ID) is None
    # Optional: fehlend ist ok (weiche Freiheit, keine Norm).
    assert _validiere_farben(None, AUSWAHL_IDS, BY_ID) is None


def test_validiere_farben_kein_objekt() -> None:
    fehler = _validiere_farben("weiss", AUSWAHL_IDS, BY_ID)
    assert fehler is not None and "Objekt" in fehler


def test_validiere_farben_fremde_id() -> None:
    fremd = {"99999999-0000-4000-8000-000000000000": "weiss"}
    fehler = _validiere_farben(fremd, AUSWAHL_IDS, BY_ID)
    assert fehler is not None and "ausserhalb der Auswahl" in fehler


def test_validiere_farben_fremde_variante() -> None:
    # bordeaux liegt nicht in den farbVarianten der Dusche (hellgrau/schwarz).
    fehler = _validiere_farben({AUSWAHL_IDS[2]: "bordeaux"}, AUSWAHL_IDS, BY_ID)
    assert fehler is not None and "farbVarianten" in fehler


def test_bereinige_farben_behaelt_nur_gueltige() -> None:
    gemischt = {
        AUSWAHL_IDS[0]: BY_ID[AUSWAHL_IDS[0]]["farbVarianten"][0],  # gültig
        AUSWAHL_IDS[2]: "bordeaux",  # ungültige Variante → raus
        "99999999-0000-4000-8000-000000000000": "weiss",  # fremde ID → raus
    }
    sauber = _bereinige_farben(gemischt, AUSWAHL_IDS, BY_ID)
    assert sauber == {AUSWAHL_IDS[0]: BY_ID[AUSWAHL_IDS[0]]["farbVarianten"][0]}


def test_llm_farben_durchgereicht(monkeypatch: pytest.MonkeyPatch) -> None:
    """Call A liefert gültige Farben → unverändert im Ergebnis, kein Repair."""
    port = _llm_mit_antworten(
        monkeypatch, [_auswahl_farben(FARBEN_GUELTIG), _anordnung_ok(), _flaechen_ok()]
    )
    ergebnis = port.kuratiere(PROFIL, ROOM, CATALOG, None, seed=1)
    assert ergebnis["farben"] == FARBEN_GUELTIG
    assert "CURATOR_FARBEN_BEREINIGT" not in ergebnis["begruendung"]


def test_llm_farben_repair(monkeypatch: pytest.MonkeyPatch) -> None:
    """Call A färbt eine fremde Variante → 1 Farb-Repair, LLM korrigiert →
    gültige Farben übernommen, kein Bereinigungs-Marker."""
    schlecht = _auswahl_farben({AUSWAHL_IDS[2]: "bordeaux"})
    farb_repair = {"farben": FARBEN_GUELTIG}
    port = _llm_mit_antworten(monkeypatch, [schlecht, farb_repair, _anordnung_ok(), _flaechen_ok()])
    ergebnis = port.kuratiere(PROFIL, ROOM, CATALOG, None, seed=1)
    assert ergebnis["farben"] == FARBEN_GUELTIG
    assert "CURATOR_FARBEN_BEREINIGT" not in ergebnis["begruendung"]
    assert ergebnis["auswahl"] == AUSWAHL_IDS


def test_llm_farben_bereinigt_statt_baseline(monkeypatch: pytest.MonkeyPatch) -> None:
    """Farb-Repair scheitert AUCH → NUR die Farben werden bereinigt (Rest behalten),
    die gültige Auswahl bleibt (kein kompletter Baseline-Fallback), Marker gesetzt."""
    schlecht = _auswahl_farben(
        {AUSWAHL_IDS[0]: BY_ID[AUSWAHL_IDS[0]]["farbVarianten"][0], AUSWAHL_IDS[2]: "bordeaux"}
    )
    port = _llm_mit_antworten(monkeypatch, [schlecht, schlecht, _anordnung_ok(), _flaechen_ok()])
    ergebnis = port.kuratiere(PROFIL, ROOM, CATALOG, None, seed=1)
    assert "CURATOR_FARBEN_BEREINIGT" in ergebnis["begruendung"]
    assert "CURATOR_FALLBACK_USED" not in ergebnis["begruendung"]
    assert ergebnis["auswahl"] == AUSWAHL_IDS
    # Nur der gültige Farb-Eintrag überlebt.
    assert ergebnis["farben"] == {AUSWAHL_IDS[0]: BY_ID[AUSWAHL_IDS[0]]["farbVarianten"][0]}


def test_baseline_kein_farben_feld() -> None:
    a = BaselineKurator().kuratiere(PROFIL, ROOM, CATALOG, None, seed=1)
    assert a["farben"] is None


def test_validiere_anordnung_relation_ziel_schlecht() -> None:
    schlecht = {"anordnung": [{"itemId": P1_IDS[0], "relationen": ["near:sofa:1.0"]}]}
    fehler = _validiere_anordnung(schlecht, P1_IDS, N_WALLS, _BAD_TYPEN)
    assert fehler is not None and "sofa" in fehler


def test_validiere_anordnung_unbekannte_relation_toleriert() -> None:
    """Unbekannte Formen bleiben tolerant (Parser ignoriert sie später)."""
    a = {"anordnung": [{"itemId": P1_IDS[0], "relationen": ["mystery:foo", "against-wall"]}]}
    assert _validiere_anordnung(a, P1_IDS, N_WALLS, _BAD_TYPEN) is None


# --- Welle 1: Norm-Rendering aus Daten (Call C) ------------------------------


def test_norm_kontext_flaechen_nennt_nasswand_indizes() -> None:
    """Der gerenderte Norm-Block benennt die konkreten Nasswand-Indizes des
    Sample-Raums + die Boden-Regel mit erlaubten Slugs."""
    zeilen = norm_kontext_flaechen(ROOM)
    text = "\n".join(zeilen)
    for i in sorted(nasswaende(ROOM)):
        assert f"Wand {i}" in text
    assert any("Boden" in z for z in zeilen)
    assert "fliesen-hell" in text


# Küche mit Wasser-Fixpunkt an Wand 2 → Spritzzone greift.
KUECHE_NASS = {
    "roomType": "kueche",
    "shell": {
        "walls": [
            {"id": "kw0", "start": [0, 0], "end": [3, 0]},
            {"id": "kw1", "start": [3, 0], "end": [3, 2]},
            {"id": "kw2", "start": [3, 2], "end": [0, 2]},
            {"id": "kw3", "start": [0, 2], "end": [0, 0]},
        ]
    },
    "fixpoints": [{"type": "wasser", "wall": "kw2"}],
}


def test_kueche_spritzzone_greift_in_pruefe_flaechen() -> None:
    """Neue Regel kueche-wand-spritzzone: Spülen-Nasswand unverkleidet → Verstoss."""
    assert nasswaende(KUECHE_NASS) == {2}
    fl = {"boden": {"material": "fliesen-hell"}, "waende": []}
    verstoesse = pruefe_flaechen(fl, KUECHE_NASS, FLAECHEN_REGELN)
    assert any("kueche-wand-spritzzone" in v for v in verstoesse)
    # Und korrigiere_flaechen macht es konform (belegt die Spritzzonen-Wand).
    korrigiert = korrigiere_flaechen(fl, KUECHE_NASS, FLAECHEN_REGELN)
    assert pruefe_flaechen(korrigiert, KUECHE_NASS, FLAECHEN_REGELN) == []


# --- Welle 1: Bewegungsflächen-Hinweise (Call B, aus Norm-Daten) -------------


def test_bewegungs_hinweise_bad() -> None:
    """Je gewähltem funktionsTyp eine kompakte Bewegungsflächen-Zeile aus data/rules."""
    hinweise = bewegungs_hinweise(ROOM, {"wc", "lavabo", "dusche"})
    text = "\n".join(hinweise)
    assert any(z.startswith("wc:") for z in hinweise)
    assert "Bewegungsfläche" in text


# --- Welle 1: konzept-Durchreichung + Prompt-Kontext -------------------------


def _auswahl_mit_konzept(konzept: str) -> dict[str, Any]:
    return {"konzept": konzept, "auswahl": AUSWAHL_IDS, "begruendung": "Test"}


def test_baseline_konzept_none() -> None:
    a = BaselineKurator().kuratiere(PROFIL, ROOM, CATALOG, None, seed=1)
    assert a["konzept"] is None


def test_llm_konzept_durchgereicht(monkeypatch: pytest.MonkeyPatch) -> None:
    port = _llm_mit_antworten(
        monkeypatch,
        [_auswahl_mit_konzept("Warmes, naturnahes Bad."), _anordnung_ok(), _flaechen_ok()],
    )
    ergebnis = port.kuratiere(PROFIL, ROOM, CATALOG, None, seed=1)
    assert ergebnis["konzept"] == "Warmes, naturnahes Bad."


def _capture_pipeline(
    monkeypatch: pytest.MonkeyPatch, antworten: list[Any]
) -> list[dict[str, Any]]:
    """Fährt die Pipeline und gibt die gesendeten Request-Payloads zurück."""
    payloads: list[dict[str, Any]] = []
    rest = list(antworten)

    def fake_post(url: str, **kwargs: Any) -> httpx.Response:
        payloads.append(kwargs["json"])
        inhalt = rest.pop(0)
        body = {"choices": [{"message": {"content": json.dumps(inhalt)}}]}
        return httpx.Response(200, json=body, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "post", fake_post)
    LlmKurator(url="http://test/v1", model="test", api_key=None).kuratiere(
        PROFIL, ROOM, CATALOG, None, seed=7
    )
    return payloads


def test_prompt_b_enthaelt_stilprofil_und_c_die_auswahl(monkeypatch: pytest.MonkeyPatch) -> None:
    payloads = _capture_pipeline(monkeypatch, [_auswahl_ok(), _anordnung_ok(), _flaechen_ok()])
    call_b = payloads[1]["messages"][-1]["content"]
    assert "## Stilprofil" in call_b and '"temperatur": 0.6' in call_b
    call_c = payloads[2]["messages"][-1]["content"]
    assert "Gewählte Möbel" in call_c and "funktionsTyp wc" in call_c


def test_sampling_temperature_und_seed(monkeypatch: pytest.MonkeyPatch) -> None:
    payloads = _capture_pipeline(monkeypatch, [_auswahl_ok(), _anordnung_ok(), _flaechen_ok()])
    assert payloads[0]["temperature"] == 0.3
    assert payloads[0]["seed"] == 7


# --- Welle A: Objekt-Ebenen (Haupt/Ergänzung, Anzahl, ADR-0014) --------------

WOHNEN_ROOM = _load("raummodell.wohnen-sample.json")
WOHNEN_CATALOG = json.loads((REPO_ROOT / "data" / "catalog" / "wohnen.json").read_text())
WOHNEN_BY = {c["id"]: c for c in WOHNEN_CATALOG}
WOHNEN_N_WALLS = len(WOHNEN_ROOM["shell"]["walls"])


def _w(funktionsTyp: str) -> str:
    return next(c["id"] for c in WOHNEN_CATALOG if c["funktionsTyp"] == funktionsTyp)


ESSTISCH, SOFA, TV, STUHL, REGAL = (
    _w("esstisch"),
    _w("sofa"),
    _w("tvmoebel"),
    _w("stuhl"),
    _w("regal"),
)
WOHNEN_SLOTS = vorfilter(PROFIL, WOHNEN_ROOM, WOHNEN_CATALOG, None)


def test_anzahl_leitplanke_lookup() -> None:
    # Erstes Band mit area <= bisM2; überschreitet die Fläche alle → letztes Band.
    assert anzahl_leitplanke("wohnen", 16.0) == (6, 12)
    assert anzahl_leitplanke("wohnen", 25.0) == (8, 15)
    assert anzahl_leitplanke("wohnen", 500.0) == (10, 20)
    assert anzahl_leitplanke("gibtsnicht", 10.0) is None


def test_validiere_ebenen_anker_ohne_haupt() -> None:
    """Ergänzung «stuhl» (Anker esstisch) ohne esstisch in hauptObjekte → Fehler."""
    antwort = {"hauptObjekte": [SOFA, TV], "ergaenzungen": [{"itemId": STUHL, "anzahl": 4}]}
    fehler = _validiere_ebenen(antwort, WOHNEN_SLOTS, "wohnen", None, None, WOHNEN_BY)
    assert fehler is not None and "esstisch" in fehler


def test_validiere_ebenen_anker_mit_haupt_ok() -> None:
    antwort = {"hauptObjekte": [ESSTISCH, SOFA], "ergaenzungen": [{"itemId": STUHL, "anzahl": 4}]}
    assert _validiere_ebenen(antwort, WOHNEN_SLOTS, "wohnen", None, None, WOHNEN_BY) is None


def test_validiere_ebenen_anzahl_ueber_max() -> None:
    """Regal hat maxAnzahl 1 → anzahl 3 sprengt die Obergrenze (konkreter Hinweis)."""
    antwort = {"hauptObjekte": [ESSTISCH], "ergaenzungen": [{"itemId": REGAL, "anzahl": 3}]}
    fehler = _validiere_ebenen(antwort, WOHNEN_SLOTS, "wohnen", None, None, WOHNEN_BY)
    assert fehler is not None and "maxAnzahl" in fehler


def test_validiere_ebenen_platz_budget_ueber_instanzen() -> None:
    """Platz-Budget zählt anzahl×Footprint: 4 Stühle sprengen ein winziges Budget."""
    antwort = {"hauptObjekte": [ESSTISCH], "ergaenzungen": [{"itemId": STUHL, "anzahl": 4}]}
    fehler = _validiere_ebenen(antwort, WOHNEN_SLOTS, "wohnen", None, 1.0, WOHNEN_BY)
    assert fehler is not None and "Platz-Budget" in fehler


def test_extrahiere_ebenen_altform_nur_auswahl() -> None:
    """Alt-Form (nur `auswahl`, keine Ebenen) → alles Haupt, keine Ergänzungen."""
    haupt, erg = _extrahiere_ebenen({"auswahl": [SOFA, ESSTISCH]})
    assert haupt == [SOFA, ESSTISCH] and erg == []


def test_mengen_aus_antwort_nur_ueber_eins() -> None:
    antwort = {"ergaenzungen": [{"itemId": STUHL, "anzahl": 4}, {"itemId": REGAL, "anzahl": 1}]}
    # Haupt (anzahl 1) und anzahl-1-Ergänzungen bleiben implizit (kein Eintrag).
    assert mengen_aus_antwort(antwort) == {STUHL: 4}


def test_baseline_ebenen_reihenfolge_und_stuhl_anzahl() -> None:
    a = BaselineKurator().kuratiere(PROFIL, WOHNEN_ROOM, WOHNEN_CATALOG, None, seed=1)
    b = BaselineKurator().kuratiere(PROFIL, WOHNEN_ROOM, WOHNEN_CATALOG, None, seed=1)
    assert a == b  # deterministisch
    haupt_typen = [WOHNEN_BY[i]["funktionsTyp"] for i in a["hauptObjekte"]]
    assert "esstisch" in haupt_typen and "sofa" in haupt_typen
    # Alle Haupt sind objektEbene haupt, alle Ergänzungen ergaenzung.
    assert all(WOHNEN_BY[i]["objektEbene"] == "haupt" for i in a["hauptObjekte"])
    assert all(WOHNEN_BY[e["itemId"]]["objektEbene"] == "ergaenzung" for e in a["ergaenzungen"])
    # Stühle verankert am Esstisch, deterministisch mehrfach (2..4).
    stuehle = [e for e in a["ergaenzungen"] if WOHNEN_BY[e["itemId"]]["funktionsTyp"] == "stuhl"]
    assert stuehle and 2 <= stuehle[0]["anzahl"] <= 4
    # auswahl = Haupt + Ergänzungs-IDs (jede genau einmal).
    assert a["auswahl"] == a["hauptObjekte"] + [e["itemId"] for e in a["ergaenzungen"]]


def test_baseline_alt_katalog_ohne_ebene_bricht_nicht() -> None:
    """Katalog ohne objektEbene/ankerTyp/maxAnzahl → alles Haupt, keine Anker-Pflicht."""
    alt = [
        {k: v for k, v in c.items() if k not in ("objektEbene", "ankerTyp", "maxAnzahl")}
        for c in CATALOG
    ]
    a = BaselineKurator().kuratiere(PROFIL, ROOM, alt, None, seed=1)
    assert a["auswahl"] and a["ergaenzungen"] == []
    assert set(a["hauptObjekte"]) == set(a["auswahl"])
    slots = vorfilter(PROFIL, ROOM, alt, None)
    assert _validiere(a, slots, "bad", None) is None
    assert _validiere_ebenen(a, slots, "bad", None, None, {c["id"]: c for c in alt}) is None


# --- LLM-Pipeline mit Objekt-Ebenen ------------------------------------------


def _haupt(*typen: str) -> list[str]:
    return [_w(t) for t in typen]


def _anordnung_w() -> dict[str, Any]:
    return {"anordnung": [{"itemId": ESSTISCH, "prioritaet": 1}]}


def _flaechen_w() -> dict[str, Any]:
    # Wohnen ist Trockenraum (keine harten Flächenregeln) → beliebiger valider Slug.
    return {"flaechen": {"boden": {"material": "parkett-eiche"}}}


def _kuratiere_wohnen(port: LlmKurator) -> dict[str, Any]:
    return port.kuratiere(PROFIL, WOHNEN_ROOM, WOHNEN_CATALOG, None, seed=1)


def test_llm_ebenen_anker_repair(monkeypatch: pytest.MonkeyPatch) -> None:
    """Call A liefert Stühle ohne Esstisch-Haupt → harter Fehler → 1 Repair mit
    Esstisch → gültige zweistufige Auswahl übernommen (Haupt + verankerte Stühle)."""
    schlecht = {
        "hauptObjekte": _haupt("sofa", "tvmoebel"),
        "ergaenzungen": [{"itemId": STUHL, "anzahl": 4}],
    }
    gut = {
        "hauptObjekte": _haupt("esstisch", "sofa"),
        "ergaenzungen": [{"itemId": STUHL, "anzahl": 4}],
    }
    port = _llm_mit_antworten(monkeypatch, [schlecht, gut, _anordnung_w(), _flaechen_w()])
    ergebnis = _kuratiere_wohnen(port)
    haupt_typen = {WOHNEN_BY[i]["funktionsTyp"] for i in ergebnis["hauptObjekte"]}
    assert "esstisch" in haupt_typen
    stuehle = [e for e in ergebnis["ergaenzungen"] if e["itemId"] == STUHL]
    assert stuehle and stuehle[0]["anzahl"] == 4
    # auswahl expandiert (jede itemId einmal), mengen trägt die 4.
    assert ergebnis["auswahl"].count(STUHL) == 1
    assert mengen_aus_antwort(ergebnis) == {STUHL: 4}


def test_llm_korridor_weich_marker(monkeypatch: pytest.MonkeyPatch) -> None:
    """Zu wenige Instanzen (2 < Korridor-Min): 1 weicher Repair, bleibt drunter →
    akzeptiert + Marker CURATOR_ANZAHL_AUSSERHALB (hart bleibt nur das Platz-Budget)."""
    wenig = {"hauptObjekte": _haupt("esstisch", "sofa"), "ergaenzungen": []}
    port = _llm_mit_antworten(monkeypatch, [wenig, wenig, _anordnung_w(), _flaechen_w()])
    ergebnis = _kuratiere_wohnen(port)
    assert "CURATOR_ANZAHL_AUSSERHALB" in ergebnis["begruendung"]
    assert _instanz_anzahl(ergebnis["hauptObjekte"], ergebnis["ergaenzungen"]) == 2


def test_llm_korridor_repair_bringt_in_korridor(monkeypatch: pytest.MonkeyPatch) -> None:
    """Erst zu wenige (2), Repair liefert Korridor-konform (esstisch+sofa+4 Stühle
    = 6) → KEIN Marker."""
    wenig = {"hauptObjekte": _haupt("esstisch", "sofa"), "ergaenzungen": []}
    gut = {
        "hauptObjekte": _haupt("esstisch", "sofa"),
        "ergaenzungen": [{"itemId": STUHL, "anzahl": 4}],
    }
    port = _llm_mit_antworten(monkeypatch, [wenig, gut, _anordnung_w(), _flaechen_w()])
    ergebnis = _kuratiere_wohnen(port)
    assert "CURATOR_ANZAHL_AUSSERHALB" not in ergebnis["begruendung"]
    assert _instanz_anzahl(ergebnis["hauptObjekte"], ergebnis["ergaenzungen"]) == 6


def test_llm_altform_auswahl_kein_korridor(monkeypatch: pytest.MonkeyPatch) -> None:
    """Alt-Form (nur `auswahl`) fällt NICHT in die Korridor-Prüfung (additive
    Evolution) – der bestehende Auswahl-Weg bleibt unberührt."""
    port = _llm_mit_antworten(monkeypatch, [_auswahl_ok(), _anordnung_ok(), _flaechen_ok()])
    ergebnis = port.kuratiere(PROFIL, ROOM, CATALOG, None, seed=1)
    assert "CURATOR_ANZAHL_AUSSERHALB" not in ergebnis["begruendung"]
    assert ergebnis["auswahl"] == AUSWAHL_IDS
    assert ergebnis["ergaenzungen"] == []


# --- Thinking-/Sampling-Steuerung (FP_KURATOR_REASONING/_TEMP, ADR-0014) ------


def _erster_payload(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    payloads: list[dict[str, Any]] = []

    def fake_post(url: str, **kwargs: Any) -> httpx.Response:
        payloads.append(kwargs["json"])
        body = {"choices": [{"message": {"content": json.dumps(_auswahl_ok())}}]}
        return httpx.Response(200, json=body, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "post", fake_post)
    LlmKurator(url="http://test/v1", model="test", api_key=None).kuratiere(
        PROFIL, ROOM, CATALOG, None, seed=1
    )
    return payloads[0]


def test_reasoning_payload_nur_bei_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FP_KURATOR_REASONING", "default")
    monkeypatch.setenv("FP_KURATOR_TEMP", "0.15")
    payload = _erster_payload(monkeypatch)
    assert payload["reasoning_effort"] == "default"
    assert payload["reasoning_format"] == "hidden"  # hält Denktext aus dem JSON
    assert payload["temperature"] == 0.15


def test_reasoning_payload_absent_ohne_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("FP_KURATOR_REASONING", raising=False)
    monkeypatch.delenv("FP_KURATOR_TEMP", raising=False)
    payload = _erster_payload(monkeypatch)
    assert "reasoning_effort" not in payload and "reasoning_format" not in payload
    assert payload["temperature"] == 0.3  # unveränderter Standard
