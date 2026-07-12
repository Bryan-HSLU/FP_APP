"""Kurator-Port: «KI wählt, Solver platziert» (Kurator-Mechanik-Detailkonzept).

Pipeline v2 – **drei entkoppelte LLM-Calls**, jeder mit eigener Validierung,
Repair-Retry (max. 1) und Fallback:

- **Call A – Auswahl:** WAS kommt in den Raum (wie bisher). Scheitert A auch
  nach Repair → **alles Baseline** (B/C brauchen die Auswahl).
- **Call B – Anordnung:** weiche Anordnungs-Anweisungen je Item (wandIndex,
  relationen, prioritaet). Scheitert B → **Teil-Fallback**: `anordnung` aus den
  Katalog-`relationalRules` (ohne wandIndex).
- **Call C – Flächen:** Boden-/Wand-Material-Wünsche (nur geerdete Slugs).
  Scheitert C → **Teil-Fallback**: `flaechen = None` (Client leitet ab).

Doppelte Erdung bleibt: das Modell sieht nur vorgefilterte IDs / erlaubte Slugs
UND jede Antwort wird gegen genau diese Mengen validiert – Halluzination ist
konstruktiv ausgeschlossen. Die Norm-Garantie hängt weiterhin einzig am
Feasibility-Filter des Solvers, nie an dieser weichen Ebene.

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

        # Call C – Flächen. Scheitert C → Teil-Fallback flaechen=None.
        antwort_c = self._call_json(
            self._prompt_flaechen(stilprofil, room),
            lambda a: _validiere_flaechen(a, n_walls, MATERIAL_SLUGS),
            "flaechen",
        )
        if antwort_c is not None:
            flaechen: dict[str, Any] | None = antwort_c["flaechen"]
        else:
            flaechen = None
            begruendung += " (Teil-Fallback Flächen: CURATOR_FLAECHEN_FALLBACK)"

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
