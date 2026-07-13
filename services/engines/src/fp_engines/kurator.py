"""Kurator-Port: «KI wählt, Solver platziert» (Kurator-Mechanik-Detailkonzept).

Pipeline v2 – **drei entkoppelte LLM-Calls**, jeder mit eigener Validierung,
Repair-Retry (max. 1) und Fallback:

- **Call A – Auswahl:** WAS kommt in den Raum (wie bisher). Scheitert A auch
  nach Repair → **alles Baseline** (B/C brauchen die Auswahl).
- **Call B – Anordnung:** weiche Anordnungs-Anweisungen je Item (wandIndex,
  relationen, prioritaet). Scheitert B → **Teil-Fallback**: `anordnung` aus den
  Katalog-`relationalRules` (ohne wandIndex).
- **Call C – Flächen:** Boden-/Wand-Material-Wünsche (nur geerdete Slugs). Zwei
  harte Kontrollen «davor UND danach»: strukturell (Slugs/Bereiche) UND
  normativ (`pruefe_flaechen` gegen `data/rules/flaechen.json`: wasserfester
  Bad-Boden, verfliesste Nasswände usw.). Bei Norm-Verstoss 1 Repair-Retry,
  sonst deterministische `korrigiere_flaechen` (macht konform statt verwerfen).
  Scheitert der Call strukturell/per HTTP → **Teil-Fallback** `flaechen = None`.

Doppelte Erdung bleibt: das Modell sieht nur vorgefilterte IDs / erlaubte Slugs
UND jede Antwort wird gegen genau diese Mengen validiert – Halluzination ist
konstruktiv ausgeschlossen. Die Möbel-Norm-Garantie hängt weiterhin einzig am
Feasibility-Filter des Solvers; die **Flächen-Norm** (Material je Zone) wird
zusätzlich hart über `pruefe_flaechen`/`korrigiere_flaechen` erzwungen.

Drei Port-Implementierungen (ADR-0007, austauschbar):
- `baseline`  – deterministisches Scoring mit Seed-Rauschen, immer verfügbar.
- `llm-api`   – gehostetes OpenAI-kompatibles API (POC-Empfehlung; nur
                Sample-Daten → zulässig; echte Raumdaten erst self-hosted/CH).
- (`llm-local` via Ollama nutzt denselben Code: FP_KURATOR_URL auf
  http://localhost:11434/v1 zeigen lassen.)

Konfiguration über Umgebungsvariablen: FP_KURATOR_URL, FP_KURATOR_MODEL,
FP_KURATOR_API_KEY. Ohne URL läuft die Baseline (Eval-Gate: Kurator muss die
Baseline erst schlagen).
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import random
from collections.abc import Callable
from pathlib import Path
from typing import Any, Protocol, TypeGuard

import httpx

REPO_ROOT = Path(__file__).resolve().parents[4]
PROMPT_DIR = REPO_ROOT / "data" / "prompts"
PROMPT_AUSWAHL = PROMPT_DIR / "kurator-rolle.md"
PROMPT_ANORDNUNG = PROMPT_DIR / "kurator-anordnung.md"
PROMPT_FLAECHEN = PROMPT_DIR / "kurator-flaechen.md"
SCHEMA_DATEI = REPO_ROOT / "packages" / "shared" / "schemas" / "kurator-vertrag.schema.json"
FLAECHEN_REGELN_DATEI = REPO_ROOT / "data" / "rules" / "flaechen.json"
KANDIDATEN_JE_SLOT = 6  # Top 5–8 laut Konzept; kein RAG nötig im POC

log = logging.getLogger("fp.kurator")

P1_PFLICHT: dict[str, list[str]] = {"bad": ["wc", "lavabo", "dusche"]}
# prioritaet-Defaults für die Baseline-Anordnung: Kern zuerst, Deko zuletzt.
_PRIO_KLASSE: dict[str, int] = {"P1": 1, "P2": 2, "P3": 3}


def _material_slugs() -> list[str]:
    """Geerdete Material-Slug-Liste – EINZIGE Quelle ist das Schema-Enum.

    So sehen TS (via Codegen als Union-Typ) und Python (dieser Laufzeit-Read)
    garantiert dieselbe Liste; Drift ist ausgeschlossen.
    """
    daten = json.loads(SCHEMA_DATEI.read_text(encoding="utf-8"))
    return list(daten["$defs"]["materialSlug"]["enum"])


MATERIAL_SLUGS: list[str] = _material_slugs()


def _lade_flaechen_regeln() -> list[dict[str, Any]]:
    """Flächen-Normregeln (`data/rules/flaechen.json`) – deklaratives Format.

    Bewusst **getrennt** vom Geometrie-Regelsatz und dem TS/Python-Paritätstest:
    diese Datei liest einzig die Python-Seite, zur harten Kontrolle des KI-
    Flächen-Calls (Call C). Format je Eintrag: `id`, `roomType`, `gilt`
    (`boden`|`wand-nass`|`wand-alle`), `anforderung`, optional `minHoeheM`,
    `erlaubteMaterialien` (Slugs), `severity`, `quelle`, `status`, `hinweis`.
    """
    return list(json.loads(FLAECHEN_REGELN_DATEI.read_text(encoding="utf-8")))


FLAECHEN_REGELN: list[dict[str, Any]] = _lade_flaechen_regeln()


def _cos(a: dict[str, float], b: dict[str, float]) -> float:
    """Cosinus-Ähnlichkeit über gemeinsame Achsen; 0 bei leeren Vektoren."""
    achsen = set(a) | set(b)
    if not achsen:
        return 0.0
    skalar = sum(a.get(k, 0.0) * b.get(k, 0.0) for k in achsen)
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    return skalar / (na * nb) if na and nb else 0.0


def stil_score(stilprofil: dict[str, Any], item: dict[str, Any]) -> float:
    """Vorfilter-Score: Stil-Nähe + Boost aus abgeleiteten Anforderungen."""
    score = _cos(stilprofil.get("styleVector", {}), item.get("achsenTags", {}))
    anforderungen = set(stilprofil.get("derivedRequirements", []))
    if anforderungen & set(item.get("attributTags", [])):
        score += 0.25
    return score


def vorfilter(
    stilprofil: dict[str, Any],
    room: dict[str, Any],
    catalog: list[dict[str, Any]],
    budget: float | None,
) -> dict[str, list[dict[str, Any]]]:
    """Erste Erdungsstufe: deterministische Kandidatenliste je Slot.

    Slots = P1-Pflicht-funktionsTypen + alle P2/P3-funktionsTypen des Raumtyps.
    """
    room_type = room["roomType"]
    passend = [c for c in catalog if room_type in c["roomTypes"]]
    slots: dict[str, list[dict[str, Any]]] = {}
    for item in passend:
        if budget is not None and item["preis"]["value"] > budget:
            continue
        slots.setdefault(item["funktionsTyp"], []).append(item)
    for typ, items in slots.items():
        items.sort(key=lambda i: (-stil_score(stilprofil, i), i["id"]))
        slots[typ] = items[:KANDIDATEN_JE_SLOT]
    return slots


# --- Baseline-Anordnung (Teil-Fallback für Call B) --------------------------


def _baseline_anordnung(
    auswahl: list[str], by_id: dict[str, dict[str, Any]]
) -> list[dict[str, Any]]:
    """`anordnung` aus den Katalog-`relationalRules` (ohne wandIndex).

    prioritaet nach priorityClass (P1 vor P2 vor P3). Das ist genau das Wissen,
    das der Solver schon aus `relationaleAbsichten` zog – hier nur zusätzlich als
    Vertrags-`anordnung` ausgewiesen, damit die Antwort-Shape mit dem LLM-Weg
    kompatibel bleibt.
    """
    out: list[dict[str, Any]] = []
    for iid in auswahl:
        item = by_id[iid]
        eintrag: dict[str, Any] = {
            "itemId": iid,
            "prioritaet": _PRIO_KLASSE.get(item["priorityClass"], 3),
        }
        regeln = item.get("relationalRules") or []
        if regeln:
            eintrag["relationen"] = list(regeln)
        out.append(eintrag)
    return out


def _absichten_aus_anordnung(anordnung: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Flacht `anordnung` in die klassischen `relationaleAbsichten` (je Relation
    ein Eintrag). Hält die Antwort schema-kompatibel und Alt-Konsumenten am Laufen.
    """
    out: list[dict[str, Any]] = []
    for e in anordnung:
        for rel in e.get("relationen") or []:
            out.append({"itemId": e["itemId"], "relation": rel})
    return out


# --- Validierung je Call (hart) ---------------------------------------------


def _validiere(
    antwort: dict[str, Any],
    slots: dict[str, list[dict[str, Any]]],
    room_type: str,
    budget: float | None,
) -> str | None:
    """Call A: harte Validierung (Konzept §4). None = ok, sonst Fehlerhinweis."""
    if not isinstance(antwort.get("auswahl"), list) or not antwort["auswahl"]:
        return "Feld «auswahl» fehlt oder ist leer."
    erlaubte = {i["id"]: i for items in slots.values() for i in items}
    fremde = [i for i in antwort["auswahl"] if i not in erlaubte]
    if fremde:
        return f"IDs ausserhalb der Kandidatenliste: {fremde}. Nur gelistete IDs wählen."
    gewaehlt_typen = {erlaubte[i]["funktionsTyp"] for i in antwort["auswahl"]}
    fehlend = [t for t in P1_PFLICHT.get(room_type, []) if t in slots and t not in gewaehlt_typen]
    if fehlend:
        return f"P1-Pflicht-Slots unbesetzt: {fehlend}."
    if budget is not None:
        summe = sum(erlaubte[i]["preis"]["value"] for i in antwort["auswahl"])
        if summe > budget:
            return f"Budget überschritten: {summe} > {budget}."
    for rel in antwort.get("relationaleAbsichten", []):
        if rel.get("itemId") not in erlaubte:
            return f"relationaleAbsichten verweist auf unbekannte ID: {rel.get('itemId')}."
    return None


def _ist_int(v: Any) -> TypeGuard[int]:
    """Echte Ganzzahl (bool ist in Python eine int-Unterklasse → ausschliessen)."""
    return isinstance(v, int) and not isinstance(v, bool)


def _validiere_anordnung(antwort: dict[str, Any], auswahl: list[str], n_walls: int) -> str | None:
    """Call B: `anordnung` prüfen. itemIds ⊆ Auswahl, wandIndex im Bereich,
    relationen = Liste von Strings (Grammatik NICHT hier – unbekannte ignoriert
    der Parser später), prioritaet ganzzahlig. None = ok."""
    anordnung = antwort.get("anordnung")
    if not isinstance(anordnung, list):
        return "Feld «anordnung» fehlt oder ist keine Liste."
    erlaubt = set(auswahl)
    for e in anordnung:
        if not isinstance(e, dict):
            return "anordnung-Eintrag ist kein Objekt."
        if e.get("itemId") not in erlaubt:
            return f"anordnung verweist auf Item ausserhalb der Auswahl: {e.get('itemId')}."
        wi = e.get("wandIndex")
        if wi is not None and (not _ist_int(wi) or wi < 0 or wi >= n_walls):
            return f"wandIndex {wi} ausserhalb 0..{n_walls - 1}."
        rel = e.get("relationen")
        if rel is not None and (
            not isinstance(rel, list) or any(not isinstance(r, str) for r in rel)
        ):
            return "«relationen» muss eine Liste von Strings sein."
        pr = e.get("prioritaet")
        if pr is not None and not _ist_int(pr):
            return "«prioritaet» muss eine ganze Zahl sein."
    return None


def _validiere_flaechen(antwort: dict[str, Any], n_walls: int, slugs: list[str]) -> str | None:
    """Call C: `flaechen` prüfen. Slugs ⊆ Liste, wandIndex im Bereich,
    hoeheM 0.3–3.0. None = ok."""
    fl = antwort.get("flaechen")
    if not isinstance(fl, dict):
        return "Feld «flaechen» fehlt oder ist kein Objekt."
    erlaubt = set(slugs)
    boden = fl.get("boden")
    if boden is not None:
        if not isinstance(boden, dict):
            return "«boden» muss ein Objekt sein."
        mat = boden.get("material")
        if mat is not None and mat not in erlaubt:
            return f"Boden-Material «{mat}» nicht in der Slug-Liste."
    waende = fl.get("waende")
    if waende is not None:
        if not isinstance(waende, list):
            return "«waende» muss eine Liste sein."
        for w in waende:
            if not isinstance(w, dict):
                return "waende-Eintrag ist kein Objekt."
            wi = w.get("wandIndex")
            if not _ist_int(wi) or wi < 0 or wi >= n_walls:
                return f"wandIndex {wi} ausserhalb 0..{n_walls - 1}."
            mat = w.get("material")
            if mat not in erlaubt:
                return f"Wand-Material «{mat}» nicht in der Slug-Liste."
            h = w.get("hoeheM")
            if h is not None and (
                not isinstance(h, int | float) or isinstance(h, bool) or h < 0.3 or h > 3.0
            ):
                return f"hoeheM {h} ausserhalb 0.3..3.0."
            ber = w.get("bereich")
            if ber is not None and ber not in ("voll", "halbhoch", "sockel"):
                return f"bereich «{ber}» unbekannt."
    return None


# --- Flächen-Normregeln (Daten) + harte Kontrolle des LLM-Outputs -----------


def _punkt_segment_abstand(p: list[float], a: list[float], b: list[float]) -> float:
    """Kürzester Abstand Punkt→Wandsegment (Grundriss x/z-Ebene, Meter)."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    laenge2 = dx * dx + dy * dy
    if laenge2 == 0.0:
        return math.hypot(p[0] - a[0], p[1] - a[1])
    t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / laenge2
    t = max(0.0, min(1.0, t))
    return math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))


_NASS_TYPEN = frozenset({"wasser", "abwasser"})


def nasswaende(room: dict[str, Any], schwelle_m: float = 0.5) -> set[int]:
    """Indizes der Nassbereich-Wände (Proxy für Dusche/Wanne/Lavabo).

    Heuristik: eine Wand gilt als «nass», wenn ein Wasser-/Abwasser-Fixpunkt an
    ihr hängt (`fixpoint.wall` == Wand-ID) ODER geometrisch ≤ `schwelle_m`
    (Default 0.5 m) an ihrem Segment liegt (boden-/freistehende Fixpunkte, z.B.
    Dusch-Bodenablauf). Zum Call-C-Zeitpunkt steht die Möbel-PLATZIERUNG noch
    nicht fest – die Anschluss-Fixpunkte des Raummodells sind aber der
    verlässliche Proxy für den Nassbereich.
    """
    walls = room["shell"]["walls"]
    id_index = {w["id"]: i for i, w in enumerate(walls)}
    treffer: set[int] = set()
    for f in room.get("fixpoints", []):
        if f.get("type") not in _NASS_TYPEN:
            continue
        wid = f.get("wall")
        if wid in id_index:
            treffer.add(id_index[wid])
            continue
        pos = f.get("position")
        if not pos:
            continue
        for i, w in enumerate(walls):
            if _punkt_segment_abstand(pos, w["start"], w["end"]) <= schwelle_m:
                treffer.add(i)
    return treffer


_BEREICH_DEFAULT_HOEHE: dict[str, float] = {"halbhoch": 1.2, "sockel": 0.1}


def _wand_deckhoehe(eintrag: dict[str, Any]) -> float:
    """Effektive Höhe der Materialzone ab Boden (m). «voll»/ohne bereich = ganze
    Wand (∞); sonst hoeheM, sonst Bereichs-Default – identisch zum Client
    (oberflaechen.ts: HALBHOCH 1.2, SOCKEL 0.1)."""
    bereich = eintrag.get("bereich")
    if bereich not in ("halbhoch", "sockel"):
        return math.inf  # «voll»/ohne bereich/unbekannt = ganze Wand
    h = eintrag.get("hoeheM")
    if isinstance(h, int | float) and not isinstance(h, bool):
        return float(h)
    if bereich == "sockel":
        return _BEREICH_DEFAULT_HOEHE["sockel"]
    return _BEREICH_DEFAULT_HOEHE["halbhoch"]


def pruefe_flaechen(
    flaechen: dict[str, Any] | None,
    room: dict[str, Any],
    regeln: list[dict[str, Any]],
) -> list[str]:
    """Harte Flächen-Norm-Kontrolle (Call C) – deterministisch, quellenunabhängig.

    Prüft das (strukturell bereits validierte) `flaechen`-Objekt gegen die
    Flächen-Normregeln des Raumtyps und liefert die Liste konkreter Verstöße
    (leer = konform). Gilt für JEDE Quelle (LLM heute, manuelle Eingaben
    künftig). `gilt`-Semantik:

    - `boden`: `boden.material` muss in `erlaubteMaterialien` liegen.
    - `wand-nass`: jede Nasswand (siehe `nasswaende`) braucht einen Eintrag mit
      erlaubtem Material, das ab Boden ≥ `minHoeheM` deckt (fehlender Eintrag,
      falsches Material oder zu niedrige Zone = Verstoß).
    - `wand-alle`: jeder EXPLIZIT belegte Wand-Eintrag muss ein erlaubtes
      (wasserfestes) Material haben – die Zone liegt am Boden. Trockene Wände
      bleiben unbelegt (Client-Fallback) statt mit Putz/Tapete belegt.

    `flaechen=None`/leer → keine Verstöße (der Fallback-Pfad leitet selbst ab).
    """
    if not flaechen:
        return []
    aktiv = [r for r in regeln if r["roomType"] == room["roomType"]]
    if not aktiv:
        return []
    boden_mat = (flaechen.get("boden") or {}).get("material")
    pro_wand: dict[int, dict[str, Any]] = {w["wandIndex"]: w for w in flaechen.get("waende") or []}
    nass = nasswaende(room)
    verstoesse: list[str] = []
    for regel in aktiv:
        rid, gilt, anf = regel["id"], regel["gilt"], regel["anforderung"]
        erlaubt = set(regel["erlaubteMaterialien"])
        if gilt == "boden":
            if boden_mat is not None and boden_mat not in erlaubt:
                verstoesse.append(
                    f"[{rid}] Boden-Material «{boden_mat}» nicht {anf} "
                    f"(erlaubt: {sorted(erlaubt)})."
                )
        elif gilt == "wand-nass":
            minh = float(regel.get("minHoeheM", 0.0))
            for i in sorted(nass):
                e = pro_wand.get(i)
                if e is None:
                    verstoesse.append(
                        f"[{rid}] Nasswand {i} unverkleidet – braucht {anf}es Material "
                        f"bis ≥ {minh} m."
                    )
                elif e["material"] not in erlaubt:
                    verstoesse.append(
                        f"[{rid}] Nasswand {i}: Material «{e['material']}» nicht {anf} "
                        f"(erlaubt: {sorted(erlaubt)})."
                    )
                elif _wand_deckhoehe(e) < minh:
                    verstoesse.append(
                        f"[{rid}] Nasswand {i}: Verkleidung nur bis {_wand_deckhoehe(e)} m, "
                        f"gefordert ≥ {minh} m (bereich «voll» oder hoeheM ≥ {minh})."
                    )
        elif gilt == "wand-alle":
            for i, e in sorted(pro_wand.items()):
                if e["material"] not in erlaubt:
                    verstoesse.append(
                        f"[{rid}] Wand {i}: Material «{e['material']}» am Boden nicht {anf} "
                        f"(erlaubt: {sorted(erlaubt)}); trockene Wand sonst weglassen."
                    )
    return verstoesse


def _konformes_material(erlaubt: set[str]) -> str:
    """Konformer Standard-Slug: bevorzugt «fliesen-hell», sonst alphabetisch erster."""
    return "fliesen-hell" if "fliesen-hell" in erlaubt else sorted(erlaubt)[0]


def korrigiere_flaechen(
    flaechen: dict[str, Any] | None,
    room: dict[str, Any],
    regeln: list[dict[str, Any]],
) -> dict[str, Any]:
    """Deterministische Norm-Korrektur: macht JEDEN Verstoß aus `pruefe_flaechen`
    konform, statt das Flächen-Konzept komplett zu verwerfen.

    Regel für Regel (Reihenfolge = Datei): verletzende Boden-/Wand-Materialien
    werden auf ein konformes Material (i.d.R. «fliesen-hell») gesetzt, fehlende
    Nasswände als «voll» ergänzt, zu niedrige Nassverkleidung auf «voll»
    gehoben. Arbeitet auf einer tiefen Kopie und ist idempotent: danach gilt
    `pruefe_flaechen(...) == []`.
    """
    fl: dict[str, Any] = json.loads(json.dumps(flaechen or {}))
    aktiv = [r for r in regeln if r["roomType"] == room["roomType"]]
    if any(r["gilt"].startswith("wand") for r in aktiv):
        fl.setdefault("waende", [])
    nass = nasswaende(room)
    pro_wand: dict[int, dict[str, Any]] = {w["wandIndex"]: w for w in fl.get("waende", [])}
    for regel in aktiv:
        erlaubt = set(regel["erlaubteMaterialien"])
        fix = _konformes_material(erlaubt)
        gilt = regel["gilt"]
        if gilt == "boden":
            boden = fl.get("boden")
            if boden and boden.get("material") is not None and boden["material"] not in erlaubt:
                boden["material"] = fix
        elif gilt == "wand-nass":
            minh = float(regel.get("minHoeheM", 0.0))
            for i in sorted(nass):
                e = pro_wand.get(i)
                if e is None:
                    e = {"wandIndex": i, "material": fix, "bereich": "voll"}
                    fl["waende"].append(e)
                    pro_wand[i] = e
                    continue
                if e["material"] not in erlaubt:
                    e["material"] = fix
                if _wand_deckhoehe(e) < minh:
                    e["bereich"] = "voll"
                    e.pop("hoeheM", None)
        elif gilt == "wand-alle":
            for e in fl.get("waende", []):
                if e["material"] not in erlaubt:
                    e["material"] = fix
    return fl


# --- Kompakte Raumgeometrie für die Prompts ---------------------------------


def _wandliste(room: dict[str, Any]) -> list[str]:
    """Wände 0-basiert als kompakte Zeilen: Index · Länge · massiv/offen ·
    Öffnungen · Anschlüsse. Grundlage für Call B (wandIndex) und Call C."""
    walls = room["shell"]["walls"]
    oeffnungen: dict[str, list[str]] = {}
    for o in room.get("openings", []):
        oeffnungen.setdefault(o["hostWall"], []).append(o["type"])
    anschluesse: dict[str, list[str]] = {}
    for f in room.get("fixpoints", []):
        w = f.get("wall")
        if w:
            anschluesse.setdefault(w, []).append(f["type"])
    zeilen: list[str] = []
    for i, w in enumerate(walls):
        laenge = math.hypot(w["end"][0] - w["start"][0], w["end"][1] - w["start"][1])
        teile = [f"Wand {i}", f"{laenge:.2f} m", "massiv" if w["kind"] == "massiv" else "offen"]
        oe = sorted(set(oeffnungen.get(w["id"], [])))
        teile.append("Öffnungen: " + ", ".join(oe) if oe else "keine Öffnung")
        an = sorted(set(anschluesse.get(w["id"], [])))
        if an:
            teile.append("Anschlüsse: " + ", ".join(an))
        zeilen.append(" · ".join(teile))
    return zeilen


class KuratorPort(Protocol):
    """Austauschbare Schnittstelle – Request/Response = Kurator-Vertrag (Vertrag 7)."""

    name: str

    def kuratiere(
        self,
        stilprofil: dict[str, Any],
        room: dict[str, Any],
        catalog: list[dict[str, Any]],
        budget: float | None,
        seed: int,
    ) -> dict[str, Any]: ...


class BaselineKurator:
    """Deterministisches Scoring + Seed-Rauschen – immer verfügbar, offline, gratis.

    Zugleich der Vergleichsmassstab der Mini-Eval (Gate: LLM muss das schlagen).
    Liefert zusätzlich `anordnung` (aus relationalRules, prioritaet nach
    priorityClass) und `flaechen=None` (Client leitet Flächen deterministisch ab).
    """

    name = "baseline"

    def kuratiere(
        self,
        stilprofil: dict[str, Any],
        room: dict[str, Any],
        catalog: list[dict[str, Any]],
        budget: float | None,
        seed: int,
    ) -> dict[str, Any]:
        rnd = random.Random(seed)
        slots = vorfilter(stilprofil, room, catalog, budget)
        auswahl: list[str] = []
        absichten: list[dict[str, Any]] = []
        rest_budget = budget if budget is not None else math.inf
        # Flächen-Daumenregel: Footprint × 2.5 (inkl. Bewegungsfläche) muss in
        # die Rest-Bodenfläche passen – kleines Gäste-WC wählt ehrlich die
        # Teilmenge (Norm-Regelsatz-v0) statt den Solver scheitern zu lassen.
        rest_flaeche = room["shell"]["floor"].get("area") or 0.0

        def nimm(typ: str) -> None:
            nonlocal rest_budget, rest_flaeche
            kandidaten = [
                i
                for i in slots.get(typ, [])
                if i["preis"]["value"] <= rest_budget
                and (
                    i.get("mount") == "wand"
                    or i["masse"]["w"] * i["masse"]["d"] * 2.5 <= rest_flaeche
                )
            ]
            if not kandidaten:
                return
            # Seed-Rauschen erhält Variation, ohne den Score zu dominieren.
            bester = max(
                kandidaten,
                key=lambda i: stil_score(stilprofil, i) + rnd.uniform(0, 0.1),
            )
            auswahl.append(bester["id"])
            rest_budget -= bester["preis"]["value"]
            if bester.get("mount") != "wand":
                rest_flaeche -= bester["masse"]["w"] * bester["masse"]["d"] * 2.5
            for rel in bester.get("relationalRules", []):
                absichten.append({"itemId": bester["id"], "relation": rel})

        for typ in P1_PFLICHT.get(room["roomType"], []):
            nimm(typ)
        p1_typen = set(P1_PFLICHT.get(room["roomType"], []))
        # Rest nach priorityClass (P1 Kern → P2 Funktion → P3 Ergänzung), innerhalb
        # der Klasse alphabetisch (deterministisch). Ohne diese Ordnung würden bei
        # Raumtypen ohne P1_PFLICHT-Eintrag (wohnen/kueche) alphabetisch frühe
        # P3-Ergänzungen (z.B. «barwagen», «recamiere») die knappe Flächen-
        # Daumenregel aufbrauchen, bevor spätere P1-Kernmöbel («sofa») drankommen.
        _RANG = {"P1": 0, "P2": 1, "P3": 2}

        def _slot_rang(typ: str) -> int:
            return min(_RANG.get(i["priorityClass"], 3) for i in slots[typ])

        for typ in sorted(set(slots) - p1_typen, key=lambda t: (_slot_rang(t), t)):
            nimm(typ)

        by_id = {c["id"]: c for c in catalog}
        return {
            "auswahl": auswahl,
            "relationaleAbsichten": absichten,
            "anordnung": _baseline_anordnung(auswahl, by_id),
            "flaechen": None,
            "begruendung": "Deterministische Baseline: bestes Item je Slot nach "
            "Stil-Score (cos zu den Achsen-Tags) mit Seed-Rauschen.",
        }


class LlmKurator:
    """Gehostetes/lokales LLM über OpenAI-kompatibles Chat-API – Pipeline v2.

    Drei entkoppelte Calls (Auswahl/Anordnung/Flächen), jeder einzeln geloggt und
    mit eigenem Validierung+Repair+Fallback. Strukturierte Ausgabe wird per
    response_format angefordert; die harte Validierung + Repair + Fallback machen
    Formatfehler trotzdem unschädlich (Constrained Decoding im engeren Sinn kommt
    mit dem Serving-Entscheid).
    """

    name = "llm-api"

    def __init__(self, url: str, model: str, api_key: str | None, timeout_s: float = 30.0):
        self.url = url.rstrip("/")
        self.model = model
        self.api_key = api_key
        self.timeout_s = timeout_s

    # --- Prompt-Bau ---------------------------------------------------------

    def _prompt_auswahl(
        self,
        stilprofil: dict[str, Any],
        room: dict[str, Any],
        slots: dict[str, list[dict[str, Any]]],
        budget: float | None,
    ) -> list[dict[str, str]]:
        rolle = PROMPT_AUSWAHL.read_text(encoding="utf-8")
        fakten = [
            f"Raumtyp: {room['roomType']} · Fläche: {room['shell']['floor'].get('area')} m²",
            f"Fixpunkte: {sorted({f['type'] for f in room['fixpoints']})}",
            f"Öffnungen: {sorted({o['type'] for o in room['openings']})}",
        ]
        profil = [
            f"Stilvektor: {json.dumps(stilprofil.get('styleVector', {}), ensure_ascii=False)}",
            f"Anforderungen: {stilprofil.get('derivedRequirements', [])}",
            f"Palette: {stilprofil.get('palette', [])}",
        ]
        kandidaten = []
        p1 = set(P1_PFLICHT.get(room["roomType"], []))
        for typ, items in sorted(slots.items()):
            pflicht = " (P1-PFLICHT)" if typ in p1 else ""
            kandidaten.append(f"Slot {typ}{pflicht}:")
            for i in items:
                m = i["masse"]
                kandidaten.append(
                    f"  {i['id']} · {i['name']} · {m['w']}×{m['d']}×{m['h']} m · "
                    f"Tags {json.dumps(i.get('achsenTags', {}), ensure_ascii=False)} · "
                    f"CHF {i['preis']['value']}"
                )
        budget_zeile = f"Budget: CHF {budget}" if budget is not None else "Budget: keines"
        return [
            {"role": "system", "content": rolle},
            {
                "role": "user",
                "content": "\n".join(
                    [
                        "## Raumfakten",
                        *fakten,
                        "",
                        "## Stilprofil",
                        *profil,
                        "",
                        "## Kandidaten",
                        *kandidaten,
                        "",
                        budget_zeile,
                    ]
                ),
            },
        ]

    def _prompt_anordnung(
        self, auswahl: list[str], by_id: dict[str, dict[str, Any]], room: dict[str, Any]
    ) -> list[dict[str, str]]:
        rolle = PROMPT_ANORDNUNG.read_text(encoding="utf-8")
        items = []
        for iid in auswahl:
            it = by_id[iid]
            m = it["masse"]
            items.append(
                f"  {iid} · {it['name']} · funktionsTyp {it['funktionsTyp']} · "
                f"{m['w']}×{m['d']}×{m['h']} m · {it['priorityClass']}"
            )
        return [
            {"role": "system", "content": rolle},
            {
                "role": "user",
                "content": "\n".join(
                    [
                        "## Auswahl (nur diese itemIds verwenden)",
                        *items,
                        "",
                        "## Raumgeometrie – Wände (0-basierter wandIndex)",
                        *_wandliste(room),
                    ]
                ),
            },
        ]

    def _prompt_flaechen(
        self, stilprofil: dict[str, Any], room: dict[str, Any]
    ) -> list[dict[str, str]]:
        rolle = PROMPT_FLAECHEN.read_text(encoding="utf-8")
        profil = [
            f"Stilvektor: {json.dumps(stilprofil.get('styleVector', {}), ensure_ascii=False)}",
            f"Anforderungen: {stilprofil.get('derivedRequirements', [])}",
            f"Palette: {stilprofil.get('palette', [])}",
        ]
        return [
            {"role": "system", "content": rolle},
            {
                "role": "user",
                "content": "\n".join(
                    [
                        f"## Raum\nRaumtyp: {room['roomType']}",
                        "",
                        "## Stilprofil",
                        *profil,
                        "",
                        "## Wände (0-basierter wandIndex)",
                        *_wandliste(room),
                        "",
                        "## Erlaubte Material-Slugs (NUR daraus wählen)",
                        ", ".join(MATERIAL_SLUGS),
                    ]
                ),
            },
        ]

    # --- LLM-Aufruf + generischer Repair-Runner -----------------------------

    def _rufe_llm(self, messages: list[dict[str, str]]) -> dict[str, Any]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        res = httpx.post(
            f"{self.url}/chat/completions",
            headers=headers,
            json={
                "model": self.model,
                "messages": messages,
                "temperature": 0.7,
                "response_format": {"type": "json_object"},
            },
            timeout=self.timeout_s,
        )
        res.raise_for_status()
        inhalt = res.json()["choices"][0]["message"]["content"]
        log.info(
            "kurator llm antwort, prompt_hash=%s",
            hashlib.sha256(json.dumps(messages).encode()).hexdigest()[:12],
        )
        return json.loads(inhalt)  # type: ignore[no-any-return]

    def _call_json(
        self,
        messages: list[dict[str, str]],
        validiere: Callable[[dict[str, Any]], str | None],
        name: str,
    ) -> dict[str, Any] | None:
        """Ein LLM-Call mit Validierung + max. 1 Repair-Retry. None = gescheitert.

        Jeder Call ist einzeln geloggt; scheitert er, entscheidet der Aufrufer über
        den (Teil-)Fallback – nie ein harter Fehler nach oben.
        """
        try:
            antwort = self._rufe_llm(messages)
            fehler = validiere(antwort)
            if fehler is not None:
                # Repair-Retry (max. 1) mit konkretem Fehlerhinweis (Konzept §5).
                messages = [
                    *messages,
                    {"role": "assistant", "content": json.dumps(antwort)},
                    {
                        "role": "user",
                        "content": f"Deine Antwort ist ungültig: {fehler} "
                        "Korrigiere und antworte erneut nur mit JSON.",
                    },
                ]
                antwort = self._rufe_llm(messages)
                fehler = validiere(antwort)
            if fehler is None:
                return antwort
            log.warning("kurator[%s]: nach repair weiterhin ungültig (%s)", name, fehler)
        except (httpx.HTTPError, json.JSONDecodeError, KeyError) as e:
            log.warning("kurator[%s]: llm-aufruf fehlgeschlagen (%s)", name, e)
        return None

    def _flaechen_norm_repair(
        self,
        basis_messages: list[dict[str, str]],
        voriges: dict[str, Any],
        verstoesse: list[str],
        n_walls: int,
        room: dict[str, Any],
    ) -> dict[str, Any] | None:
        """Ein einziger Norm-Repair-Aufruf: gibt die konkreten Verstöße zurück ans
        LLM und verlangt eine korrigierte Antwort. Rückgabe = strukturell UND
        normkonformes `flaechen`-Objekt, sonst None (dann greift die
        deterministische `korrigiere_flaechen`)."""
        hinweis = (
            "Deine Flächen-Antwort verletzt harte Normregeln:\n- "
            + "\n- ".join(verstoesse)
            + "\nKorrigiere GENAU diese Punkte und antworte erneut nur mit JSON."
        )
        messages = [
            *basis_messages,
            {"role": "assistant", "content": json.dumps({"flaechen": voriges})},
            {"role": "user", "content": hinweis},
        ]
        try:
            antwort = self._rufe_llm(messages)
        except (httpx.HTTPError, json.JSONDecodeError, KeyError) as e:
            log.warning("kurator[flaechen-norm]: repair-aufruf fehlgeschlagen (%s)", e)
            return None
        if _validiere_flaechen(antwort, n_walls, MATERIAL_SLUGS) is not None:
            return None
        flaechen: dict[str, Any] = antwort["flaechen"]
        if pruefe_flaechen(flaechen, room, FLAECHEN_REGELN):
            return None
        return flaechen

    # --- Pipeline ------------------------------------------------------------

    def kuratiere(
        self,
        stilprofil: dict[str, Any],
        room: dict[str, Any],
        catalog: list[dict[str, Any]],
        budget: float | None,
        seed: int,
    ) -> dict[str, Any]:
        slots = vorfilter(stilprofil, room, catalog, budget)
        by_id = {c["id"]: c for c in catalog}
        n_walls = len(room["shell"]["walls"])
        room_type = room["roomType"]

        # Call A – Auswahl. Scheitert A → alles Baseline (B/C brauchen die Auswahl).
        antwort_a = self._call_json(
            self._prompt_auswahl(stilprofil, room, slots, budget),
            lambda a: _validiere(a, slots, room_type, budget),
            "auswahl",
        )
        if antwort_a is None:
            ergebnis = BaselineKurator().kuratiere(stilprofil, room, catalog, budget, seed)
            ergebnis["begruendung"] += " (Fallback: CURATOR_FALLBACK_USED)"
            return ergebnis
        auswahl: list[str] = antwort_a["auswahl"]
        begruendung = str(antwort_a.get("begruendung", ""))

        # Call B – Anordnung. Scheitert B → Teil-Fallback aus relationalRules.
        antwort_b = self._call_json(
            self._prompt_anordnung(auswahl, by_id, room),
            lambda a: _validiere_anordnung(a, auswahl, n_walls),
            "anordnung",
        )
        if antwort_b is not None:
            anordnung: list[dict[str, Any]] = antwort_b["anordnung"]
        else:
            anordnung = _baseline_anordnung(auswahl, by_id)
            begruendung += " (Teil-Fallback Anordnung: CURATOR_ANORDNUNG_FALLBACK)"

        # Call C – Flächen. Zwei Kontrollen, «davor UND danach»:
        #   1. strukturell (_call_json: Slugs/Bereiche, +1 Repair) – scheitert das
        #      oder der HTTP-Call → Teil-Fallback flaechen=None (Client leitet ab).
        #   2. hart normativ (pruefe_flaechen gegen data/rules/flaechen.json):
        #      bei Verstoß 1 Norm-Repair-Retry → sonst deterministische
        #      korrigiere_flaechen (verwirft NICHT, sondern macht konform).
        antwort_c = self._call_json(
            self._prompt_flaechen(stilprofil, room),
            lambda a: _validiere_flaechen(a, n_walls, MATERIAL_SLUGS),
            "flaechen",
        )
        flaechen: dict[str, Any] | None
        if antwort_c is None:
            flaechen = None
            begruendung += " (Teil-Fallback Flächen: CURATOR_FLAECHEN_FALLBACK)"
        else:
            flaechen = antwort_c["flaechen"]
            verstoesse = pruefe_flaechen(flaechen, room, FLAECHEN_REGELN)
            if verstoesse:
                repariert = self._flaechen_norm_repair(
                    self._prompt_flaechen(stilprofil, room),
                    flaechen,
                    verstoesse,
                    n_walls,
                    room,
                )
                if repariert is not None:
                    flaechen = repariert
                    begruendung += " (Norm-Repair Flächen: CURATOR_FLAECHEN_NORMREPAIR)"
                else:
                    flaechen = korrigiere_flaechen(flaechen, room, FLAECHEN_REGELN)
                    begruendung += " (Norm-Korrektur Flächen: CURATOR_FLAECHEN_NORMKORREKTUR)"

        return {
            "auswahl": auswahl,
            "relationaleAbsichten": _absichten_aus_anordnung(anordnung),
            "anordnung": anordnung,
            "flaechen": flaechen,
            "begruendung": begruendung,
        }


def waehle_port() -> KuratorPort:
    """llm-api, wenn konfiguriert (FP_KURATOR_URL [+MODEL,+API_KEY]); sonst Baseline."""
    url = os.environ.get("FP_KURATOR_URL")
    if url:
        return LlmKurator(
            url=url,
            model=os.environ.get("FP_KURATOR_MODEL", "qwen2.5-32b-instruct"),
            api_key=os.environ.get("FP_KURATOR_API_KEY"),
        )
    return BaselineKurator()
