"""Diagnose-Harness Kurator v3.1 (ADR-0014 "Objekt-Ebenen + Kurator-Kontrolle",
Punkt 6) – macht Bryans Bauchgefühl («Kurator bestimmt Objekte/Anzahl/Farben
nicht ganz richtig») mit EINEM Befehl überprüfbar.

Fährt dieselbe Raum×Profil-Matrix wie `kurator_eval.py` (Welle 4) – 3 Räume ×
3 Stilprofile, standardmässig 1 Seed statt der vollen 5 – und druckt für JEDE
Kombination die VOLLSTÄNDIGE, echte `kuratiere()`-Antwort menschenlesbar
(Konzept, Haupt-Objekte, Ergänzungen+Anzahl, Farben, Flächen, CURATOR_*-
Marker) plus sechs Plausibilitäts-Ampeln:

- P1-Pflicht komplett          – jeder P1-Pflicht-funktionsTyp (`P1_PFLICHT`)
  in `hauptObjekte`.
- Anker erfüllt                – jede verankerte Ergänzung hat ihr Haupt-Objekt
  (`ankerTyp` unter den gewählten Haupt-funktionsTypen).
- Instanzzahl im Leitplanken-Korridor – Haupt + Ergänzungen×anzahl im
  Ziel-Korridor aus `data/kurator/anzahl-leitplanken.json` (ADR-0014 §4,
  WEICH – der einzige der sechs Checks, der bei Baseline UND LLM regelmässig
  ⚠️ zeigen darf, weil nur das Platz-Budget hart geprüft wird).
- Platz-Auslastung              – Footprint-Summe (`kurator._footprint`) je
  Bodenfläche; ⚠️ ausserhalb 0.3–1.0.
- Farb-Palette-Nähe              – mittlere normierte RGB-Distanz der gewählten
  (oder default) Farben zur Profil-Palette; ⚠️ wenn Mittel > 0.5.
- Flächen-Normkonformität        – `pruefe_flaechen` liefert keine Verstösse.

Die ersten beiden sind hart validiert (`kurator._validiere_ebenen`) und sollten
strukturell IMMER ✅ sein – sie stehen trotzdem mit da: sichtbar beweisen statt
stillschweigend annehmen. Die anderen vier sind weich/informativ – genau da,
wo Bryans Bauchgefühl ansetzt.

Ohne `FP_KURATOR_URL` läuft `waehle_port()` auf die deterministische Baseline
(kein Key nötig, CI-tauglich); mit `FP_KURATOR_URL` (+`FP_KURATOR_MODEL`,
`FP_KURATOR_API_KEY`, `FP_KURATOR_REASONING`) läuft das echte LLM. Determinismus
gilt NUR für die Baseline: gleiche Seeds ⇒ gleicher Output (kein Zeitstempel
im Report). Küche läuft hier über die generische `kuratiere()`/`solve()`-
Pipeline (wie in `kurator_eval.py`), NICHT über die spezialisierte
Baugruppen-Lösung `solve_kueche` – der Diagnose-Fokus ist die generische
Auswahl/Anzahl/Farbe, nicht die Formwahl.

Aufruf (aus services/engines/):
    uv run python scripts/kurator_diagnose.py
    uv run python scripts/kurator_diagnose.py --raum bad --profil "warm-natuerlich (extrem)"
    uv run python scripts/kurator_diagnose.py --seeds 3 --solve --json reports/kurator_diagnose.json
"""

from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path
from statistics import mean
from typing import Any

from fp_engines.kurator import (
    FLAECHEN_REGELN,
    P1_PFLICHT,
    KuratorPort,
    _extrahiere_ebenen,
    _footprint,
    anzahl_leitplanke,
    mengen_aus_antwort,
    pruefe_flaechen,
    waehle_port,
)
from fp_engines.solver import NoFeasiblePlacement, solve

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURES = REPO_ROOT / "packages" / "shared" / "fixtures" / "artefakte"
DATA_CATALOG = REPO_ROOT / "data" / "catalog"
DATA_RULES = REPO_ROOT / "data" / "rules"

# Raum-Fixtures + Stilprofile: BEWUSST identisch zu scripts/kurator_eval.py
# (Welle 4), hier lokal dupliziert statt importiert – Skripte unter scripts/
# sind eigenständige Einstiegspunkte (kein Package unter src/fp_engines), also
# kein Import über die Skript-Grenze. Gleiches Dopplungs-Muster wie
# FARBSLUG_HEX unten (dort ebenfalls aus kurator_eval.py übernommen).
RAEUME: dict[str, str] = {
    "bad": "raummodell.bad-sample.json",
    "wohnen": "raummodell.wohnen-sample.json",
    "kueche": "raummodell.kueche-sample.json",
}

PROFILE: dict[str, dict[str, Any]] = {
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

# Slug → Hex, identische Kopie aus kurator_eval.py (dort begründet: keine
# Sprachgrenze hier, aber Skript-Grenze – kein Import zwischen scripts/-
# Dateien. Bei einer Paletten-Änderung muss diese Liste an BEIDEN Stellen
# gepflegt werden).
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

MARKER_MUSTER = re.compile(r"CURATOR_[A-Z_]+")

# Reihenfolge = Reihenfolge in Anzeige (je Kombination) UND Abschluss-Tabelle.
_AMPEL_LABELS: list[str] = [
    "P1-Pflicht komplett",
    "Anker erfüllt",
    "Instanzzahl im Leitplanken-Korridor",
    "Platz-Auslastung",
    "Farb-Palette-Nähe",
    "Flächen-Normkonformität",
]
_AMPEL_KURZ: dict[str, str] = {
    "P1-Pflicht komplett": "P1",
    "Anker erfüllt": "Anker",
    "Instanzzahl im Leitplanken-Korridor": "Anzahl",
    "Platz-Auslastung": "Auslastung",
    "Farb-Palette-Nähe": "Farbe",
    "Flächen-Normkonformität": "Flächen",
}


# --- Laden (gleiches Schema wie kurator_eval._lade_*) ------------------------


def _lade_raum(name: str) -> dict[str, Any]:
    return json.loads((FIXTURES / RAEUME[name]).read_text(encoding="utf-8"))


def _lade_katalog(room_type: str) -> list[dict[str, Any]]:
    return json.loads((DATA_CATALOG / f"{room_type}.json").read_text(encoding="utf-8"))


def _lade_regeln(room_type: str) -> list[dict[str, Any]]:
    """Basis- + Raumtyp-Regelset für den optionalen Solver-Durchstich
    (`--solve`) – identisches Ladeschema wie `api._load_rulesets`/
    `kurator_eval._lade_regeln`."""
    regeln: list[dict[str, Any]] = []
    for name in ("basis", room_type):
        pfad = DATA_RULES / f"{name}.json"
        regeln.extend(json.loads(pfad.read_text(encoding="utf-8")))
    return regeln


# --- Farb-Distanz (identisch kurator_eval._hex_zu_rgb/_rgb_distanz) ----------


def _hex_zu_rgb(hex_farbe: str) -> tuple[int, int, int]:
    h = hex_farbe.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def _rgb_distanz(a: str, b: str) -> float:
    ar, ag, ab = _hex_zu_rgb(a)
    br, bg, bb = _hex_zu_rgb(b)
    return math.sqrt((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2)


# --- Plausibilitäts-Ampeln (je: (ok, kompakte Zahl/Text)) --------------------


def _p1_pflicht_ampel(
    room_type: str, haupt: list[str], by_id: dict[str, dict[str, Any]]
) -> tuple[bool, str]:
    pflicht = P1_PFLICHT.get(room_type, [])
    haupt_typen = {by_id[i]["funktionsTyp"] for i in haupt if i in by_id}
    fehlend = [t for t in pflicht if t not in haupt_typen]
    text = f"{len(pflicht) - len(fehlend)}/{len(pflicht)}"
    if fehlend:
        text += f" (fehlt: {', '.join(fehlend)})"
    return not fehlend, text


def _anker_ampel(
    erg: list[dict[str, Any]], haupt: list[str], by_id: dict[str, dict[str, Any]]
) -> tuple[bool, str]:
    haupt_typen = {by_id[i]["funktionsTyp"] for i in haupt if i in by_id}
    verankert = [e for e in erg if e["itemId"] in by_id and by_id[e["itemId"]].get("ankerTyp")]
    if not verankert:
        return True, "0/0"
    erfuellt = sum(1 for e in verankert if by_id[e["itemId"]]["ankerTyp"] in haupt_typen)
    return erfuellt == len(verankert), f"{erfuellt}/{len(verankert)}"


def _instanzzahl_ampel(
    room_type: str, area: float, haupt: list[str], erg: list[dict[str, Any]]
) -> tuple[bool, str]:
    total = len(haupt) + sum(int(e.get("anzahl", 1)) for e in erg)
    korridor = anzahl_leitplanke(room_type, area)
    if korridor is None:
        return True, f"{total} (kein Korridor definiert)"
    lo, hi = korridor
    return lo <= total <= hi, f"{total} (Korridor {lo}–{hi})"


def _auslastung_ampel(
    area: float, haupt: list[str], erg: list[dict[str, Any]], by_id: dict[str, dict[str, Any]]
) -> tuple[bool, str]:
    footprint = sum(_footprint(by_id[i]) for i in haupt if i in by_id)
    footprint += sum(
        _footprint(by_id[e["itemId"]]) * int(e.get("anzahl", 1))
        for e in erg
        if e["itemId"] in by_id
    )
    if area <= 0:
        return False, "n/a (Fläche 0)"
    auslastung = footprint / area
    return 0.3 <= auslastung <= 1.0, f"{auslastung:.2f}"


def _palette_ampel(
    auswahl: list[str],
    by_id: dict[str, dict[str, Any]],
    farben: dict[str, str] | None,
    palette: list[str],
) -> tuple[bool, str]:
    """Mittlere normierte RGB-Distanz (0 = Treffer, 1 = maximal fern) der je
    Item aufgelösten Farbe (KI-Wahl > erste `farbVariante`, wie
    `farben.ts::loeseFarbSlug` ohne Manuell-Stufe) zur Profil-Palette."""
    if not palette:
        return True, "n/a (keine Palette)"
    distanzen: list[float] = []
    for iid in auswahl:
        item = by_id.get(iid)
        if item is None:
            continue
        slug = (farben or {}).get(iid) or next(iter(item.get("farbVarianten") or []), None)
        hex_ = FARBSLUG_HEX.get(slug) if slug else None
        if hex_ is None:
            continue
        distanzen.append(min(_rgb_distanz(hex_, p) for p in palette) / _MAX_RGB_DIST)
    if not distanzen:
        return True, "n/a (keine Farben auflösbar)"
    mittel = mean(distanzen)
    return mittel <= 0.5, f"{mittel:.2f}"


def _flaechen_ampel(flaechen: dict[str, Any] | None, room: dict[str, Any]) -> tuple[bool, str]:
    verstoesse = pruefe_flaechen(flaechen, room, FLAECHEN_REGELN)
    text = str(len(verstoesse))
    if verstoesse:
        kurz = "; ".join(verstoesse[:2])
        if len(verstoesse) > 2:
            kurz += " …"
        text += f" ({kurz})"
    return not verstoesse, text


def _ampeln_pruefen(
    room: dict[str, Any],
    profil: dict[str, Any],
    haupt: list[str],
    erg: list[dict[str, Any]],
    auswahl: list[str],
    farben: dict[str, str] | None,
    flaechen: dict[str, Any] | None,
    by_id: dict[str, dict[str, Any]],
) -> dict[str, tuple[bool, str]]:
    room_type = room["roomType"]
    area = room["shell"]["floor"].get("area") or 0.0
    werte = [
        _p1_pflicht_ampel(room_type, haupt, by_id),
        _anker_ampel(erg, haupt, by_id),
        _instanzzahl_ampel(room_type, area, haupt, erg),
        _auslastung_ampel(area, haupt, erg, by_id),
        _palette_ampel(auswahl, by_id, farben, profil.get("palette") or []),
        _flaechen_ampel(flaechen, room),
    ]
    return dict(zip(_AMPEL_LABELS, werte, strict=True))


def _zeichen(ok: bool) -> str:
    return "✅" if ok else "⚠️"


# --- Solver-Durchstich (optional, --solve) -----------------------------------


def _solve_durchstich(
    room: dict[str, Any],
    catalog: list[dict[str, Any]],
    regeln: list[dict[str, Any]],
    antwort: dict[str, Any],
    profil: dict[str, Any],
    seed: int,
) -> dict[str, Any]:
    """Generische `solve()`-Pipeline (wie `kurator_eval._miss`/`/solve` ohne
    `req.auswahl`) – auch für Küche die generische Auswahl, nicht
    `solve_kueche`. Nie ein harter Fehler: `NoFeasiblePlacement` ist ein
    ehrliches, meldbares Ergebnis (Konzept Engineering-Grundlagen §1)."""
    auswahl = antwort.get("auswahl") or []
    if not auswahl:
        return {"status": "uebersprungen", "grund": "leere Auswahl"}
    mengen = mengen_aus_antwort(antwort)
    gesamt = sum(mengen.get(i, 1) for i in auswahl)
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
    except NoFeasiblePlacement as exc:
        return {"status": "nicht_platzierbar", "grund": str(exc)}
    verletzt = plan["constraintReport"]["hard"]["summary"]["verletzt"]
    return {
        "status": "ok",
        "platziert": len(plan["placements"]),
        "instanzen_gesamt": gesamt,
        "verletzt": int(verletzt),
    }


def _render_solve_zeile(info: dict[str, Any]) -> str:
    if info["status"] == "uebersprungen":
        return f"Solver: übersprungen ({info['grund']})"
    if info["status"] == "nicht_platzierbar":
        return f"Solver: ⚠️ NoFeasiblePlacement ({info['grund']})"
    zeichen = "✅" if info["verletzt"] == 0 else "⚠️"
    return (
        f"Solver: {info['platziert']}/{info['instanzen_gesamt']} Instanzen platziert · "
        f"{zeichen} {info['verletzt']} ❌"
    )


# --- Kompakte Text-Darstellung der Kurator-Antwort ---------------------------


def _markante_achsen(style_vector: dict[str, float], n: int = 2) -> str:
    achsen = sorted(style_vector.items(), key=lambda kv: -abs(kv[1]))[:n]
    return ", ".join(f"{k} {v:+.2f}" for k, v in achsen) if achsen else "–"


def _namen(ids: list[str], by_id: dict[str, dict[str, Any]]) -> str:
    namen = [by_id[i]["name"] if i in by_id else f"?{i}" for i in ids]
    return ", ".join(namen) if namen else "keine"


def _ergaenzungen_zeile(erg: list[dict[str, Any]], by_id: dict[str, dict[str, Any]]) -> str:
    teile = []
    for e in erg:
        iid = e.get("itemId")
        name = by_id[iid]["name"] if iid in by_id else f"?{iid}"
        teile.append(f"{name} ×{e.get('anzahl', 1)}")
    return ", ".join(teile) if teile else "keine"


def _farben_zeile(farben: dict[str, str] | None, by_id: dict[str, dict[str, Any]]) -> str:
    if not farben:
        return "keine"
    teile = [
        f"{by_id[iid]['name'] if iid in by_id else '?' + iid}→{slug}"
        for iid, slug in farben.items()
    ]
    return ", ".join(teile) if teile else "keine"


def _flaechen_zeile(flaechen: dict[str, Any] | None) -> str:
    if not flaechen:
        return "keine"
    teile: list[str] = []
    boden = (flaechen.get("boden") or {}).get("material")
    if boden:
        teile.append(f"Boden {boden}")
    for w in sorted(flaechen.get("waende") or [], key=lambda w: w["wandIndex"]):
        bereich = w.get("bereich") or "voll"
        hoehe = f" bis {w['hoeheM']}m" if w.get("hoeheM") is not None else ""
        teile.append(f"Wand {w['wandIndex']} {w['material']} ({bereich}{hoehe})")
    return "; ".join(teile) if teile else "keine"


def _marker_liste(begruendung: str | None) -> list[str]:
    return list(dict.fromkeys(MARKER_MUSTER.findall(begruendung or "")))


def _render_kombination(
    raum_name: str,
    room: dict[str, Any],
    profil_name: str,
    profil: dict[str, Any],
    port_name: str,
    seed: int,
    antwort: dict[str, Any],
    haupt: list[str],
    erg: list[dict[str, Any]],
    by_id: dict[str, dict[str, Any]],
    ampeln: dict[str, tuple[bool, str]],
) -> str:
    area = room["shell"]["floor"].get("area") or 0.0
    achsen = _markante_achsen(profil.get("styleVector", {}))
    palette = ", ".join(profil.get("palette") or []) or "–"
    konzept = antwort.get("konzept") or "–"
    marker = _marker_liste(antwort.get("begruendung"))
    zeilen = [
        f"## {raum_name} ({area:.1f} m²) × {profil_name} × {port_name} · seed {seed}",
        f"Achsen: {achsen} · Palette: {palette}",
        "",
        f"Konzept: {konzept}",
        f"Haupt: {_namen(haupt, by_id)}",
        f"Ergänzungen: {_ergaenzungen_zeile(erg, by_id)}",
        f"Farben: {_farben_zeile(antwort.get('farben'), by_id)}",
        f"Flächen: {_flaechen_zeile(antwort.get('flaechen'))}",
        f"Marker: {', '.join(marker) if marker else 'keine'}",
        "",
        "Plausibilität:",
    ]
    zeilen += [f"- {_zeichen(ok)} {label}: {text}" for label, (ok, text) in ampeln.items()]
    return "\n".join(zeilen)


def _render_abschluss(zeilen: list[dict[str, Any]]) -> str:
    kopf = (
        "| Raum | Profil | Seed | Port | "
        + " | ".join(_AMPEL_KURZ[label] for label in _AMPEL_LABELS)
        + " |"
    )
    trenner = "|" + "---|" * (4 + len(_AMPEL_LABELS))
    rows = [kopf, trenner]
    for z in zeilen:
        werte = " | ".join(_zeichen(z["ampeln"][label][0]) for label in _AMPEL_LABELS)
        rows.append(f"| {z['raum']} | {z['profil']} | {z['seed']} | {z['port']} | {werte} |")
    ok = sum(1 for z in zeilen if all(v[0] for v in z["ampeln"].values()))
    rows.append("")
    rows.append(f"Zusammenfassung: {ok}/{len(zeilen)} Kombinationen ohne ⚠️")
    return "\n".join(rows)


# --- CLI ----------------------------------------------------------------------


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Kurator v3.1 Raum×Profil-Matrix mit Plausibilitäts-Ampeln "
        "(ADR-0014 Punkt 6) – EIN Befehl für Bryans Bauchgefühl-Check.",
    )
    parser.add_argument(
        "--raum",
        choices=sorted(RAEUME),
        default=None,
        help="Nur diesen Raumtyp prüfen (Default: alle drei).",
    )
    parser.add_argument(
        "--profil",
        choices=sorted(PROFILE),
        default=None,
        help="Nur dieses Stilprofil prüfen (Default: alle drei). In der Shell "
        'quoten, z.B. --profil "warm-natuerlich (extrem)".',
    )
    parser.add_argument(
        "--seeds",
        type=int,
        default=1,
        metavar="N",
        help="Seeds 1..N je Kombination (Default: 1).",
    )
    parser.add_argument(
        "--solve",
        action="store_true",
        help="Zusätzlich den generischen Solver-Durchstich je Kombination zeigen.",
    )
    parser.add_argument(
        "--json",
        type=Path,
        default=None,
        metavar="PFAD",
        help="Strukturierte Kopie des Reports zusätzlich als JSON schreiben.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    raeume = [args.raum] if args.raum else list(RAEUME)
    profile = [args.profil] if args.profil else list(PROFILE)
    seeds = list(range(1, args.seeds + 1))

    port: KuratorPort = waehle_port()
    zusatz = ""
    if port.name != "baseline":
        modell = getattr(port, "model", None)
        reasoning = getattr(port, "reasoning", None)
        zusatz = f" (Modell {modell}" + (f", Reasoning {reasoning}" if reasoning else "") + ")"
    print("# Kurator-Diagnose v3.1 (ADR-0014 Punkt 6)")
    print(
        f"Port: {port.name}{zusatz} · Räume: {', '.join(raeume)} · "
        f"Profile: {', '.join(profile)} · Seeds: {', '.join(str(s) for s in seeds)}"
    )
    print()

    zeilen: list[dict[str, Any]] = []
    for raum_name in raeume:
        room = _lade_raum(raum_name)
        catalog = _lade_katalog(raum_name)
        by_id = {c["id"]: c for c in catalog}
        regeln = _lade_regeln(raum_name) if args.solve else []

        for profil_name in profile:
            profil = PROFILE[profil_name]
            for seed in seeds:
                antwort = port.kuratiere(profil, room, catalog, None, seed)
                haupt, erg = _extrahiere_ebenen(antwort)
                auswahl = antwort.get("auswahl") or []
                farben = antwort.get("farben")
                flaechen = antwort.get("flaechen")
                ampeln = _ampeln_pruefen(room, profil, haupt, erg, auswahl, farben, flaechen, by_id)

                print(
                    _render_kombination(
                        raum_name,
                        room,
                        profil_name,
                        profil,
                        port.name,
                        seed,
                        antwort,
                        haupt,
                        erg,
                        by_id,
                        ampeln,
                    )
                )
                eintrag: dict[str, Any] = {
                    "raum": raum_name,
                    "flaeche_m2": room["shell"]["floor"].get("area") or 0.0,
                    "profil": profil_name,
                    "seed": seed,
                    "port": port.name,
                    "konzept": antwort.get("konzept"),
                    "hauptObjekte": haupt,
                    "ergaenzungen": erg,
                    "farben": farben,
                    "flaechen": flaechen,
                    "marker": _marker_liste(antwort.get("begruendung")),
                    "ampeln": ampeln,
                }
                if args.solve:
                    info = _solve_durchstich(room, catalog, regeln, antwort, profil, seed)
                    print(_render_solve_zeile(info))
                    eintrag["solve"] = info
                print()
                zeilen.append(eintrag)

    print(_render_abschluss(zeilen))

    if args.json:
        export = {
            "matrix": {"raeume": raeume, "profile": profile, "seeds": seeds},
            "port": port.name,
            "kombinationen": [
                {
                    **{k: v for k, v in z.items() if k != "ampeln"},
                    "ampeln": {
                        label: {"ok": ok, "text": text} for label, (ok, text) in z["ampeln"].items()
                    },
                }
                for z in zeilen
            ],
        }
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(
            json.dumps(export, indent=2, ensure_ascii=False, sort_keys=False) + "\n",
            encoding="utf-8",
        )
        print(f"\nJSON geschrieben: {args.json}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
