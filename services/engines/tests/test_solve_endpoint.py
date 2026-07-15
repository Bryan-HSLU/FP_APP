"""E2E über die API: Sample-Raum → /solve → /evaluate → /export/kv-pdf."""

import json
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from fp_engines.api import app

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURES = REPO_ROOT / "packages" / "shared" / "fixtures" / "artefakte"


def _room(name: str) -> Any:
    return json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))


def test_happy_path_raum_bis_pdf() -> None:
    client = TestClient(app)
    room = _room("raummodell.bad-sample")

    res = client.post("/solve", json={"room": room, "seed": 1})
    assert res.status_code == 200
    body = res.json()
    plan = body["plan"]
    assert body["hinweis"] == "GEOMETRY_UNCONFIRMED"  # Ampel-Margen aktiv
    assert plan["constraintReport"]["hard"]["summary"]["verletzt"] == 0

    res = client.post("/evaluate", json={"room": room, "plan": plan})
    assert res.status_code == 200
    assert res.json()["summe_chf"] > 0

    res = client.post("/export/kv-pdf", json={"room": room, "plan": plan})
    assert res.status_code == 200
    assert res.content[:5] == b"%PDF-"


def test_solve_unloesbar_gibt_422() -> None:
    client = TestClient(app)
    room = _room("raummodell.r1-wc")
    import json as _json
    from pathlib import Path as _Path

    catalog = _json.loads(
        (_Path(__file__).resolve().parents[3] / "data" / "catalog" / "bad.json").read_text()
    )
    dusche = max(
        (c for c in catalog if c["funktionsTyp"] == "dusche"),
        key=lambda c: c["masse"]["w"] * c["masse"]["d"],
    )["id"]
    res = client.post("/solve", json={"room": room, "auswahl": [dusche]})
    assert res.status_code == 422
    assert res.json()["code"] == "NO_FEASIBLE_PLACEMENT"


def test_samples_und_katalog() -> None:
    client = TestClient(app)
    rooms = client.get("/samples/rooms").json()
    assert {r["name"] for r in rooms} >= {"Sample-Bad 3.0 × 2.4 m"}
    katalog = client.get("/catalog/bad").json()
    assert any(c["funktionsTyp"] == "wc" for c in katalog)
    assert client.get("/catalog/garage").status_code == 404


def test_kueche_formen_endpoint() -> None:
    """M6: /kueche/formen liefert Top-3 Formen für die Sample-Küche."""
    client = TestClient(app)
    room = _room("raummodell.kueche-sample")
    res = client.post("/kueche/formen", json={"room": room})
    assert res.status_code == 200
    formen = res.json()["formen"]
    assert 1 <= len(formen) <= 3
    assert all("form" in f and "score" in f and "begruendung" in f for f in formen)
    assert "insel" not in {f["form"] for f in formen}


def test_solve_kueche_smoke() -> None:
    """M6: /solve auf der Sample-Küche → Baugruppe mit assemblies, 0 ❌."""
    client = TestClient(app)
    room = _room("raummodell.kueche-sample")
    res = client.post("/solve", json={"room": room, "seed": 1, "normProfile": "eu"})
    assert res.status_code == 200
    body = res.json()
    plan = body["plan"]
    assert plan["constraintReport"]["hard"]["summary"]["verletzt"] == 0
    assert plan["assemblies"][0]["type"] == "kuechenzeile"
    assert plan["meta"]["normProfile"] == "eu"
    assert body["room"]["id"] == room["id"]
    # Arbeitsdreieck-Detail fürs Viewer-Panel + Score im Plan (M6-Politur).
    assert 0.0 < body["arbeitsdreieck"]["score"] <= 1.0
    assert body["arbeitsdreieck"]["score"] == plan["constraintReport"]["softScore"]["ergonomie"]
    assert len(body["arbeitsdreieck"]["seiten_m"]) == 3


def test_solve_grossraum_zone_room_zurueck() -> None:
    """M6: /solve mit zoneId plant den Teilraum; Response.room ist der Teilraum,
    Placements liegen in der Zone (x ≤ 2.8)."""
    client = TestClient(app)
    gr = _room("raummodell.grossraum-sample")
    zid = "aaaa0001-3000-4000-8000-000000003001"
    res = client.post("/solve", json={"room": gr, "seed": 1, "zoneId": zid, "form": "l"})
    assert res.status_code == 200
    body = res.json()
    assert body["room"]["id"] != gr["id"]  # eigenständiger Teilraum
    assert body["room"]["roomType"] == "kueche"
    assert all(p["pose"]["pos"][0] <= 2.8 + 1e-6 for p in body["plan"]["placements"])


def test_export_kueche_plan() -> None:
    """M6: LV (JSON) + glTF laufen für einen Küchen-Plan (placements-basiert)."""
    client = TestClient(app)
    room = _room("raummodell.kueche-sample")
    plan = client.post("/solve", json={"room": room, "seed": 1}).json()["plan"]
    lv = client.post("/export/lv", json={"room": room, "plan": plan})
    assert lv.status_code == 200
    gltf = client.post("/export/gltf", json={"room": room, "plan": plan})
    assert gltf.status_code == 200


def test_solve_reicht_anordnung_und_flaechen_durch() -> None:
    """Kurator-Pipeline v2: /solve nimmt anordnung (an solve) + flaechen (echo)."""
    client = TestClient(app)
    room = _room("raummodell.wohnen-sample")
    sofa = "bbbbbbbb-0001-4000-8000-000000000001"
    flaechen = {"boden": {"material": "parkett-eiche"}}
    res = client.post(
        "/solve",
        json={
            "room": room,
            "seed": 1,
            "auswahl": [sofa],
            "anordnung": [{"itemId": sofa, "wandIndex": 0, "relationen": ["against-wall"]}],
            "flaechen": flaechen,
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["plan"]["constraintReport"]["hard"]["summary"]["verletzt"] == 0
    assert body["flaechen"] == flaechen  # additiv durchgereicht


def test_solve_ohne_flaechen_gibt_none() -> None:
    """Ohne Flächen-Wunsch trägt die Response flaechen=None (Client leitet ab)."""
    client = TestClient(app)
    room = _room("raummodell.bad-sample")
    body = client.post("/solve", json={"room": room, "seed": 1}).json()
    assert body["flaechen"] is None


def test_solve_reicht_farben_bis_placement_durch() -> None:
    """Welle 3: /solve nimmt `farben` (itemId→Slug) → placement.farbe."""
    client = TestClient(app)
    room = _room("raummodell.wohnen-sample")
    sofa = "bbbbbbbb-0001-4000-8000-000000000001"
    katalog = client.get("/catalog/wohnen").json()
    slug = next(c for c in katalog if c["id"] == sofa)["farbVarianten"][0]
    res = client.post(
        "/solve",
        json={"room": room, "seed": 1, "auswahl": [sofa], "farben": {sofa: slug}},
    )
    assert res.status_code == 200
    placements = res.json()["plan"]["placements"]
    sofa_pl = [p for p in placements if p["catalogItemId"] == sofa]
    assert sofa_pl and all(p["farbe"] == slug for p in sofa_pl)


def test_solve_default_ohne_varianteninfo() -> None:
    """Welle 5: DEFAULT (kein varianten-Flag) ⇒ Verhalten wie bisher, kein varianteInfo."""
    client = TestClient(app)
    room = _room("raummodell.wohnen-sample")
    body = client.post("/solve", json={"room": room, "seed": 1}).json()
    assert "varianteInfo" not in body


def test_solve_varianten_liefert_beste_und_info() -> None:
    """Welle 5: varianten=true ⇒ Plan mit 0 ❌ + kompaktes varianteInfo (K=3)."""
    client = TestClient(app)
    room = _room("raummodell.wohnen-sample")
    res = client.post("/solve", json={"room": room, "seed": 1, "varianten": True})
    assert res.status_code == 200
    body = res.json()
    assert body["plan"]["constraintReport"]["hard"]["summary"]["verletzt"] == 0
    info = body["varianteInfo"]
    assert info["anzahl"] == 3
    assert len(info["varianten"]) == 3
    assert 0 <= info["gewaehlt"] < 3
    # best ≥ Variante 0: gewählte (platziert, −knapp, relationScore) ist nie schlechter.
    g, v0 = info["varianten"][info["gewaehlt"]], info["varianten"][0]
    assert (g["platziert"], -g["knapp"], g["relationScore"]) >= (
        v0["platziert"],
        -v0["knapp"],
        v0["relationScore"],
    )


def test_solve_varianten_determinismus() -> None:
    """Welle 5: 2× varianten=true mit gleichem seed ⇒ identische Wahl + varianteInfo."""
    client = TestClient(app)
    room = _room("raummodell.wohnen-sample")
    a = client.post("/solve", json={"room": room, "seed": 2, "varianten": True}).json()
    b = client.post("/solve", json={"room": room, "seed": 2, "varianten": True}).json()
    assert a["varianteInfo"] == b["varianteInfo"]


def test_solve_varianten_details_liefert_k_plaene() -> None:
    """Welle C: variantenDetails=true ⇒ additiv `variantenPlaene` = ALLE K Pläne
    best-first; jeder Plan hat 0 ❌; Kopf-Plan == gewählter Plan; Scores fallend."""
    client = TestClient(app)
    room = _room("raummodell.wohnen-sample")
    res = client.post(
        "/solve",
        json={"room": room, "seed": 1, "varianten": True, "variantenDetails": True},
    )
    assert res.status_code == 200
    body = res.json()
    plaene = body["variantenPlaene"]
    assert len(plaene) == 3
    # Jeder Vorschlag ist normkonform (Solver-Invariante je Variante).
    for vp in plaene:
        assert vp["plan"]["constraintReport"]["hard"]["summary"]["verletzt"] == 0
    # Kopf = die gewählte beste Variante (== body["plan"]).
    assert plaene[0]["plan"] == body["plan"]
    assert plaene[0]["info"]["index"] == body["varianteInfo"]["gewaehlt"]
    # Best-first: (platziert, −knapp, relationScore) monoton fallend.
    tupel = [
        (v["info"]["platziert"], -v["info"]["knapp"], v["info"]["relationScore"]) for v in plaene
    ]
    assert tupel == sorted(tupel, reverse=True)


def test_solve_varianten_ohne_details_unveraendert() -> None:
    """Welle C: varianten=true OHNE variantenDetails ⇒ kein variantenPlaene, aber
    varianteInfo wie bisher (bestehender Pfad byte-gleich)."""
    client = TestClient(app)
    room = _room("raummodell.wohnen-sample")
    ohne = client.post("/solve", json={"room": room, "seed": 1, "varianten": True}).json()
    mit = client.post(
        "/solve", json={"room": room, "seed": 1, "varianten": True, "variantenDetails": True}
    ).json()
    assert "variantenPlaene" not in ohne
    assert "variantenPlaene" in mit
    # Gewählter Plan + varianteInfo identisch – Details ändern die Wahl nicht.
    # (createdAt ist Wall-Clock der beiden Requests → vor dem Vergleich angleichen.)
    mit["plan"]["meta"]["createdAt"] = ohne["plan"]["meta"]["createdAt"]
    assert ohne["plan"] == mit["plan"]
    assert ohne["varianteInfo"] == mit["varianteInfo"]


def test_flaechen_pruefen_konform() -> None:
    """Welle 3: /flaechen/pruefen meldet keine Verstösse bei konformer Wahl."""
    client = TestClient(app)
    room = _room("raummodell.wohnen-sample")  # Trockenraum, keine harten Flächenregeln
    flaechen = {"boden": {"material": "parkett-eiche"}}
    res = client.post("/flaechen/pruefen", json={"room": room, "flaechen": flaechen})
    assert res.status_code == 200
    body = res.json()
    assert body["verstoesse"] == []
    assert body["korrigiert"]["boden"]["material"] == "parkett-eiche"


def test_flaechen_pruefen_verstoss_wird_korrigiert() -> None:
    """Welle 3: Parkett-Boden im Bad verletzt die Norm → Verstoss gemeldet UND
    korrigierte (wasserfeste) Fassung zurückgegeben (Quelle bleibt Python)."""
    client = TestClient(app)
    room = _room("raummodell.bad-sample")
    res = client.post(
        "/flaechen/pruefen",
        json={"room": room, "flaechen": {"boden": {"material": "parkett-eiche"}}},
    )
    assert res.status_code == 200
    body = res.json()
    assert any("bad-boden-wasserfest" in v for v in body["verstoesse"])
    assert body["korrigiert"]["boden"]["material"] == "fliesen-hell"
    # Die korrigierte Fassung ist normkonform: erneut prüfen liefert leer.
    erneut = client.post("/flaechen/pruefen", json={"room": room, "flaechen": body["korrigiert"]})
    assert erneut.json()["verstoesse"] == []


def test_solve_wohnen_kernmoebel() -> None:
    """M5: Sample-Wohnzimmer → /solve liefert Plan mit Sofa + Esstisch + TV-Möbel."""
    client = TestClient(app)
    room = _room("raummodell.wohnen-sample")
    res = client.post("/solve", json={"room": room, "seed": 1})
    assert res.status_code == 200
    plan = res.json()["plan"]
    assert plan["constraintReport"]["hard"]["summary"]["verletzt"] == 0
    katalog = client.get("/catalog/wohnen").json()
    by_id = {c["id"]: c for c in katalog}
    typen = {by_id[p["catalogItemId"]]["funktionsTyp"] for p in plan["placements"]}
    assert {"sofa", "esstisch", "tvmoebel"} <= typen


def test_solve_mengen_mehrfach_instanzen() -> None:
    """Welle A (ADR-0014): /solve nimmt optionales `mengen` (itemId→anzahl) →
    n eigenständige Placements desselben Katalog-Items, 0 ❌."""
    client = TestClient(app)
    room = _room("raummodell.wohnen-sample")
    katalog = client.get("/catalog/wohnen").json()
    esstisch = next(c["id"] for c in katalog if c["funktionsTyp"] == "esstisch")
    stuhl = next(c["id"] for c in katalog if c["funktionsTyp"] == "stuhl")
    res = client.post(
        "/solve",
        json={
            "room": room,
            "seed": 1,
            "auswahl": [esstisch, stuhl],
            "relationaleAbsichten": [{"itemId": stuhl, "relation": "near:esstisch:1.3"}],
            "mengen": {stuhl: 4},
        },
    )
    assert res.status_code == 200
    plan = res.json()["plan"]
    assert plan["constraintReport"]["hard"]["summary"]["verletzt"] == 0
    stuhl_pl = [p for p in plan["placements"] if p["catalogItemId"] == stuhl]
    assert len(stuhl_pl) == 4
    assert len({p["id"] for p in stuhl_pl}) == 4


def test_solve_baseline_stuehle_als_instanzen() -> None:
    """/solve ohne auswahl (Baseline-Kurator) leitet mengen aus den Ergänzungen ab
    → das Wohnzimmer bekommt mehrere Stuhl-Instanzen am Esstisch."""
    client = TestClient(app)
    room = _room("raummodell.wohnen-sample")
    katalog = client.get("/catalog/wohnen").json()
    by_id = {c["id"]: c for c in katalog}
    plan = client.post("/solve", json={"room": room, "seed": 1}).json()["plan"]
    assert plan["constraintReport"]["hard"]["summary"]["verletzt"] == 0
    stuehle = [
        p for p in plan["placements"] if by_id[p["catalogItemId"]]["funktionsTyp"] == "stuhl"
    ]
    assert len(stuehle) >= 2  # Mehrfach-Instanzen aus der Baseline
