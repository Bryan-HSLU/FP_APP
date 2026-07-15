"""Eval Kurations-Qualität (Kurator-Pipeline-v3-Konzept, Welle 4 – «Beweis statt Gefühl»).

Testset: 3 Räume (bad/wohnen/kueche) × 3 Stilprofile (zwei Extreme + mittig-
unentschieden) × 5 Seeds = 45 Läufe je Port.

Metriken je Port (Baseline immer; `llm-api` nur wenn `FP_KURATOR_URL` gesetzt):
- Validität (nach Repair), Stil-Treue (cos Profil↔Auswahl), Diversität
  (distinkte Auswahl-Sets über das Testset) – wie in Welle 1–3.
- Solver-Überlebensrate (NEU): `kuratiere()`-Auswahl durch `solve()` gejagt –
  platzierte / gewählte Items. Nutzt dieselbe generische `solve()`-Signatur wie
  `/solve` in `api.py` (Zweig ohne `req.auswahl`, s. dort) – auch für Küche:
  die Eval prüft die generische Auswahl+Solver-Pipeline, nicht die
  spezialisierte Baugruppen-Lösung `solve_kueche`.
- Platz-Auslastung (NEU): Footprint-Summe der Boden-Items (w×d×2.5, wandmontiert
  ausgenommen – Daumenregel aus `kurator._footprint`) / Bodenfläche.
- Palette-Treffer (NEU): gewählte Farbe je Item (`farben`-Feld, sonst erste
  `farbVariante`) als Hex → minimale RGB-Distanz zur Profil-Palette, normiert
  auf 0..1 (1 = Treffer). Nur Profile mit Palette fliessen ein (mittig hat
  bewusst eine schwache, aber nicht-leere Palette – sonst nicht messbar).
- Norm-Korrektur-Rate (NEU): Anteil Läufe mit Reparatur-Marker
  (`CURATOR_FLAECHEN_NORMREPAIR`/`_NORMKORREKTUR`/`CURATOR_FARBEN_BEREINIGT`)
  in der `begruendung` – misst Prompt-Qualität. Baseline erzeugt diese Marker
  nie (kein Norm-Repair-Pfad) → `n/a`.
- 0-❌-Invariante: jeder von `solve()` gelieferte Plan hat 0 harte Verstösse
  (`constraintReport.hard.ok`) – hart assert, kein Soft-Fail.

Gate: Schlägt der Kurator die Baseline NICHT (Stil-Treue + Diversität, wie
bisher), bleibt die Baseline aktiv – Architektur identisch (Port), kein Umbau.
Ohne FP_KURATOR_URL wird nur die Baseline gemessen.

Determinismus: gleiche Seeds ⇒ gleicher Report (Baseline) – `solve()` und
`BaselineKurator` sind seed-deterministisch (Engineering-Grundlagen §1), die
Eval selbst zieht keine Zufallszahlen ausserhalb der Seeds.

Aufruf: uv run python scripts/kurator_eval.py   (aus services/engines/)
"""

import json
import math
import os
from pathlib import Path
from statistics import mean
from typing import Any

from fp_engines.kurator import (
    BaselineKurator,
    KuratorPort,
    _footprint,
    mengen_aus_antwort,
    stil_score,
    waehle_port,
)
from fp_engines.solver import NoFeasiblePlacement, solve

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURES = REPO_ROOT / "packages" / "shared" / "fixtures" / "artefakte"
DATA_CATALOG = REPO_ROOT / "data" / "catalog"
DATA_RULES = REPO_ROOT / "data" / "rules"
REPORT_DATEI = Path(__file__).resolve().parents[1] / "reports" / "kurator_eval.json"

# Slug → Hex, lokale Kopie der 16 kuratierten Interieur-Farben aus dem
# Katalog-Schema-Enum (`katalog-item.schema.json#/$defs/farbSlug`). Die
# Anzeige-Quelle bleibt `apps/web/src/farben.ts` (Client-Optik); hier nur für
# die RGB-Distanzmessung der Palette-Treffer-Metrik – kein Import über die
# Sprachgrenze TS→Python, daher lokal dupliziert (Werte müssen bei einer
# Palette-Änderung dort UND hier gepflegt werden).
FARBSLUG_HEX: dict[str, str] = {
    "weiss": "#f4f4f2",
    "creme": "#ece5d8",
    "sand": "#d9c9a8",
    "beige": "#cbb99a",
    "hellgrau": "#c9c9c6",
    "anthrazit": "#3f4145",
    "schwarz": "#232323",
    "eiche-hell": "#c9a76c",
    "nussbaum": "#6f4e33",
    "salbei": "#9aa88e",
    "olive": "#6f7250",
    "terracotta": "#b0603f",
    "bordeaux": "#6e2b35",
    "blaugrau": "#7d8b96",
    "dunkelblau": "#2d3a55",
    "messing": "#ad8a4c",
}
_MAX_RGB_DIST = math.sqrt(3 * 255**2)

RAEUME: dict[str, str] = {
    "bad": "raummodell.bad-sample.json",
    "wohnen": "raummodell.wohnen-sample.json",
    "kueche": "raummodell.kueche-sample.json",
}

NORM_MARKER = (
    "CURATOR_FLAECHEN_NORMREPAIR",
    "CURATOR_FLAECHEN_NORMKORREKTUR",
    "CURATOR_FARBEN_BEREINIGT",
)

PROFILE = {
    "warm-natuerlich (extrem)": {
        "styleVector": {"temperatur": 0.9, "materialitaet": 0.9, "farbigkeit": 0.5},
        "derivedRequirements": [],
        "palette": ["#3a5a40", "#6f4e33", "#b0603f"],
    },
    "kuehl-minimal (extrem)": {
        "styleVector": {"temperatur": -0.9, "opulenz": -0.9, "epoche": 0.9},
        "derivedRequirements": [],
        "palette": ["#f5f5f5", "#c9c9c6", "#3f4145"],
    },
    "mittig-unentschieden": {
        "styleVector": {"temperatur": 0.1, "opulenz": -0.1},
        "derivedRequirements": [],
        "palette": ["#cbb99a", "#7d8b96"],
    },
}
SEEDS = range(1, 6)


def _lade_raum(name: str) -> dict[str, Any]:
    return json.loads((FIXTURES / RAEUME[name]).read_text(encoding="utf-8"))


def _lade_katalog(room_type: str) -> list[dict[str, Any]]:
    return json.loads((DATA_CATALOG / f"{room_type}.json").read_text(encoding="utf-8"))


def _lade_regeln(room_type: str) -> list[dict[str, Any]]:
    """Basis- + Raumtyp-Regelset – identisches Ladeschema wie `api._load_rulesets`."""
    regeln: list[dict[str, Any]] = []
    for name in ("basis", room_type):
        pfad = DATA_RULES / f"{name}.json"
        regeln.extend(json.loads(pfad.read_text(encoding="utf-8")))
    return regeln


_RaumEintrag = tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]
RAUM_KATALOG_REGELN: dict[str, _RaumEintrag] = {
    name: (_lade_raum(name), _lade_katalog(name), _lade_regeln(name)) for name in RAEUME
}


def _hex_zu_rgb(hex_farbe: str) -> tuple[int, int, int]:
    h = hex_farbe.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def _rgb_distanz(a: str, b: str) -> float:
    ar, ag, ab = _hex_zu_rgb(a)
    br, bg, bb = _hex_zu_rgb(b)
    return math.sqrt((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2)


def _palette_treffer(
    auswahl: list[str],
    by_id: dict[str, dict[str, Any]],
    farben: dict[str, str] | None,
    palette: list[str],
) -> float | None:
    """Mittel über Items der normierten Palette-Nähe (1 = Treffer, 0 = maximal fern).

    Farbwahl je Item nach derselben Rangfolge wie `farben.ts::loeseFarbSlug`
    (ohne Manuell-Stufe, die gibt es im Eval nicht): KI-Farbe > erste
    `farbVariante`. `None`, wenn kein Item eine auflösbare Farbe hat.
    """
    treffer: list[float] = []
    for iid in auswahl:
        item = by_id.get(iid)
        if item is None:
            continue
        slug = (farben or {}).get(iid) or next(iter(item.get("farbVarianten") or []), None)
        hex_ = FARBSLUG_HEX.get(slug) if slug else None
        if hex_ is None:
            continue
        distanz = min(_rgb_distanz(hex_, p) for p in palette)
        treffer.append(1 - distanz / _MAX_RGB_DIST)
    return mean(treffer) if treffer else None


def _port_seeds(port: KuratorPort) -> range:
    """Seeds je Port: FP_EVAL_LLM_SEEDS drosselt NUR den LLM-Port (Free-Tier-
    Rate-Limits, Tokens/Minute); die Baseline misst immer die volle Matrix.
    Vergleich dann entsprechend gröber – bewusster Trade-off, im Report sichtbar
    über die Läufe-Zeile."""
    if port.name != "baseline":
        n = os.environ.get("FP_EVAL_LLM_SEEDS")
        if n:
            return range(1, max(1, int(n)) + 1)
    return SEEDS


def _miss(port: KuratorPort) -> dict[str, Any]:
    seeds = _port_seeds(port)
    laeufe = 0
    gueltig = 0
    treue: list[float] = []
    sets: set[str] = set()
    ueberleben: list[float] = []
    auslastung: list[float] = []
    palette_treffer: list[float] = []
    norm_korrektur: list[bool] = []
    invarianten: list[bool] = []
    anker_erfuellt: list[float] = []

    for raum_name in RAEUME:
        room, catalog, regeln = RAUM_KATALOG_REGELN[raum_name]
        by_id = {c["id"]: c for c in catalog}
        bodenflaeche = room["shell"]["floor"].get("area") or 0.0

        for profil in PROFILE.values():
            for seed in seeds:
                antwort = port.kuratiere(profil, room, catalog, None, seed)
                laeufe += 1
                auswahl = antwort.get("auswahl") or []
                if not auswahl:
                    continue
                gueltig += 1
                # Mengen (Objekt-Ebenen-Modell): Instanz-Anzahl je Item (Default 1).
                mengen = mengen_aus_antwort(antwort)
                gesamt_instanzen = sum(mengen.get(i, 1) for i in auswahl)

                scores = [stil_score(profil, by_id[i]) for i in auswahl if i in by_id]
                if scores:
                    treue.append(mean(scores))
                sets.add(json.dumps(sorted(auswahl)))

                # Anker-Erfüllung (NEU): Anteil verankerter Ergänzungen, deren
                # ankerTyp durch ein gewähltes Haupt-Objekt gedeckt ist. Die harte
                # Validierung erzwingt das bereits (Erwartung ~1.0) – die Spalte
                # macht es im Report sichtbar (Diagnose).
                haupt_ids = antwort.get("hauptObjekte") or auswahl
                haupt_typen = {by_id[i]["funktionsTyp"] for i in haupt_ids if i in by_id}
                verankert = [
                    e
                    for e in (antwort.get("ergaenzungen") or [])
                    if e["itemId"] in by_id and by_id[e["itemId"]].get("ankerTyp")
                ]
                if verankert:
                    erfuellt = sum(
                        1 for e in verankert if by_id[e["itemId"]]["ankerTyp"] in haupt_typen
                    )
                    anker_erfuellt.append(erfuellt / len(verankert))

                if bodenflaeche > 0:
                    footprint_summe = sum(
                        _footprint(by_id[i]) * mengen.get(i, 1) for i in auswahl if i in by_id
                    )
                    auslastung.append(footprint_summe / bodenflaeche)

                if profil["palette"]:
                    treffer = _palette_treffer(
                        auswahl, by_id, antwort.get("farben"), profil["palette"]
                    )
                    if treffer is not None:
                        palette_treffer.append(treffer)

                begruendung = antwort.get("begruendung") or ""
                norm_korrektur.append(any(m in begruendung for m in NORM_MARKER))

                try:
                    plan = solve(
                        room,
                        auswahl,
                        antwort.get("relationaleAbsichten") or [],
                        catalog,
                        regeln,
                        seed=seed,
                        norm_profile="ch",
                        stilprofil_ref=None,
                        style_profile=profil,
                        anordnung=antwort.get("anordnung"),
                        farben=antwort.get("farben"),
                        mengen=mengen,
                    )
                except NoFeasiblePlacement:
                    # Ehrliches Solver-Ergebnis (Engineering-Grundlagen §1): die
                    # KI-Auswahl war für diesen Raum nicht platzierbar → 0
                    # Überlebensrate für diesen Lauf, kein Abbruch der Eval.
                    ueberleben.append(0.0)
                    continue

                report = plan["constraintReport"]
                assert report["hard"]["summary"]["verletzt"] == 0, (
                    f"Solver-Invariante verletzt ({raum_name}/{seed}): {report['hard']}"
                )
                invarianten.append(bool(report["hard"]["ok"]))
                # Überlebensrate zählt jetzt INSTANZEN (Haupt + Ergänzungen×anzahl):
                # ein 4er-Stuhlsatz sind 4 platzierbare Instanzen, nicht ein Item.
                ueberleben.append(len(plan["placements"]) / gesamt_instanzen)

    norm_korrektur_pct: float | str
    if port.name == "baseline":
        norm_korrektur_pct = "n/a"  # Baseline hat keinen Norm-Repair-Pfad (kein LLM-Call C).
    else:
        norm_korrektur_pct = round(100 * mean(norm_korrektur), 1) if norm_korrektur else 0.0

    return {
        "validitaet_pct": round(100 * gueltig / laeufe, 1) if laeufe else 0.0,
        "stil_treue_mittel": round(mean(treue), 3) if treue else 0.0,
        "diversitaet_sets": len(sets),
        "ueberlebensrate_mittel": round(mean(ueberleben), 3) if ueberleben else 0.0,
        "auslastung_mittel": round(mean(auslastung), 3) if auslastung else 0.0,
        "palette_treffer_mittel": round(mean(palette_treffer), 3) if palette_treffer else 0.0,
        "anker_erfuellt_pct": round(100 * mean(anker_erfuellt), 1) if anker_erfuellt else "n/a",
        "norm_korrektur_pct": norm_korrektur_pct,
        "invariante_gehalten": all(invarianten) if invarianten else True,
        "laeufe": laeufe,
    }


_SPALTEN: list[tuple[str, str]] = [
    ("Validität %", "validitaet_pct"),
    ("Stil-Treue (cos)", "stil_treue_mittel"),
    ("Diversität (Sets)", "diversitaet_sets"),
    ("Solver-Überlebensrate", "ueberlebensrate_mittel"),
    ("Platz-Auslastung", "auslastung_mittel"),
    ("Palette-Treffer", "palette_treffer_mittel"),
    ("Anker-Erfüllung %", "anker_erfuellt_pct"),
    ("Norm-Korrektur %", "norm_korrektur_pct"),
    ("0-❌-Invariante", "invariante_gehalten"),
    ("Läufe", "laeufe"),
]


def _zelle(wert: Any) -> str:
    if isinstance(wert, bool):
        return "✅" if wert else "❌"
    return str(wert)


def _drucke_tabelle(zeilen: list[tuple[str, dict[str, Any]]]) -> None:
    kopf = "| Metrik | " + " | ".join(name for name, _ in zeilen) + " |"
    trenner = "|" + "---|" * (len(zeilen) + 1)
    print(kopf)
    print(trenner)
    for label, key in _SPALTEN:
        werte = " | ".join(_zelle(m[key]) for _, m in zeilen)
        print(f"| {label} | {werte} |")


def main() -> None:
    baseline = _miss(BaselineKurator())
    zeilen = [("baseline", baseline)]
    if os.environ.get("FP_KURATOR_URL"):
        zeilen.append(("llm-api", _miss(waehle_port())))
    else:
        print("Hinweis: FP_KURATOR_URL nicht gesetzt → nur Baseline gemessen.\n")

    _drucke_tabelle(zeilen)

    if len(zeilen) == 2:
        base_m, llm_m = baseline, zeilen[1][1]
        schlaegt = (
            llm_m["stil_treue_mittel"] >= base_m["stil_treue_mittel"]
            and llm_m["diversitaet_sets"] > base_m["diversitaet_sets"]
        )
        print(f"\nGate: {'✅ LLM schlägt Baseline' if schlaegt else '❌ Baseline bleibt aktiv'}")
    else:
        print("\nGate-Stand: Baseline aktiv (kein LLM konfiguriert).")

    REPORT_DATEI.parent.mkdir(parents=True, exist_ok=True)
    REPORT_DATEI.write_text(
        json.dumps(
            {
                "testset": {
                    "raeume": sorted(RAEUME),
                    "profile": sorted(PROFILE),
                    "seeds": list(SEEDS),
                },
                "ports": dict(zeilen),
            },
            indent=2,
            ensure_ascii=False,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"\nReport geschrieben: {REPORT_DATEI.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
