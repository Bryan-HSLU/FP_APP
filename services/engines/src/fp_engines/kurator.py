"""Kurator-Port: «KI wählt, Solver platziert» (Kurator-Mechanik-Detailkonzept).

Pipeline je Aufruf: Vorfilter (deterministisch) → Prompt → LLM → Validierung
(hart) → Repair-Retry (max. 1) → Fallback Baseline. Doppelte Erdung: das
Modell sieht nur vorgefilterte IDs UND die Antwort wird gegen genau diese
Liste validiert – Halluzination ist konstruktiv ausgeschlossen.

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
from pathlib import Path
from typing import Any, Protocol

import httpx

REPO_ROOT = Path(__file__).resolve().parents[4]
PROMPT_DATEI = REPO_ROOT / "data" / "prompts" / "kurator-rolle.md"
KANDIDATEN_JE_SLOT = 6  # Top 5–8 laut Konzept; kein RAG nötig im POC

log = logging.getLogger("fp.kurator")

P1_PFLICHT: dict[str, list[str]] = {"bad": ["wc", "lavabo", "dusche"]}


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


def _validiere(
    antwort: dict[str, Any],
    slots: dict[str, list[dict[str, Any]]],
    room_type: str,
    budget: float | None,
) -> str | None:
    """Harte Validierung (Konzept §4): None = ok, sonst Fehlerhinweis für Repair."""
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

        def nimm(typ: str) -> None:
            nonlocal rest_budget
            kandidaten = [i for i in slots.get(typ, []) if i["preis"]["value"] <= rest_budget]
            if not kandidaten:
                return
            # Seed-Rauschen erhält Variation, ohne den Score zu dominieren.
            bester = max(
                kandidaten,
                key=lambda i: stil_score(stilprofil, i) + rnd.uniform(0, 0.1),
            )
            auswahl.append(bester["id"])
            rest_budget -= bester["preis"]["value"]
            for rel in bester.get("relationalRules", []):
                absichten.append({"itemId": bester["id"], "relation": rel})

        for typ in P1_PFLICHT.get(room["roomType"], []):
            nimm(typ)
        p1_typen = set(P1_PFLICHT.get(room["roomType"], []))
        for typ in sorted(set(slots) - p1_typen):
            nimm(typ)

        return {
            "auswahl": auswahl,
            "relationaleAbsichten": absichten,
            "begruendung": "Deterministische Baseline: bestes Item je Slot nach "
            "Stil-Score (cos zu den Achsen-Tags) mit Seed-Rauschen.",
        }


class LlmKurator:
    """Gehostetes/lokales LLM über OpenAI-kompatibles Chat-API.

    Strukturierte Ausgabe wird per response_format angefordert; die harte
    Validierung + Repair + Fallback machen Formatfehler trotzdem unschädlich
    (Constrained Decoding im engeren Sinn kommt mit dem Serving-Entscheid).
    """

    name = "llm-api"

    def __init__(self, url: str, model: str, api_key: str | None, timeout_s: float = 30.0):
        self.url = url.rstrip("/")
        self.model = model
        self.api_key = api_key
        self.timeout_s = timeout_s

    def _prompt(
        self,
        stilprofil: dict[str, Any],
        room: dict[str, Any],
        slots: dict[str, list[dict[str, Any]]],
        budget: float | None,
    ) -> list[dict[str, str]]:
        rolle = PROMPT_DATEI.read_text(encoding="utf-8")
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

    def kuratiere(
        self,
        stilprofil: dict[str, Any],
        room: dict[str, Any],
        catalog: list[dict[str, Any]],
        budget: float | None,
        seed: int,
    ) -> dict[str, Any]:
        slots = vorfilter(stilprofil, room, catalog, budget)
        messages = self._prompt(stilprofil, room, slots, budget)
        try:
            antwort = self._rufe_llm(messages)
            fehler = _validiere(antwort, slots, room["roomType"], budget)
            if fehler is not None:
                # Repair-Retry (max. 1) mit konkretem Fehlerhinweis (Konzept §5).
                messages.append({"role": "assistant", "content": json.dumps(antwort)})
                messages.append(
                    {
                        "role": "user",
                        "content": f"Deine Antwort ist ungültig: {fehler} "
                        "Korrigiere und antworte erneut nur mit JSON.",
                    }
                )
                antwort = self._rufe_llm(messages)
                fehler = _validiere(antwort, slots, room["roomType"], budget)
            if fehler is None:
                return antwort
            log.warning("kurator: llm nach repair weiterhin ungültig (%s) → baseline", fehler)
        except (httpx.HTTPError, json.JSONDecodeError, KeyError) as e:
            log.warning("kurator: llm-aufruf fehlgeschlagen (%s) → baseline", e)
        # Fallback (Konzept §6): der Nutzer bekommt IMMER ein Ergebnis.
        ergebnis = BaselineKurator().kuratiere(stilprofil, room, catalog, budget, seed)
        ergebnis["begruendung"] += " (Fallback: CURATOR_FALLBACK_USED)"
        return ergebnis


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
