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

Handle-Mapping (Groq-Robustheit, Call A/B): Katalog-IDs sind lange, sich
ähnelnde Wiederholungs-UUIDs (`bbbbbbbb-0004-4000-8000-000000000004`) – LLMs
tippen sie beim Zurückgeben unzuverlässig ab (real beobachtet: ein `b` zu viel
→ `bbbbbbbbb-0004-…`, danach scheitert die Erdung an einer ID, die es nie
gab). Statt der Roh-UUID zeigen die Kandidatenzeilen daher eine kurze,
laufende Kurznummer (`#1`, `#2`, …), aus der Anzeige-Reihenfolge gebaut
(`_erzeuge_handle_karte`/`HandleKarte`, s.u.). Die LLM-Antwort wird VOR jeder
Validierung zurückübersetzt (`_uebersetze_auswahl_antwort`/
`_uebersetze_anordnung_antwort`); ein nicht auflösbares Handle bleibt
unverändert stehen und fällt weiterhin als «ID ausserhalb der Kandidatenliste»
durch – die harte Erdung ist davon unberührt, sie prüft nur eine Repräsentation
später. Call C (Flächen) referenziert nie itemIds und bleibt unangetastet.
Repair-Echos zeigen dem Modell seine vorige Antwort im selben Vokabular
(Handle-Form, nicht zurückübersetzt), damit der Repair konsistent weiterdenkt.

Drei Port-Implementierungen (ADR-0007, austauschbar):
- `baseline`  – deterministisches Scoring mit Seed-Rauschen, immer verfügbar.
- `llm-api`   – gehostetes OpenAI-kompatibles API (POC-Empfehlung; nur
                Sample-Daten → zulässig; echte Raumdaten erst self-hosted/CH).
- (`llm-local` via Ollama nutzt denselben Code: FP_KURATOR_URL auf
  http://localhost:11434/v1 zeigen lassen.)

Konfiguration über Umgebungsvariablen: FP_KURATOR_URL, FP_KURATOR_MODEL,
FP_KURATOR_API_KEY. Ohne URL läuft die Baseline (Eval-Gate: Kurator muss die
Baseline erst schlagen).

Thinking-/Sampling-Steuerung (ADR-0014, best effort hinter Env-Flag – nur wenn
gesetzt, sonst bleiben andere Provider unberührt):
- FP_KURATOR_REASONING: Wert (z.B. "default"/"none"/"low") wird als
  `reasoning_effort` ins Payload gelegt; zusätzlich `reasoning_format="hidden"`,
  damit der Denktext (Qwen3 u.a.) das JSON nicht verschmutzt.
- FP_KURATOR_TEMP: Float-Override der Standard-Temperatur 0.3.

Objekt-Ebenen (ADR-0014, Welle A): Call A antwortet zweistufig – zuerst die
raumprägenden `hauptObjekte`, dann `ergaenzungen` (Item + anzahl, an ein
Haupt-Objekt via `ankerTyp` verankert). Harte Kontrollen (eiserne Regel):
Auswahl ⊆ Kandidaten · P1-Pflicht in hauptObjekte · anzahl 1..maxAnzahl ·
Ergänzung nur bei vorhandenem Anker-Haupt-Objekt · Platz-Budget über ALLE
Instanzen (anzahl×Footprint). WEICH: Instanz-Gesamtzahl im Anzahl-Korridor
(`data/kurator/anzahl-leitplanken.json`) – 1 Repair-Hinweis, dann akzeptiert +
Marker CURATOR_ANZAHL_AUSSERHALB. Alte Kataloge ohne `objektEbene` funktionieren
weiter (eine Gruppe, keine Anker-Pflicht – additive Evolution).
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import random
import time
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol, TypeGuard

import httpx

REPO_ROOT = Path(__file__).resolve().parents[4]
PROMPT_DIR = REPO_ROOT / "data" / "prompts"
PROMPT_AUSWAHL = PROMPT_DIR / "kurator-rolle.md"
PROMPT_ANORDNUNG = PROMPT_DIR / "kurator-anordnung.md"
PROMPT_FLAECHEN = PROMPT_DIR / "kurator-flaechen.md"
SCHEMA_DATEI = REPO_ROOT / "packages" / "shared" / "schemas" / "kurator-vertrag.schema.json"
RULES_DIR = REPO_ROOT / "data" / "rules"
FLAECHEN_REGELN_DATEI = RULES_DIR / "flaechen.json"
ANZAHL_LEITPLANKEN_DATEI = REPO_ROOT / "data" / "kurator" / "anzahl-leitplanken.json"
STILACHSEN_DATEI = REPO_ROOT / "data" / "taxonomy" / "stilachsen.json"
KANDIDATEN_JE_SLOT = 6  # Vorfilter-Tiefe (Ranking-QUELLE) – wovon die Prompt-
# Anzeige unabhängig und schärfer gedeckelt wird (Prompt-Diät v3.2, s.u.).
# --- Prompt-Diät / Grössen-Kontrolle (v3.2, Groq-413-Fix) -------------------
# Die ANGEZEIGTEN Kandidaten je Slot werden gegenüber KANDIDATEN_JE_SLOT
# geschärft; die harte Validierung (Erdung) bleibt auf den vollen Vorfilter-
# Slots und ist davon UNBERÜHRT (eiserne Regel).
KANDIDATEN_HAUPT = 5  # max. angezeigte Kandidaten je Haupt-Slot
KANDIDATEN_ERGAENZUNG = 3  # max. angezeigte Kandidaten je Ergänzungs-Slot
KANDIDATEN_MIN = 2  # Untergrenze je Slot bei adaptiver Kürzung (nie darunter)
KANDIDATEN_DECKEL = 55  # Gesamt-Deckel angezeigter Kandidatenzeilen im Prompt
_ZEICHEN_PRO_TOKEN = 3.5  # grobe DE-Token-Schätzung: ~Zeichen/3.5
# Default für FP_KURATOR_MAX_PROMPT_TOKENS. Hergeleitet aus dem Minutenbudget
# des Groq Free Tier (llama-3.3-70b: 12k TPM) für EINEN Plan = 3 Calls, wobei
# der Rate-Limiter Prompt + reserviertes Antwort-Fenster zählt:
#   A 4200 + 900 · B ~1000 + 700 · C ~900 + 500  ≈ 8200 < 12000 (Reserve für
# Repair-Retries). Höher wäre riskant, niedriger würde die Kandidatenliste
# unnötig kürzen – und je weniger Kandidaten, desto generischer die Auswahl.
_MAX_PROMPT_TOKENS_DEFAULT = 4200
# Antwort-Fenster JE CALL (v3.3, Free-Tier-Budget). Provider-Rate-Limiter (Groq)
# rechnen `max_tokens` als RESERVIERUNG in die Request-Grösse ein – nicht die
# tatsächlich erzeugten Tokens. Ein Plan kostet 3 Calls, also zählt die Summe
# gegen das Minutenbudget (Llama-3.3-70b Free Tier: 12k TPM). Darum je Call nur
# so viel Fenster, wie die Antwort wirklich braucht: A trägt Konzept + Auswahl +
# Farben + Begründung, B/C sind knappe Strukturen.
_ANTWORT_TOKENS_AUSWAHL = 900
_ANTWORT_TOKENS_ANORDNUNG = 700
_ANTWORT_TOKENS_FLAECHEN = 500
# Sampling je Call-Art: Auswahl darf kreativ streuen (sonst liefert «Neue
# Variante» bei jedem Seed fast dasselbe Set), Anordnung/Flächen füllen enge
# Strukturen und bleiben fokussiert.
TEMP_AUSWAHL = 0.6
TEMP_FOKUSSIERT = 0.3
# Footprint-Daumenregel (identisch Baseline & Platz-Budget-Validierung, s.u.):
# belegte Bodenfläche eines boden-montierten Items = Breite × Tiefe × 2.5
# (2.5 = Möbelfläche + Bewegungsfläche). Wand-montierte Items belegen 0.
_FOOTPRINT_FAKTOR = 2.5
# Präfix der Platz-Budget-Fehlermeldung: EINE Quelle für den Repair-Hinweis an
# das LLM UND die Entscheidung, ob deterministisch getrimmt werden darf
# (`_trimme_letzte_auswahl`). Ein zweiter Textvergleich würde stillschweigend
# brechen, sobald jemand die Meldung umformuliert.
PLATZ_FEHLER_PRAEFIX = "Platz-Budget überschritten"

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


# --- Token-Schätzung + adaptives Prompt-Limit (v3.2) ------------------------


def schaetze_tokens(text: str) -> int:
    """Grobe, modell-/tier-agnostische Token-Schätzung für DE-Prompts.

    Faustregel ~Zeichen/3.5 (deutscher Fliess-/Datentext), aufgerundet. Bewusst
    KEIN Tokenizer-Import: die Schätzung dient nur der Grössen-Kontrolle, nicht
    der Abrechnung – sie muss robust und dependency-frei sein.
    """
    return math.ceil(len(text) / _ZEICHEN_PRO_TOKEN)


def _max_prompt_tokens() -> int:
    """Prompt-Token-Limit aus `FP_KURATOR_MAX_PROMPT_TOKENS` (Default 4200).

    Zur Laufzeit gelesen (nicht beim Import), damit Env-Overrides – etwa in Tests
    oder je Deployment/Tier – ohne Reload greifen. Ungültige Werte → Default.
    """
    roh = os.environ.get("FP_KURATOR_MAX_PROMPT_TOKENS")
    if not roh:
        return _MAX_PROMPT_TOKENS_DEFAULT
    try:
        wert = int(roh)
    except ValueError:
        return _MAX_PROMPT_TOKENS_DEFAULT
    return wert if wert > 0 else _MAX_PROMPT_TOKENS_DEFAULT


# --- Kompakt-Notation der Stil-Achsen (Prompt-Diät v3.2) --------------------


def _lade_achsen_pole() -> dict[str, tuple[str, str]]:
    """Achsen-Pol-Wörter (negativ, positiv) je Achsen-ID aus der Taxonomie.

    EINZIGE Quelle für die Kompakt-Notation der Kandidatenzeilen – so bleibt die
    Kurz-Schreibweise deterministisch an `data/taxonomy/stilachsen.json` gekoppelt
    (kein Drift, gleiche Reihenfolge wie im Stilvektor).
    """
    daten = json.loads(STILACHSEN_DATEI.read_text(encoding="utf-8"))
    return {a["id"]: (a["negativPol"], a["positivPol"]) for a in daten["achsen"]}


_ACHSEN_POLE: dict[str, tuple[str, str]] = _lade_achsen_pole()
_ACHSEN_INDEX: dict[str, int] = {aid: i for i, aid in enumerate(_ACHSEN_POLE)}
_STIL_SCHWELLE = 0.2  # Achsen mit |Wert| darunter gelten als Rauschen (weglassen)
_POS_ZEICHEN = "+"
_NEG_ZEICHEN = "−"  # echtes «−» (Minuszeichen) wie in der Legende


def stil_kurz(item: dict[str, Any], max_achsen: int = 3) -> str:
    """Kompakt-Notation der 2–3 betragsstärksten Stil-Achsen eines Items.

    Ersetzt das volle `achsenTags`-JSON in der Kandidatenzeile (Prompt-Diät):
    je Achse «Pol±» (positiver/negativer Pol + Vorzeichen, Betrag ~ Stärke),
    z.B. `warm+ natürlich+ hell+` oder `kühl− schlicht−`. Deterministisch:
    Sortierung nach Betrag absteigend, bei Gleichstand Achsen-Reihenfolge der
    Taxonomie. Achsen unter `_STIL_SCHWELLE` fallen weg; ist gar keine stark
    genug, wird wenigstens die stärkste gezeigt. Legende erklärt die Notation
    einmal im Prompt-Kopf (`_stil_legende`)."""
    tags = item.get("achsenTags") or {}
    if not tags:
        return ""
    geordnet = sorted(tags.items(), key=lambda kv: (-abs(kv[1]), _ACHSEN_INDEX.get(kv[0], 99)))
    stark = [(k, v) for k, v in geordnet if abs(v) >= _STIL_SCHWELLE][:max_achsen]
    if not stark:
        stark = geordnet[:1]
    teile: list[str] = []
    for aid, val in stark:
        pole = _ACHSEN_POLE.get(aid)
        if pole is None:
            continue
        wort = pole[1] if val >= 0 else pole[0]
        teile.append(f"{wort}{_POS_ZEICHEN if val >= 0 else _NEG_ZEICHEN}")
    return " ".join(teile)


def _stil_legende() -> list[str]:
    """Einmalige Legende für die Kompakt-Notation der Kandidatenzeilen (Prompt-
    Kopf). Erklärt Zeilenaufbau, Stil-Kürzel und die Pol-Paare je Achse – die
    Zeilen selbst bleiben dadurch schlank."""
    pole = " · ".join(f"{neg}−/{pos}+" for neg, pos in _ACHSEN_POLE.values())
    return [
        "## Notation der Kandidatenzeilen",
        "Aufbau je Zeile: #N (Kurznummer) · Name · Stil-Kürzel · B×T×H (m) · "
        "CHF-Preis · Platz (m², bereits ausgerechnet) · F:Farb-Slugs.",
        'Referenziere Items IMMER über ihre Kurznummer #N (z.B. "#3"), niemals '
        "über Name, Masse oder andere Bezeichner.",
        "Stil-Kürzel = die 2–3 stärksten Stil-Achsen als «Pol±» (+ positiver, − "
        "negativer Pol; Betrag ~ Stärke). Pol-Paare je Achse: " + pole + ".",
        "Platz = bereits ausgerechnete belegte Bodenfläche inkl. Bewegungsfläche. "
        "Du musst NICHTS multiplizieren – nur die Platz-Werte deiner Auswahl "
        "addieren (bei anzahl>1 entsprechend mehrfach). «Platz 0.0m²» = "
        "wandmontiert, zählt nicht mit.",
        "F: = wählbare Farb-Slugs (nur diese sind für das optionale Feld «farben» erlaubt).",
    ]


def _kandidaten_stufen() -> list[tuple[int, int, int]]:
    """Deterministische Kürzungs-Leiter als (erg_cap, haupt_cap, p1_cap)-Stufen.

    Reduziert in fester Reihenfolge – erst Ergänzungen, dann Haupt-Slots, ZULETZT
    P1-Pflicht-Slots – nie unter `KANDIDATEN_MIN` (eiserne Regel: Pflicht-Slots
    behalten am längsten Auswahl). Grundlage für Gesamt-Deckel UND adaptive
    Token-Kürzung (beide laufen dieselbe Leiter ab)."""
    erg, haupt, p1 = KANDIDATEN_ERGAENZUNG, KANDIDATEN_HAUPT, KANDIDATEN_HAUPT
    stufen: list[tuple[int, int, int]] = [(erg, haupt, p1)]
    while erg > KANDIDATEN_MIN:
        erg -= 1
        stufen.append((erg, haupt, p1))
    while haupt > KANDIDATEN_MIN:
        haupt -= 1
        stufen.append((erg, haupt, p1))
    while p1 > KANDIDATEN_MIN:
        p1 -= 1
        stufen.append((erg, haupt, p1))
    return stufen


def _logge_prompt_groesse(messages: list[dict[str, str]], name: str) -> None:
    """Schätzt die Prompt-Grösse und loggt sie (Call B/C: nur Sichtbarkeit, KEINE
    Kürzung). Über dem Limit → WARN, sonst INFO. Gleiches Limit-Prinzip wie
    Call A, aber ohne Reduktions-Loop (B/C sind heute klein)."""
    tokens = schaetze_tokens("\n".join(m["content"] for m in messages))
    limit = _max_prompt_tokens()
    if tokens > limit:
        log.warning(
            "kurator[%s]: prompt ~%d tokens ÜBER limit %d (keine Kürzung)", name, tokens, limit
        )
    else:
        log.info("kurator[%s]: prompt ~%d tokens (limit %d)", name, tokens, limit)


def _future_ergebnis(future: Future[dict[str, Any] | None], name: str) -> dict[str, Any] | None:
    """Ergebnis eines nebenläufigen Calls einsammeln; None bei jedem Fehler.

    `_call_json` fängt bereits alle erwarteten Fehler (HTTP/JSON) ab. Diese
    Klammer sichert nur den Rest ab: eine unerwartete Exception im einen Thread
    darf den anderen Call nicht mitreissen – der Teil-Fallback (Baseline-
    Anordnung bzw. flaechen=None) ist immer noch ein brauchbarer Plan.
    """
    try:
        return future.result()
    except Exception as e:  # noqa: BLE001 – Teil-Fallback ist besser als kein Plan
        log.warning("kurator[%s]: nebenläufiger call fehlgeschlagen (%s)", name, e)
        return None


def _fehler_ursache(e: Exception) -> str:
    """Kurze, stabile Ursache-Kennung für den Fallback-Marker (best effort).

    HTTP-Statusfehler → «HTTP 413» (Statuscode); andere httpx-Fehler → «HTTP
    <Klasse>» (z.B. ConnectError); sonstige → Exception-Klassenname."""
    if isinstance(e, httpx.HTTPStatusError):
        return f"HTTP {e.response.status_code}"
    if isinstance(e, httpx.HTTPError):
        return f"HTTP {type(e).__name__}"
    return type(e).__name__


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


def _lade_anzahl_leitplanken() -> dict[str, list[dict[str, Any]]]:
    """Anzahl-Leitplanken (`data/kurator/anzahl-leitplanken.json`) – Ziel-Korridor
    der Objekt-Instanzen je Raumtyp und Fläche (ADR-0014, Welle A).

    Eine Quelle für Prompt (`_leitplanke_zeile`) UND weiche Prüfung
    (`anzahl_leitplanke`) – kein Drift. Der `_hinweis`-Schlüssel ist reine
    Dokumentation und wird bei der Auswertung ignoriert.
    """
    daten = json.loads(ANZAHL_LEITPLANKEN_DATEI.read_text(encoding="utf-8"))
    return {k: v for k, v in daten.items() if not k.startswith("_")}


ANZAHL_LEITPLANKEN: dict[str, list[dict[str, Any]]] = _lade_anzahl_leitplanken()


def anzahl_leitplanke(
    room_type: str,
    area: float,
    leitplanken: dict[str, list[dict[str, Any]]] = ANZAHL_LEITPLANKEN,
) -> tuple[int, int] | None:
    """Ziel-Korridor (min, max) der Objekt-Instanzen für Raumtyp+Fläche.

    Erstes Band mit `area <= bisM2`; überschreitet die Fläche alle Bänder, gilt
    das letzte. None, wenn der Raumtyp keine Leitplanken hat.
    """
    baender = leitplanken.get(room_type)
    if not baender:
        return None
    for band in baender:
        if area <= band["bisM2"]:
            return int(band["min"]), int(band["max"])
    letzt = baender[-1]
    return int(letzt["min"]), int(letzt["max"])


def _leitplanke_zeile(room_type: str, area: float) -> list[str]:
    """Anzahl-Korridor als kompakte Prompt-Zeile (Daten sind die einzige Quelle –
    gleiches Muster wie `norm_kontext_flaechen`). Leer, wenn kein Korridor."""
    korr = anzahl_leitplanke(room_type, area)
    if korr is None:
        return []
    lo, hi = korr
    return [
        f"Ziel-Anzahl (weich geprüft): {lo}–{hi} Objekt-Instanzen für {area:.1f} m² "
        "(Haupt-Objekte + Ergänzungen×anzahl, ohne Deko)."
    ]


# Geometrie-/Bewegungsflächen-Regeln (Norm-Regelsatz-v0) – dieselben Daten, die
# der Solver hart prüft. Hier NUR gelesen, um Call B kompakte Norm-Hinweise je
# gewähltem funktionsTyp mitzugeben (Information, keine Prüfung → «sinnvolle
# Wünsche»). `flaechen.json` ist ein anderes Format und bleibt aussen vor.
def _lade_geometrie_regeln() -> list[dict[str, Any]]:
    regeln: list[dict[str, Any]] = []
    for pfad in sorted(RULES_DIR.glob("*.json")):
        if pfad.name == "flaechen.json":
            continue
        regeln.extend(json.loads(pfad.read_text(encoding="utf-8")))
    return regeln


GEOMETRIE_REGELN: list[dict[str, Any]] = _lade_geometrie_regeln()
# Regel-Typen mit einer sinnvollen Abstands-/Bewegungsflächen-Kompaktzeile.
_BEWEGUNGS_TYPEN = frozenset({"clearance", "object-distance", "wall-distance"})


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


# --- Platz-Budget (harte Kontrolle, gleiche Daumenregel wie die Baseline) ----


def _footprint(item: dict[str, Any]) -> float:
    """Belegte Bodenfläche eines Items (m²) nach der Footprint-Daumenregel.

    Wand-montierte Items belegen keinen Boden (0.0); alle anderen
    Breite × Tiefe × `_FOOTPRINT_FAKTOR` – identisch zu `BaselineKurator.nimm`.
    """
    if item.get("mount") == "wand":
        return 0.0
    m = item["masse"]
    return float(m["w"]) * float(m["d"]) * _FOOTPRINT_FAKTOR


def platz_anzeige(item: dict[str, Any]) -> float:
    """Platzwert eines Items für die Kandidatenzeile (m², auf 0.1 aufgerundet).

    Quelle ist `_footprint` – also EXAKT die Formel, gegen die `_validiere_ebenen`
    prüft (kein zweiter Rechenweg, sonst driften Prompt und Kontrolle
    auseinander). Warum überhaupt vorrechnen: Sprachmodelle können Breite×Tiefe×
    2.5 nicht über zehn Zeilen zuverlässig im Kopf multiplizieren – ein echter
    Diagnoselauf wählte für 16.2 m² Möbel mit 19.0 m² Bedarf. Addieren können sie.
    Aufgerundet, damit die im Prompt gebildete Summe NIE kleiner ist als die
    geprüfte (konservativ zugunsten der harten Kontrolle).
    """
    return math.ceil(_footprint(item) * 10.0) / 10.0


def _min_pflicht_footprint(slots: dict[str, list[dict[str, Any]]], room_type: str) -> float:
    """Kleinstmögliche Footprint-Summe einer P1-Pflicht-vollständigen Auswahl.

    Je vorhandenem Pflicht-Slot das footprint-kleinste Kandidaten-Item. Basis des
    Unsatisfiability-Guards: läge das echte Bodenbudget darunter, wäre die
    Validierung unerfüllbar – deshalb hebt `_platz_budget` mindestens hierauf an.
    """
    total = 0.0
    for typ in P1_PFLICHT.get(room_type, []):
        kandidaten = slots.get(typ) or []
        if kandidaten:
            total += min(_footprint(i) for i in kandidaten)
    return total


def _platz_budget(
    room: dict[str, Any], slots: dict[str, list[dict[str, Any]]], room_type: str
) -> float:
    """Effektives Platz-Budget (m²) = max(Bodenfläche, minimale Pflicht-Footprint).

    Bodenfläche ist die ehrliche Zielgrösse; der Guard verhindert nur, dass ein
    sehr kleiner Raum die P1-Pflicht (WC/Lavabo/Dusche) unerfüllbar macht.
    """
    area = room["shell"]["floor"].get("area") or 0.0
    return max(float(area), _min_pflicht_footprint(slots, room_type))


# --- Bewegungsflächen-Hinweise für Call B (Information aus den Norm-Daten) ----


def bewegungs_hinweise(
    room: dict[str, Any],
    gewaehlte_typen: set[str],
    regeln: list[dict[str, Any]] = GEOMETRIE_REGELN,
) -> list[str]:
    """Je gewähltem funktionsTyp max. eine kompakte Abstands-/Bewegungsflächen-Zeile.

    Quelle = Geometrie-Regelsatz (`data/rules/<roomType>.json`, `hinweis`-Feld).
    Nur raumtyp-spezifische Regeln der `_BEWEGUNGS_TYPEN`; pro funktionsTyp wird
    die Bewegungsfläche (`clearance`) bevorzugt. Reine Information für den Prompt –
    der Solver prüft hart. Leere Liste, wenn es keine passenden Regeln gibt.
    """
    rt = room["roomType"]
    beste: dict[str, dict[str, Any]] = {}
    for r in regeln:
        if r.get("roomType") != rt or r.get("type") not in _BEWEGUNGS_TYPEN:
            continue
        typ = r.get("appliesTo")
        if typ not in gewaehlte_typen or not r.get("hinweis"):
            continue
        vorher = beste.get(typ)
        if vorher is None or (r["type"] == "clearance" and vorher["type"] != "clearance"):
            beste[typ] = r
    return [f"{typ}: {beste[typ]['hinweis']}" for typ in sorted(beste)]


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
    platz_budget: float | None = None,
) -> str | None:
    """Call A: harte Validierung (Konzept §4). None = ok, sonst Fehlerhinweis.

    `platz_budget` (m², effektives Bodenbudget aus `_platz_budget`): ist es
    gesetzt, wird die belegte Bodenfläche der gewählten boden-montierten Items
    (Footprint-Daumenregel) hart geprüft – gleiche Regel wie die Baseline.
    """
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
    if platz_budget is not None:
        belegt = sum(_footprint(erlaubte[i]) for i in antwort["auswahl"])
        if belegt > platz_budget:
            return (
                f"{PLATZ_FEHLER_PRAEFIX}: belegte Bodenfläche {belegt:.1f} m² "
                f"> {platz_budget:.1f} m² (Summe Breite×Tiefe×2.5 der boden-montierten "
                "Items). Wähle weniger/kleinere boden-montierte Objekte."
            )
    for rel in antwort.get("relationaleAbsichten", []):
        if rel.get("itemId") not in erlaubte:
            return f"relationaleAbsichten verweist auf unbekannte ID: {rel.get('itemId')}."
    return None


# --- Objekt-Ebenen (Haupt/Ergänzung, ADR-0014, Welle A) ---------------------


def _item_ebene(item: dict[str, Any]) -> str:
    """objektEbene eines Items; fehlt es → «haupt» (Alt-Katalog: eigenständig,
    keine Anker-Pflicht). So brechen alte Kataloge ohne das Feld nicht."""
    return str(item.get("objektEbene") or "haupt")


def _extrahiere_ebenen(antwort: dict[str, Any]) -> tuple[list[str], list[dict[str, Any]]]:
    """Normalisiert eine Call-A-Antwort auf (hauptObjekte, ergaenzungen).

    Neue Form: `hauptObjekte`/`ergaenzungen` (Objekt-Ebenen-Modell). Alt-Form
    (nur `auswahl`, additive Evolution): alles Haupt, keine Ergänzungen. So bleibt
    der bestehende Auswahl-Weg (und alte Fixtures/Tests) gültig.
    """
    haupt = antwort.get("hauptObjekte")
    erg = antwort.get("ergaenzungen")
    if haupt is None and erg is None:
        return list(antwort.get("auswahl") or []), []
    erg_norm: list[dict[str, Any]] = []
    for e in erg or []:
        if isinstance(e, dict) and "itemId" in e:
            erg_norm.append({"itemId": e["itemId"], "anzahl": e.get("anzahl", 1)})
    return list(haupt or []), erg_norm


def _auswahl_aus_ebenen(haupt: list[str], erg: list[dict[str, Any]]) -> list[str]:
    """Expandierte `auswahl` (jede itemId genau einmal) = Haupt + Ergänzungs-IDs.
    Reihenfolge erhält Haupt-zuerst (Solver-Wissen: Anschluss/Kern zuerst)."""
    return [*haupt, *[e["itemId"] for e in erg]]


def mengen_aus_antwort(antwort: dict[str, Any]) -> dict[str, int]:
    """itemId→anzahl aus den `ergaenzungen` (Haupt implizit 1 → nicht enthalten).

    Der kleinste saubere Weg für den Aufrufer (API): `mengen` steht NICHT im
    schema-validierten Kurator-Vertrag (rein internes Solver-Steuersignal),
    sondern wird deterministisch aus den `ergaenzungen` abgeleitet. `solve()` liest
    fehlende IDs als anzahl 1 (`.get(id, 1)`), Haupt-Objekte brauchen keinen Eintrag.
    """
    out: dict[str, int] = {}
    for e in antwort.get("ergaenzungen") or []:
        if isinstance(e, dict) and "itemId" in e:
            n = e.get("anzahl", 1)
            if _ist_int(n) and n > 1:
                out[e["itemId"]] = n
    return out


def _validiere_ebenen(
    antwort: dict[str, Any],
    slots: dict[str, list[dict[str, Any]]],
    room_type: str,
    budget: float | None,
    platz_budget: float | None,
    by_id: dict[str, dict[str, Any]],
) -> str | None:
    """Call A (Objekt-Ebenen) hart validieren. None = ok, sonst Repair-Hinweis.

    Prüft (eiserne Regel aus ADR-0013/0014): (1) alle IDs ⊆ Kandidaten; (2) jedes
    P1-Pflicht-funktionsTyp in hauptObjekte; (3) je Ergänzung anzahl 1..maxAnzahl;
    (4) Ergänzung mit ankerTyp nur, wenn ein Haupt-Objekt dieses funktionsTyps
    gewählt ist; (5) Budget und (6) Platz-Budget über ALLE Instanzen
    (anzahl×Footprint, wandmontiert = 0). Der Anzahl-Korridor bleibt WEICH (nicht
    hier). Alt-Form (nur `auswahl`) wird über `_extrahiere_ebenen` als reines
    Haupt-Set behandelt.
    """
    haupt, erg = _extrahiere_ebenen(antwort)
    if not haupt and not erg:
        return "Feld «hauptObjekte»/«auswahl» fehlt oder ist leer."
    erlaubte = {i["id"]: i for items in slots.values() for i in items}
    alle = _auswahl_aus_ebenen(haupt, erg)
    fremde = [i for i in alle if i not in erlaubte]
    if fremde:
        return f"IDs ausserhalb der Kandidatenliste: {fremde}. Nur gelistete IDs wählen."
    haupt_typen = {erlaubte[i]["funktionsTyp"] for i in haupt}
    fehlend = [t for t in P1_PFLICHT.get(room_type, []) if t in slots and t not in haupt_typen]
    if fehlend:
        return f"P1-Pflicht-Slots nicht in hauptObjekte: {fehlend}."
    for e in erg:
        item = erlaubte[e["itemId"]]
        maxn = int(item.get("maxAnzahl", 1) or 1)
        n = e.get("anzahl", 1)
        if not _ist_int(n) or n < 1 or n > maxn:
            return (
                f"anzahl {n} für «{item['funktionsTyp']}» ({e['itemId']}) ausserhalb "
                f"1..{maxn} (maxAnzahl). Wähle eine Anzahl in diesem Bereich."
            )
        anker = item.get("ankerTyp")
        if anker and anker not in haupt_typen:
            return (
                f"Ergänzung «{item['funktionsTyp']}» ({e['itemId']}) braucht ein "
                f"Haupt-Objekt vom Typ «{anker}», das nicht in hauptObjekte steht – "
                f"wähle ein {anker} als Haupt-Objekt oder entferne die Ergänzung."
            )
    if budget is not None:
        summe = sum(erlaubte[i]["preis"]["value"] for i in haupt)
        summe += sum(erlaubte[e["itemId"]]["preis"]["value"] * e.get("anzahl", 1) for e in erg)
        if summe > budget:
            return f"Budget überschritten: {summe} > {budget}."
    if platz_budget is not None:
        belegt = sum(_footprint(erlaubte[i]) for i in haupt)
        belegt += sum(_footprint(erlaubte[e["itemId"]]) * e.get("anzahl", 1) for e in erg)
        if belegt > platz_budget:
            return (
                f"{PLATZ_FEHLER_PRAEFIX}: belegte Bodenfläche {belegt:.1f} m² "
                f"> {platz_budget:.1f} m² (Summe anzahl×Breite×Tiefe×2.5 der boden-"
                "montierten Items). Wähle weniger/kleinere Objekte oder reduziere die Anzahl."
            )
    return None


def _erg_schwaeche(
    eintrag: dict[str, Any], erlaubte: dict[str, dict[str, Any]], stilprofil: dict[str, Any]
) -> tuple[int, float, float, str]:
    """Sortierschlüssel «wie entbehrlich ist diese Ergänzung» (grösser = eher weg).

    Reihenfolge der Kriterien: (1) priorityClass – Deko (P3) fällt vor Funktion
    (P2); (2) kleinster Stil-Score – was am wenigsten zum Geschmack passt, geht
    zuerst; (3) grösster Platzverbrauch – eine Streichung soll möglichst viel
    bringen; (4) itemId als Tiebreak, damit die Ordnung total und damit
    deterministisch ist (gleicher Input ⇒ gleicher Plan bleibt Gesetz).
    """
    item = erlaubte[eintrag["itemId"]]
    prio = _PRIO_KLASSE.get(str(item.get("priorityClass", "P3")), 3)
    # Grösser = entbehrlicher: hohe priorityClass-Zahl (P3=Deko) zuerst, dann
    # geringer Stil-Score (darum negiert), dann grosser Platzgewinn.
    return (prio, -stil_score(stilprofil, item), _footprint(item), str(eintrag["itemId"]))


def trimme_platz_budget(
    haupt: list[str],
    erg: list[dict[str, Any]],
    erlaubte: dict[str, dict[str, Any]],
    platz_budget: float,
    stilprofil: dict[str, Any],
) -> tuple[list[dict[str, Any]], int] | None:
    """Ergänzungen deterministisch kürzen, bis das Platz-Budget hält.

    Bryans Vorgabe: die KI-Auswahl ist ein wichtiger Bestandteil und soll NICHT
    verworfen werden, nur weil sie den Raum überlädt. Statt des vollen
    Baseline-Fallbacks fallen darum gezielt die schwächsten Ergänzungen weg
    (Ordnung s. `_erg_schwaeche`): erst wird die `anzahl` reduziert, dann das
    Item ganz entfernt – so überlebt ein Esstisch mit 2 statt 4 Stühlen, statt
    dass die ganze Idee stirbt.

    Haupt-Objekte bleiben unangetastet: sie tragen die P1-Pflicht und die
    Anker-Bedingungen der Ergänzungen; sie zu streichen würde die harten
    Kontrollen verletzen, statt sie zu erfüllen.

    Rückgabe: (neue Ergänzungsliste, Anzahl entfernter Instanzen) oder None,
    wenn selbst ohne jede Ergänzung nicht genug Platz da ist (dann bleibt der
    Baseline-Fallback die ehrliche Antwort).
    """
    haupt_belegt = sum(_footprint(erlaubte[i]) for i in haupt)
    if haupt_belegt > platz_budget:
        return None
    rest = [dict(e) for e in erg]
    entfernt = 0

    def _belegt() -> float:
        return haupt_belegt + sum(
            _footprint(erlaubte[e["itemId"]]) * int(e.get("anzahl", 1)) for e in rest
        )

    while _belegt() > platz_budget:
        # Nur boden-montierte Ergänzungen bringen Platz; wandmontierte (Spiegel,
        # Hängeschrank) zu streichen würde die Auswahl ärmer machen, ohne die
        # Bilanz zu verbessern.
        kandidaten = [e for e in rest if _footprint(erlaubte[e["itemId"]]) > 0.0]
        if not kandidaten:
            return None
        opfer = max(kandidaten, key=lambda e: _erg_schwaeche(e, erlaubte, stilprofil))
        if int(opfer.get("anzahl", 1)) > 1:
            opfer["anzahl"] = int(opfer["anzahl"]) - 1
        else:
            rest.remove(opfer)
        entfernt += 1
    return rest, entfernt


def _instanz_anzahl(haupt: list[str], erg: list[dict[str, Any]]) -> int:
    """Gesamtzahl platzierter Objekt-Instanzen (Haupt×1 + Ergänzungen×anzahl)."""
    return len(haupt) + sum(int(e.get("anzahl", 1)) for e in erg)


def _farb_varianten(item: dict[str, Any] | None) -> list[str]:
    """Farbvarianten eines Katalog-Items (leer, wenn keine gepflegt sind)."""
    return list((item or {}).get("farbVarianten") or [])


def _validiere_farben(
    farben: Any, auswahl: list[str], by_id: dict[str, dict[str, Any]]
) -> str | None:
    """Call-A-Farbwahl prüfen (Kurator-Pipeline v3, Welle 3). None = ok.

    Eigener Validierungsschritt NACH `_validiere` (Auswahl), damit der bestehende
    A-Fallback unberührt bleibt. Farben ist optional; ist es vorhanden, gilt die
    Erdung analog zu den Material-Slugs: es muss ein Objekt itemId→Slug sein, die
    Keys eine Teilmenge der Auswahl, und jeder Slug in den `farbVarianten` des
    jeweiligen Items liegen. Sonst konkreter Repair-Hinweis.
    """
    if farben is None:
        return None
    if not isinstance(farben, dict):
        return "Feld «farben» muss ein Objekt itemId→Farb-Slug sein."
    erlaubt = set(auswahl)
    for iid, slug in farben.items():
        if iid not in erlaubt:
            return (
                f"farben verweist auf Item ausserhalb der Auswahl: {iid}. "
                "Nur gewählte itemIds färben."
            )
        varianten = _farb_varianten(by_id.get(iid))
        if slug not in varianten:
            return (
                f"Farbe «{slug}» für Item {iid} nicht in dessen farbVarianten "
                f"({varianten}). Nur diese Slugs sind erlaubt."
            )
    return None


def _bereinige_farben(
    farben: Any, auswahl: list[str], by_id: dict[str, dict[str, Any]]
) -> dict[str, str]:
    """Behält nur die gültigen Farb-Einträge (Key ∈ Auswahl UND Slug ∈ farbVarianten).

    Teil-Fallback-Muster: scheitert die Farbwahl auch nach dem Repair, wird nicht
    die ganze (gültige) Auswahl verworfen – nur die ungültigen Farb-Einträge
    fallen weg, der Rest bleibt (Client nutzt für den Rest die Default-Optik).
    """
    if not isinstance(farben, dict):
        return {}
    erlaubt = set(auswahl)
    return {
        iid: slug
        for iid, slug in farben.items()
        if iid in erlaubt and slug in _farb_varianten(by_id.get(iid))
    }


def _ist_int(v: Any) -> TypeGuard[int]:
    """Echte Ganzzahl (bool ist in Python eine int-Unterklasse → ausschliessen)."""
    return isinstance(v, int) and not isinstance(v, bool)


def _relation_ziel_fehler(rel: str, auswahl: set[str], gewaehlte_typen: set[str]) -> str | None:
    """Relations-Ziel-Prüfung für BEKANNTE Formen (Konzept v3).

    `near:`/`facing:`/`opposite:<typ>` → `<typ>` muss funktionsTyp eines gewählten
    Items sein; `pair-with:<id>` → `<id>` muss in der Auswahl liegen. `against-wall`,
    `corner`, `group:*` bleiben frei; UNBEKANNTE Präfixe werden toleriert (der
    Parser ignoriert sie ohnehin). None = ok, sonst konkreter Repair-Hinweis.
    """
    kopf, _, rest = rel.partition(":")
    if kopf in ("near", "facing", "opposite"):
        ziel = rest.split(":", 1)[0]
        if ziel and ziel not in gewaehlte_typen:
            return (
                f"Relation {rel} zielt auf nicht gewählten funktionsTyp «{ziel}» "
                "– wähle diesen Typ oder entferne die Relation."
            )
    elif kopf == "pair-with":
        if rest and rest not in auswahl:
            return f"Relation {rel} verweist auf nicht gewählte itemId «{rest}»."
    return None


def _validiere_anordnung(
    antwort: dict[str, Any],
    auswahl: list[str],
    n_walls: int,
    gewaehlte_typen: set[str] | None = None,
) -> str | None:
    """Call B: `anordnung` prüfen. itemIds ⊆ Auswahl, wandIndex im Bereich,
    relationen = Liste von Strings, prioritaet ganzzahlig. Ist `gewaehlte_typen`
    gesetzt, werden zusätzlich die Ziele BEKANNTER Relationen geprüft
    (`_relation_ziel_fehler`) – unbekannte Formen bleiben toleriert. None = ok."""
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
        if gewaehlte_typen is not None and isinstance(rel, list):
            for r in rel:
                fehler = _relation_ziel_fehler(r, erlaubt, gewaehlte_typen)
                if fehler is not None:
                    return fehler
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


def norm_kontext_flaechen(
    room: dict[str, Any], regeln: list[dict[str, Any]] = FLAECHEN_REGELN
) -> list[str]:
    """Rendert die Flächen-Normregeln des Raumtyps PRO RAUM instanziiert (Call C).

    Eine Quelle (`data/rules/flaechen.json`) für Prompt UND `pruefe_flaechen` –
    kein Drift. `boden` → erlaubte Slugs; `wand-nass` → konkrete Nasswand-Indizes
    des Raums (via `nasswaende`) + Mindest-Deckhöhe; `wand-alle` → erlaubte Slugs
    für explizit belegte Wände. Leere Liste, wenn der Raumtyp keine Regeln hat.
    """
    aktiv = [r for r in regeln if r["roomType"] == room["roomType"]]
    if not aktiv:
        return []
    nass = sorted(nasswaende(room))
    zeilen: list[str] = []
    for regel in aktiv:
        gilt, anf = regel["gilt"], regel["anforderung"]
        slugs = sorted(regel["erlaubteMaterialien"])
        if gilt == "boden":
            zeilen.append(f"Boden ({anf}): NUR {slugs}")
        elif gilt == "wand-nass":
            if not nass:
                continue
            minh = regel.get("minHoeheM", 0.0)
            benennung = ", ".join(f"Wand {i}" for i in nass)
            sind = "sind Nasswände" if len(nass) > 1 else "ist Nasswand"
            zeilen.append(
                f"{benennung} {sind} ({anf}): Material aus {slugs}, deckend bis "
                f'≥ {minh} m (bereich "voll" oder hoeheM ≥ {minh}) — jede Nasswand belegen'
            )
        elif gilt == "wand-alle":
            zeilen.append(
                f"Explizit belegte Wände: nur {slugs}; Wände, die schlicht verputzt "
                "bleiben sollen, weglassen"
            )
    return zeilen


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


def _profil_zeilen(stilprofil: dict[str, Any]) -> list[str]:
    """Stilprofil kompakt (styleVector, Anforderungen, Palette) – identische
    Darstellung in allen drei Calls, damit A/B/C denselben Stil interpretieren."""
    return [
        f"Stilvektor: {json.dumps(stilprofil.get('styleVector', {}), ensure_ascii=False)}",
        f"Anforderungen: {stilprofil.get('derivedRequirements', [])}",
        f"Palette: {stilprofil.get('palette', [])}",
    ]


def _konzept_block(konzept: str | None) -> list[str]:
    """Design-Konzept-Block (roter Faden aus Call A) – leer, wenn kein Konzept
    vorliegt (weiche Freiheit; fehlendes Konzept ist kein Fehler)."""
    if not konzept or not str(konzept).strip():
        return []
    return ["## Design-Konzept (roter Faden)", str(konzept).strip(), ""]


@dataclass(frozen=True)
class HandleKarte:
    """Kurznummer(`#N`)-↔itemId-Zuordnung für EINEN LLM-Call (Handle-Mapping).

    Deterministisch aus der Anzeige-Reihenfolge der jeweiligen Kandidaten-/
    Auswahl-Liste gebaut (`_erzeuge_handle_karte`) – derselbe Aufbau mit
    denselben Eingaben liefert immer dieselben Handles. Dadurch genügt es,
    Prompt-Bau-Funktionen (`_prompt_auswahl`/`_prompt_anordnung`) erneut mit
    identischen Argumenten aufzurufen, um dieselbe Karte für einen Repair-Schritt
    zu erhalten – kein zusätzlicher State-Transport nötig.
    """

    handle_zu_id: dict[str, str]
    id_zu_handle: dict[str, str]

    def id_fuer(self, wert: str) -> str:
        """Löst ein Handle-Token (`#3`, `3`, ggf. mit Whitespace) zur echten
        itemId auf. Kein exakter Handle-Treffer (unbekanntes `#999`, Freitext,
        oder eine – vertippte – Roh-UUID) → Wert **unverändert** zurück, damit
        die harte Validierung ihn als «ID ausserhalb der Kandidatenliste»
        erkennt (Erdung bleibt vollständig intakt – dieses Mapping macht sie
        NICHT weicher). Aufrufer mit gemischt typisiertem JSON (Listen-/Dict-
        Werten) prüfen `isinstance(x, str)` VOR dem Aufruf."""
        return self.handle_zu_id.get(_normalisiere_handle(wert), wert)

    def handle_fuer(self, item_id: str) -> str:
        """Echte itemId → ihr Handle (Umkehrung), z.B. um ein Repair-Echo im
        selben Vokabular zu zeigen wie die vorige LLM-Antwort. Fehlt die itemId
        (kein angezeigtes Kandidaten-Item) → itemId unverändert (Fallback, bei
        bereits hart validierten IDs praktisch nie der Fall)."""
        return self.id_zu_handle.get(item_id, item_id)


def _normalisiere_handle(text: str) -> str:
    """`#12`, `12`, ggf. mit Whitespace → `#12`. Reine Normalform für den
    Dict-Lookup in `HandleKarte.id_fuer`; erzeugt selbst KEINEN Treffer."""
    kern = text.strip()
    return kern if kern.startswith("#") else f"#{kern}"


def _erzeuge_handle_karte(ids: list[str]) -> HandleKarte:
    """Baut kollisionsfreie, deterministische Kurznummern (`#1`, `#2`, …) aus
    der Reihenfolge einer Kandidaten-/Auswahl-Liste (Anzeige-Reihenfolge im
    jeweiligen Prompt). Doppelte IDs (Katalog-IDs sind eindeutig, sollte also
    nicht vorkommen) behalten ihr zuerst vergebenes Handle."""
    handle_zu_id: dict[str, str] = {}
    id_zu_handle: dict[str, str] = {}
    n = 0
    for iid in ids:
        if iid in id_zu_handle:
            continue
        n += 1
        handle = f"#{n}"
        handle_zu_id[handle] = iid
        id_zu_handle[iid] = handle
    return HandleKarte(handle_zu_id=handle_zu_id, id_zu_handle=id_zu_handle)


def _uebersetze_auswahl_antwort(antwort: dict[str, Any], karte: HandleKarte) -> dict[str, Any]:
    """Call A: übersetzt Handles in `auswahl`/`hauptObjekte`/`ergaenzungen[].
    itemId`/`farben`-Keys zu echten itemIds zurück – VOR jeder Validierung
    (Handle-Mapping, s. Moduldoc). Unbekannte Tokens bleiben unverändert (die
    Validierung fängt sie danach als Erdungsfehler). Reine, seiteneffektfreie
    Funktion – arbeitet auf einer flachen Kopie, das Original bleibt unberührt.
    """
    if not isinstance(antwort, dict):
        return antwort
    out = dict(antwort)
    for feld in ("auswahl", "hauptObjekte"):
        if isinstance(out.get(feld), list):
            out[feld] = [karte.id_fuer(x) if isinstance(x, str) else x for x in out[feld]]
    if isinstance(out.get("ergaenzungen"), list):
        neu: list[Any] = []
        for e in out["ergaenzungen"]:
            if isinstance(e, dict) and isinstance(e.get("itemId"), str):
                e = {**e, "itemId": karte.id_fuer(e["itemId"])}
            neu.append(e)
        out["ergaenzungen"] = neu
    if isinstance(out.get("farben"), dict):
        out["farben"] = {karte.id_fuer(k): v for k, v in out["farben"].items()}
    return out


def _uebersetze_relation(rel: str, karte: HandleKarte) -> str:
    """Löst NUR das Handle in `pair-with:<Handle>` zur echten itemId auf.
    `near:`/`facing:`/`opposite:<funktionsTyp>` referenzieren einen funktionsTyp
    (keine itemId) und bleiben unangetastet; unbekannte Präfixe bleiben
    ebenfalls unverändert (Parser toleriert sie ohnehin)."""
    praefix = "pair-with:"
    if not rel.startswith(praefix):
        return rel
    return praefix + karte.id_fuer(rel[len(praefix) :])


def _uebersetze_anordnung_antwort(antwort: dict[str, Any], karte: HandleKarte) -> dict[str, Any]:
    """Call B: übersetzt `anordnung[].itemId` UND das Handle in
    `pair-with:<Handle>`-Relationsstrings zurück zu echten itemIds – VOR jeder
    Validierung (Handle-Mapping, s. Moduldoc)."""
    if not isinstance(antwort, dict) or not isinstance(antwort.get("anordnung"), list):
        return antwort
    neu: list[Any] = []
    for e in antwort["anordnung"]:
        if not isinstance(e, dict):
            neu.append(e)
            continue
        e2 = dict(e)
        if isinstance(e2.get("itemId"), str):
            e2["itemId"] = karte.id_fuer(e2["itemId"])
        rel = e2.get("relationen")
        if isinstance(rel, list):
            e2["relationen"] = [
                _uebersetze_relation(r, karte) if isinstance(r, str) else r for r in rel
            ]
        neu.append(e2)
    return {**antwort, "anordnung": neu}


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
        room_type = room["roomType"]
        slots = vorfilter(stilprofil, room, catalog, budget)
        by_id = {c["id"]: c for c in catalog}
        area = room["shell"]["floor"].get("area") or 0.0
        korridor = anzahl_leitplanke(room_type, area)
        rest_budget = budget if budget is not None else math.inf
        # Flächen-Daumenregel: Footprint × 2.5 (inkl. Bewegungsfläche) muss in
        # die Rest-Bodenfläche passen – kleines Gäste-WC wählt ehrlich die
        # Teilmenge (Norm-Regelsatz-v0) statt den Solver scheitern zu lassen.
        rest_flaeche = area

        haupt_objekte: list[str] = []
        ergaenzungen: list[dict[str, Any]] = []
        absichten: list[dict[str, Any]] = []
        haupt_typen: set[str] = set()

        def _fp(item: dict[str, Any]) -> float:
            return (
                0.0
                if item.get("mount") == "wand"
                else item["masse"]["w"] * item["masse"]["d"] * 2.5
            )

        def _instanzen() -> int:
            return len(haupt_objekte) + sum(int(e["anzahl"]) for e in ergaenzungen)

        def _bester(typ: str) -> dict[str, Any] | None:
            kandidaten = [
                i
                for i in slots.get(typ, [])
                if i["preis"]["value"] <= rest_budget
                and (i.get("mount") == "wand" or _fp(i) <= rest_flaeche)
            ]
            if not kandidaten:
                return None
            # Seed-Rauschen erhält Variation, ohne den Score zu dominieren.
            return max(kandidaten, key=lambda i: stil_score(stilprofil, i) + rnd.uniform(0, 0.1))

        def nimm_haupt(typ: str) -> None:
            nonlocal rest_budget, rest_flaeche
            bester = _bester(typ)
            if bester is None:
                return
            haupt_objekte.append(bester["id"])
            haupt_typen.add(bester["funktionsTyp"])
            rest_budget -= bester["preis"]["value"]
            rest_flaeche -= _fp(bester)
            for rel in bester.get("relationalRules", []):
                absichten.append({"itemId": bester["id"], "relation": rel})

        def nimm_ergaenzung(typ: str) -> None:
            nonlocal rest_budget, rest_flaeche
            items = slots.get(typ, [])
            if not items:
                return
            # Anker-Kontrolle (funktionsTyp teilt ankerTyp): Ergänzung nur bei
            # vorhandenem Haupt-Objekt des Anker-Typs.
            anker = items[0].get("ankerTyp")
            if anker and anker not in haupt_typen:
                return
            bester = _bester(typ)
            if bester is None:
                return
            maxn = int(bester.get("maxAnzahl", 1) or 1)
            fp = _fp(bester)
            # Anzahl deterministisch: Stühle am Esstisch bis zu 4 (Konzept), sonst 1.
            anzahl = min(4, maxn) if anker == "esstisch" else 1
            # Korridor (weich): die Ergänzung überzieht die Obergrenze nicht.
            if korridor is not None:
                anzahl = min(anzahl, max(0, korridor[1] - _instanzen()))
            # Budget + Platz respektieren (n×Preis bzw. n×Footprint).
            while anzahl >= 1 and bester["preis"]["value"] * anzahl > rest_budget:
                anzahl -= 1
            while anzahl >= 1 and fp > 0 and fp * anzahl > rest_flaeche:
                anzahl -= 1
            if anzahl < 1:
                return
            ergaenzungen.append({"itemId": bester["id"], "anzahl": anzahl})
            rest_budget -= bester["preis"]["value"] * anzahl
            rest_flaeche -= fp * anzahl
            for rel in bester.get("relationalRules", []):
                absichten.append({"itemId": bester["id"], "relation": rel})

        # Ordnung innerhalb einer Phase: priorityClass (P1 Kern → P2 → P3), dann
        # alphabetisch (deterministisch). Ohne diese Ordnung würden alphabetisch
        # frühe P3-Ergänzungen die knappe Flächen-Daumenregel aufbrauchen, bevor
        # spätere P1-Kernmöbel drankommen.
        _RANG = {"P1": 0, "P2": 1, "P3": 2}

        def _slot_rang(typ: str) -> int:
            return min(_RANG.get(i["priorityClass"], 3) for i in slots[typ])

        haupt_slots = {t for t in slots if _item_ebene(slots[t][0]) == "haupt"}
        erg_slots = {t for t in slots if _item_ebene(slots[t][0]) == "ergaenzung"}
        # Phase 1 – Haupt: P1-Pflicht zuerst (Anschluss/Kern), dann Rang-Ordnung.
        pflicht = [t for t in P1_PFLICHT.get(room_type, []) if t in slots]
        for typ in pflicht:
            nimm_haupt(typ)
        for typ in sorted(haupt_slots - set(pflicht), key=lambda t: (_slot_rang(t), t)):
            nimm_haupt(typ)

        # Phase 2 – Ergänzungen: Anker-Check + deterministische Anzahl + Korridor.
        # Verankerte Ergänzungen ZUERST (den Möbel-Satz vervollständigen – Stühle
        # zum Esstisch, Couchtisch zum Sofa), dann freie Deko-Ergänzungen; so
        # frisst der Korridor nicht die essenziellen Anker-Objekte (z.B. Stühle)
        # zugunsten alphabetisch früher freistehender Deko auf.
        def _erg_rang(typ: str) -> tuple[int, int, str]:
            verankert = 0 if slots[typ][0].get("ankerTyp") else 1
            return (verankert, _slot_rang(typ), typ)

        for typ in sorted(erg_slots, key=_erg_rang):
            nimm_ergaenzung(typ)

        auswahl = _auswahl_aus_ebenen(haupt_objekte, ergaenzungen)
        return {
            # Baseline hat keine Design-Leitidee (rein deterministisch) → kein Konzept.
            "konzept": None,
            "auswahl": auswahl,
            "hauptObjekte": haupt_objekte,
            "ergaenzungen": ergaenzungen,
            "relationaleAbsichten": absichten,
            "anordnung": _baseline_anordnung(auswahl, by_id),
            "flaechen": None,
            # Baseline trifft keine Farbwahl → kein farben-Feld (Client nutzt die
            # Default-Optik = erste farbVariante je Item).
            "farben": None,
            "begruendung": "Deterministische Baseline: Haupt-Objekte zuerst "
            "(P1-Pflicht, dann Prioritätsklasse), dann verankerte Ergänzungen mit "
            "Anzahl – bestes Item je Slot nach Stil-Score (cos) mit Seed-Rauschen.",
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
        # Thinking-/Sampling-Steuerung (ADR-0014) – nur wenn Env gesetzt, sonst
        # bleibt das Payload wie bisher (andere Provider unberührt).
        self.reasoning: str | None = os.environ.get("FP_KURATOR_REASONING")
        # Temperatur je Call-Art: Call A wählt Möbel + Konzept aus (dort will man
        # Varianz, sonst liefert «Neue Variante» bei jedem Seed fast dasselbe),
        # Call B/C füllen enge Strukturen (dort will man Fokus). Ein gesetztes
        # FP_KURATOR_TEMP übersteuert BEIDE bewusst – ein Wert zum Messen.
        temp_env = os.environ.get("FP_KURATOR_TEMP")
        self.temp_override: float | None = float(temp_env) if temp_env else None
        self.temperature: float = self.temp_override if self.temp_override is not None else 0.3
        # Explizites Antwort-Budget: Rate-Limiter (Groq) zählen sonst das
        # maximale Completion-Fenster zur Request-Grösse → 413. Override via
        # FP_KURATOR_MAX_ANTWORT_TOKENS (z.B. höher für Thinking-Modus); ohne
        # Override gilt das knappere Budget JE CALL (s. _ANTWORT_TOKENS_*).
        antwort_env = os.environ.get("FP_KURATOR_MAX_ANTWORT_TOKENS")
        self.max_antwort_tokens: int | None = int(antwort_env) if antwort_env else None
        # Ursache des letzten gescheiterten _call_json (für den Fallback-Marker,
        # z.B. «HTTP 413»); None = kein Fehler bzw. noch kein Call.
        self._letzte_ursache: str | None = None
        # Letzte nach dem Repair noch ungültige Antwort + ihr Grund – Grundlage
        # der Platz-Rettung in `kuratiere` (s. `trimme_platz_budget`).
        self._letzte_ungueltige: dict[str, Any] | None = None
        self._letzter_fehler: str | None = None

    def _post_mit_backoff(self, headers: dict[str, str], payload: dict[str, Any]) -> httpx.Response:
        """POST mit kleinem 429-Backoff (max. 3 Wiederholungen, Retry-After
        respektiert, Deckel 30 s). Free-Tier-Limits (Tokens/Minute) drosseln
        Serien-Läufe wie Eval/Diagnose – ohne Backoff kippt jeder gedrosselte
        Call in den Baseline-Fallback statt kurz zu warten."""
        for versuch in range(4):
            res = httpx.post(
                f"{self.url}/chat/completions",
                headers=headers,
                json=payload,
                timeout=self.timeout_s,
            )
            if res.status_code != 429 or versuch == 3:
                return res
            retry_after = res.headers.get("retry-after")
            try:
                warte = min(float(retry_after), 30.0) if retry_after else 8.0 * (versuch + 1)
            except ValueError:
                warte = 8.0 * (versuch + 1)
            log.info("kurator: 429 rate-limit, warte %.1fs (versuch %d)", warte, versuch + 1)
            time.sleep(warte)
        return res  # unerreichbar, beruhigt den Typchecker

    # --- Prompt-Bau ---------------------------------------------------------

    def _prompt_auswahl(
        self,
        stilprofil: dict[str, Any],
        room: dict[str, Any],
        slots: dict[str, list[dict[str, Any]]],
        budget: float | None,
    ) -> tuple[list[dict[str, str]], HandleKarte]:
        """Baut Call-A-Messages + die dazugehörige `HandleKarte` (Handle-Mapping,
        s. Moduldoc). Reine Funktion ihrer Argumente: derselbe Aufruf liefert
        immer dieselbe Karte – Repair-Schritte rufen diese Methode einfach
        erneut mit denselben Argumenten auf, statt die Karte separat
        durchzureichen."""
        rolle = PROMPT_AUSWAHL.read_text(encoding="utf-8")
        fakten = [
            f"Raumtyp: {room['roomType']} · Fläche: {room['shell']['floor'].get('area')} m²",
            f"Fixpunkte: {sorted({f['type'] for f in room['fixpoints']})}",
            f"Öffnungen: {sorted({o['type'] for o in room['openings']})}",
        ]
        profil = _profil_zeilen(stilprofil)
        p1 = set(P1_PFLICHT.get(room["roomType"], []))
        area = room["shell"]["floor"].get("area") or 0.0
        budget_zeile = f"Budget: CHF {budget}" if budget is not None else "Budget: keines"
        platz_zeile = (
            f"Platz-Budget (hart geprüft): addiere die «Platz»-Werte deiner gewählten "
            f"Objekte (bei anzahl>1 mehrfach). Die Summe muss ≤ {area:.1f} m² bleiben."
        )

        def _item_zeile(i: dict[str, Any], karte: HandleKarte) -> str:
            """Kompakte Kandidatenzeile (Prompt-Diät v3.2): Kurznummer (`#N`,
            Handle-Mapping) statt UUID, Stil-Kürzel statt achsenTags-JSON, Masse
            ohne Einheit, Preis ganzzahlig, Farben als slug|slug. Der Item-NAME
            trägt zusätzlich Stil-Information."""
            m = i["masse"]
            teile = [f"  {karte.handle_fuer(i['id'])}", i["name"]]
            stil = stil_kurz(i)
            if stil:
                teile.append(stil)
            teile.append(f"{m['w']}×{m['d']}×{m['h']}")
            teile.append(f"CHF {int(round(float(i['preis']['value'])))}")
            # Vorgerechneter Platzwert statt Rechenaufgabe (s. `platz_anzeige`).
            teile.append(f"Platz {platz_anzeige(i):.1f}m²")
            varianten = _farb_varianten(i)
            if varianten:
                teile.append("F:" + "|".join(varianten))
            return " · ".join(teile)

        # Zwei Gruppen (Objekt-Ebenen-Modell): Haupt-Objekte zuerst, dann
        # Ergänzungen (mit Anker + maxAnzahl je Slot). Items ohne objektEbene
        # gelten als Haupt (Alt-Katalog: eine Gruppe, keine Anker-Pflicht). Die
        # angezeigten Kandidaten je Slot werden über die caps gedeckelt – die
        # Validierung (kuratiere) bleibt auf den vollen `slots` (Erdung intakt).
        def _gezeigte_ids(erg_cap: int, haupt_cap: int, p1_cap: int) -> list[str]:
            """IDs in der Anzeige-Reihenfolge von `_kandidaten` für exakt diese
            Kürzungs-Stufe (Haupt-Slots zuerst, dann Ergänzungs-Slots) – Grundlage
            der `HandleKarte`. Eigene, günstige Vorab-Passage OHNE Text-Rendering:
            die Handle-Nummer muss vor dem eigentlichen Rendern feststehen."""
            haupt_ids: list[str] = []
            erg_ids: list[str] = []
            for typ, items in sorted(slots.items()):
                if _item_ebene(items[0]) == "ergaenzung":
                    erg_ids.extend(i["id"] for i in items[:erg_cap])
                else:
                    cap = p1_cap if typ in p1 else haupt_cap
                    haupt_ids.extend(i["id"] for i in items[:cap])
            return haupt_ids + erg_ids

        def _kandidaten(
            karte: HandleKarte, erg_cap: int, haupt_cap: int, p1_cap: int
        ) -> tuple[list[str], int]:
            haupt_block: list[str] = []
            erg_block: list[str] = []
            gezeigt = 0
            for typ, items in sorted(slots.items()):
                if _item_ebene(items[0]) == "ergaenzung":
                    auswahl_items = items[:erg_cap]
                    anker = items[0].get("ankerTyp")
                    maxn = int(items[0].get("maxAnzahl", 1) or 1)
                    merkmale = ([f"Anker {anker}"] if anker else ["frei"]) + [f"max {maxn}"]
                    erg_block.append(f"Slot {typ} ({', '.join(merkmale)}):")
                    erg_block.extend(_item_zeile(i, karte) for i in auswahl_items)
                else:
                    cap = p1_cap if typ in p1 else haupt_cap
                    auswahl_items = items[:cap]
                    pflicht = " (P1-PFLICHT)" if typ in p1 else ""
                    haupt_block.append(f"Slot {typ}{pflicht}:")
                    haupt_block.extend(_item_zeile(i, karte) for i in auswahl_items)
                gezeigt += len(auswahl_items)
            bloecke: list[str] = ["## Haupt-Objekte (raumprägend – ZUERST wählen)", *haupt_block]
            if erg_block:
                bloecke += [
                    "",
                    "## Ergänzungen (nur mit passendem Haupt-Objekt; anzahl 1..max)",
                    *erg_block,
                ]
            return bloecke, gezeigt

        def _baue(
            erg_cap: int, haupt_cap: int, p1_cap: int
        ) -> tuple[list[dict[str, str]], int, HandleKarte]:
            karte = _erzeuge_handle_karte(_gezeigte_ids(erg_cap, haupt_cap, p1_cap))
            kandidaten, gezeigt = _kandidaten(karte, erg_cap, haupt_cap, p1_cap)
            user = "\n".join(
                [
                    "## Raumfakten",
                    *fakten,
                    "",
                    *_stil_legende(),
                    "",
                    "## Stilprofil",
                    *profil,
                    "",
                    "## Raumgeometrie – Wände (0-basierter wandIndex)",
                    *_wandliste(room),
                    "",
                    *kandidaten,
                    "",
                    budget_zeile,
                    platz_zeile,
                    *_leitplanke_zeile(room["roomType"], area),
                ]
            )
            return (
                [
                    {"role": "system", "content": rolle},
                    {"role": "user", "content": user},
                ],
                gezeigt,
                karte,
            )

        # Adaptive Grössen-Kontrolle: Kürzungs-Leiter ablaufen, bis Gesamt-Deckel
        # UND Token-Limit eingehalten sind; sonst die Minimal-Stufe nehmen (nie
        # unter KANDIDATEN_MIN je Slot) und warnen. Deterministisch + geloggt.
        # Die Handle-Karte wird PRO STUFE frisch gebaut (andere Kürzung = andere
        # angezeigte Menge = andere Nummerierung) und zusammen mit den Messages
        # zurückgegeben, die letztlich gerendert wurden.
        stufen = _kandidaten_stufen()
        limit = _max_prompt_tokens()
        letzte: list[dict[str, str]] = []
        letzte_karte = HandleKarte({}, {})
        for idx, caps in enumerate(stufen):
            messages, gezeigt, karte = _baue(*caps)
            tokens = schaetze_tokens("\n".join(m["content"] for m in messages))
            letzte, letzte_karte = messages, karte
            passt = gezeigt <= KANDIDATEN_DECKEL and tokens <= limit
            if passt or idx == len(stufen) - 1:
                stufe = "" if passt else " (Minimum erreicht, weiterhin > Limit)"
                log.info(
                    "kurator[auswahl]: prompt ~%d tokens, %d kandidaten, stufe %d/%d, limit %d%s",
                    tokens,
                    gezeigt,
                    idx,
                    len(stufen) - 1,
                    limit,
                    stufe,
                )
                return messages, karte
        return letzte, letzte_karte

    def _prompt_anordnung(
        self,
        auswahl: list[str],
        by_id: dict[str, dict[str, Any]],
        room: dict[str, Any],
        stilprofil: dict[str, Any],
        konzept: str | None,
    ) -> tuple[list[dict[str, str]], HandleKarte]:
        """Baut Call-B-Messages + eine EIGENE `HandleKarte` (Handle-Mapping, s.
        Moduldoc), frisch aus der Anzeige-Reihenfolge von `auswahl` – unabhängig
        von der Call-A-Karte (Call B zeigt nur die bereits getroffene Auswahl,
        eine kompakte 1..N-Nummerierung reicht). Reine Funktion ihrer Argumente
        (Repair-Aufrufe bauen dieselbe Karte einfach erneut)."""
        rolle = PROMPT_ANORDNUNG.read_text(encoding="utf-8")
        karte = _erzeuge_handle_karte(auswahl)
        items = []
        for iid in auswahl:
            it = by_id[iid]
            m = it["masse"]
            items.append(
                f"  {karte.handle_fuer(iid)} · {it['name']} · funktionsTyp {it['funktionsTyp']} · "
                f"{m['w']}×{m['d']}×{m['h']} m · {it['priorityClass']}"
            )
        gewaehlte_typen = {by_id[i]["funktionsTyp"] for i in auswahl}
        hinweise = bewegungs_hinweise(room, gewaehlte_typen)
        norm_block = (
            [
                "## Norm-Hinweise für sinnvolle Wünsche (Information – der Solver prüft hart)",
                *hinweise,
                "",
            ]
            if hinweise
            else []
        )
        messages = [
            {"role": "system", "content": rolle},
            {
                "role": "user",
                "content": "\n".join(
                    [
                        *_konzept_block(konzept),
                        "## Stilprofil",
                        *_profil_zeilen(stilprofil),
                        "",
                        "## Auswahl (nur diese Kurznummern #N verwenden, niemals andere "
                        "Bezeichner – auch in pair-with:#N)",
                        *items,
                        "",
                        *norm_block,
                        "## Raumgeometrie – Wände (0-basierter wandIndex)",
                        *_wandliste(room),
                    ]
                ),
            },
        ]
        _logge_prompt_groesse(messages, "anordnung")
        return messages, karte

    def _prompt_flaechen(
        self,
        stilprofil: dict[str, Any],
        room: dict[str, Any],
        auswahl: list[str],
        by_id: dict[str, dict[str, Any]],
        konzept: str | None,
    ) -> list[dict[str, str]]:
        rolle = PROMPT_FLAECHEN.read_text(encoding="utf-8")
        moebel = []
        for iid in auswahl:
            it = by_id[iid]
            m = it["masse"]
            moebel.append(
                f"  {it['name']} · funktionsTyp {it['funktionsTyp']} · {m['w']}×{m['d']}×{m['h']} m"
            )
        norm = norm_kontext_flaechen(room)
        norm_block = (
            ["## Harte Normregeln (maschinell geprüft – strikt einhalten)", *norm, ""]
            if norm
            else []
        )
        messages = [
            {"role": "system", "content": rolle},
            {
                "role": "user",
                "content": "\n".join(
                    [
                        *_konzept_block(konzept),
                        f"## Raum\nRaumtyp: {room['roomType']}",
                        "",
                        "## Stilprofil",
                        *_profil_zeilen(stilprofil),
                        "",
                        "## Gewählte Möbel (Flächen sollen dazu passen)",
                        *moebel,
                        "",
                        "## Wände (0-basierter wandIndex)",
                        *_wandliste(room),
                        "",
                        *norm_block,
                        "## Erlaubte Material-Slugs (NUR daraus wählen)",
                        ", ".join(MATERIAL_SLUGS),
                    ]
                ),
            },
        ]
        _logge_prompt_groesse(messages, "flaechen")
        return messages

    # --- LLM-Aufruf + generischer Repair-Runner -----------------------------

    def _rufe_llm(
        self,
        messages: list[dict[str, str]],
        seed: int | None = None,
        temperature: float | None = None,
        max_antwort_tokens: int | None = None,
    ) -> dict[str, Any]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        # temperature: fokussierter als 0.7 (weniger Rauschen), aber nicht
        # deterministisch-flach; je Call gesetzt (s. __init__), FP_KURATOR_TEMP
        # übersteuert. seed: OpenAI-kompatibel «best effort» – reduziert
        # Run-zu-Run-Streuung, wo das Serving es unterstützt (sonst ignoriert).
        temp = self.temp_override if self.temp_override is not None else (temperature or 0.3)
        fenster = self.max_antwort_tokens or max_antwort_tokens or _ANTWORT_TOKENS_AUSWAHL
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": temp,
            "response_format": {"type": "json_object"},
            # Ohne explizites max_tokens rechnen Rate-Limiter (z.B. Groq) das
            # MAXIMALE Antwort-Budget in die Request-Grösse ein → 413 trotz
            # kleinem Prompt. Unsere JSON-Antworten sind kompakt; 1200 deckt
            # Auswahl inkl. Konzept/Begründung locker.
            "max_tokens": fenster,
        }
        if seed is not None:
            payload["seed"] = seed
        # Thinking-Steuerung: Qwen3 denkt DEFAULT laut (<think>-Text) – unter
        # response_format=json_object quittiert Groq das mit 400
        # json_validate_failed, und der gescheiterte Call verbrennt trotzdem
        # das Tokens/Minute-Budget (429/413-Kaskade danach). Darum bei Qwen3
        # ohne FP_KURATOR_REASONING das Denken explizit AUS (effort "none") und
        # der Denktext via reasoning_format="hidden" aus dem Content. Gesetztes
        # FP_KURATOR_REASONING (z.B. "default") schaltet Thinking bewusst ein.
        # Nicht-Qwen3-Provider bleiben ohne Env-Flag unberührt (best effort).
        ist_qwen3 = "qwen3" in self.model.lower()
        effort = self.reasoning or ("none" if ist_qwen3 else None)
        if effort:
            payload["reasoning_effort"] = effort
            payload["reasoning_format"] = "hidden"
        res = self._post_mit_backoff(headers, payload)
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
        seed: int | None = None,
        uebersetze: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
        temperature: float | None = None,
        max_antwort_tokens: int | None = None,
    ) -> dict[str, Any] | None:
        """Ein LLM-Call mit Validierung + max. 1 Repair-Retry. None = gescheitert.

        Jeder Call ist einzeln geloggt; scheitert er, entscheidet der Aufrufer über
        den (Teil-)Fallback – nie ein harter Fehler nach oben. Die Fehlerursache
        (HTTP-Status/Klasse bzw. «ungültig nach Repair») wird in
        `self._letzte_ursache` hinterlegt, damit der Aufrufer sie im Fallback-
        Marker sichtbar machen kann (Groq-413-Diagnose).

        `uebersetze` (Handle-Mapping, s. Moduldoc): läuft auf der ROHEN LLM-
        Antwort, VOR `validiere` – Handles werden also zu echten itemIds, bevor
        die harte Erdung sie prüft. Das Repair-Echo (Assistant-Nachricht) zeigt
        dabei bewusst die ROHE (nicht zurückübersetzte) Antwort: der Repair denkt
        so im selben Vokabular weiter, in dem das Modell selbst geantwortet hat
        (einfachste korrekte Variante – kein zusätzlicher Hin-und-Her-Übersetzungsschritt
        nötig, da `validiere` ohnehin nur die übersetzte Fassung sieht).
        """
        self._letzte_ursache = None
        self._letzte_ungueltige = None
        self._letzter_fehler = None
        try:
            roh = self._rufe_llm(messages, seed, temperature, max_antwort_tokens)
            antwort = uebersetze(roh) if uebersetze else roh
            fehler = validiere(antwort)
            if fehler is not None:
                # Repair-Retry (max. 1) mit konkretem Fehlerhinweis (Konzept §5).
                messages = [
                    *messages,
                    {"role": "assistant", "content": json.dumps(roh)},
                    {
                        "role": "user",
                        "content": f"Deine Antwort ist ungültig: {fehler} "
                        "Korrigiere und antworte erneut nur mit JSON.",
                    },
                ]
                roh = self._rufe_llm(messages, seed, temperature, max_antwort_tokens)
                antwort = uebersetze(roh) if uebersetze else roh
                fehler = validiere(antwort)
            if fehler is None:
                return antwort
            log.warning("kurator[%s]: nach repair weiterhin ungültig (%s)", name, fehler)
            # Antwort + Grund aufheben: bei reiner Platz-Überbelegung rettet der
            # Aufrufer die KI-Auswahl deterministisch (`trimme_platz_budget`),
            # statt sie zu verwerfen.
            self._letzte_ungueltige = antwort
            self._letzter_fehler = fehler
            # Konkreten Validierungsgrund in den Marker heben: «ungültig nach
            # Repair» allein ist beim Debuggen im Space wertlos – erst «Platz-
            # Budget überschritten: 9.4 > 7.2» macht die Ursache sichtbar.
            self._letzte_ursache = f"ungültig nach Repair: {fehler[:180]}"
        except (httpx.HTTPError, json.JSONDecodeError, KeyError) as e:
            log.warning("kurator[%s]: llm-aufruf fehlgeschlagen (%s)", name, e)
            self._letzte_ursache = _fehler_ursache(e)
        return None

    def _trimme_letzte_auswahl(
        self,
        slots: dict[str, list[dict[str, Any]]],
        platz_budget: float | None,
        stilprofil: dict[str, Any],
        validiere: Callable[[dict[str, Any]], str | None],
    ) -> tuple[dict[str, Any], int] | None:
        """Die zuletzt am Platz-Budget gescheiterte Antwort retten. None = nicht möglich.

        Greift NUR, wenn `_call_json` genau diesen Fehler gemeldet hat (Präfix
        `PLATZ_FEHLER_PRAEFIX`) – bei erfundenen IDs, fehlender P1-Pflicht oder
        HTTP-Fehlern wäre Trimmen sinnlos oder gefährlich. Das getrimmte Ergebnis
        läuft anschliessend ERNEUT komplett durch `_validiere_ebenen`: die harte
        Erdung wird hier nicht aufgeweicht, sondern noch einmal bewiesen.
        """
        antwort = self._letzte_ungueltige
        fehler = self._letzter_fehler
        if antwort is None or not fehler or not fehler.startswith(PLATZ_FEHLER_PRAEFIX):
            return None
        if platz_budget is None:
            return None
        haupt, erg = _extrahiere_ebenen(antwort)
        erlaubte = {i["id"]: i for items in slots.values() for i in items}
        if any(i not in erlaubte for i in _auswahl_aus_ebenen(haupt, erg)):
            return None
        getrimmt = trimme_platz_budget(haupt, erg, erlaubte, platz_budget, stilprofil)
        if getrimmt is None:
            return None
        neue_erg, entfernt = getrimmt
        neu = dict(antwort)
        neu["hauptObjekte"] = haupt
        neu["ergaenzungen"] = neue_erg
        neu.pop("auswahl", None)  # wird aus den Ebenen neu abgeleitet
        # Farben der weggefallenen Items mitnehmen, sonst schlägt die
        # Farb-Validierung auf einer Auswahl fehl, die es nicht mehr gibt.
        behalten = set(_auswahl_aus_ebenen(haupt, neue_erg))
        farben = neu.get("farben")
        if isinstance(farben, dict):
            neu["farben"] = {k: v for k, v in farben.items() if k in behalten}
        rest_fehler = validiere(neu)
        if rest_fehler is not None:
            log.warning("kurator[auswahl]: trimmen half nicht (%s)", rest_fehler)
            return None
        log.info("kurator[auswahl]: platz-budget durch trimmen erfüllt (%d entfernt)", entfernt)
        return (neu, entfernt)

    def _flaechen_norm_repair(
        self,
        basis_messages: list[dict[str, str]],
        voriges: dict[str, Any],
        verstoesse: list[str],
        n_walls: int,
        room: dict[str, Any],
        seed: int | None = None,
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
            antwort = self._rufe_llm(messages, seed)
        except (httpx.HTTPError, json.JSONDecodeError, KeyError) as e:
            log.warning("kurator[flaechen-norm]: repair-aufruf fehlgeschlagen (%s)", e)
            return None
        if _validiere_flaechen(antwort, n_walls, MATERIAL_SLUGS) is not None:
            return None
        flaechen: dict[str, Any] = antwort["flaechen"]
        if pruefe_flaechen(flaechen, room, FLAECHEN_REGELN):
            return None
        return flaechen

    def _farben_repair(
        self,
        basis_messages: list[dict[str, str]],
        handles: HandleKarte,
        voriges: dict[str, Any],
        fehler: str,
        auswahl: list[str],
        by_id: dict[str, dict[str, Any]],
        seed: int | None = None,
    ) -> dict[str, str] | None:
        """Ein einziger Farb-Repair-Aufruf (analog `_flaechen_norm_repair`): gibt den
        konkreten Farb-Fehler zurück ans LLM und verlangt eine korrigierte
        `farben`-Abbildung. Rückgabe = geerdetes farben-Objekt, sonst None (dann
        greift `_bereinige_farben`).

        `handles` (Call-A-Karte, Handle-Mapping s. Moduldoc): das Echo der
        vorigen Antwort zeigt die Farb-Keys im Handle-Vokabular (wie das Modell
        selbst geantwortet hätte); die neue Antwort wird vor der Validierung
        wieder zu echten itemIds übersetzt."""
        hinweis = (
            f"Deine Farb-Zuordnung ist ungültig: {fehler} "
            "Nutze je Item NUR einen Slug aus dessen farbVarianten und als Schlüssel "
            "nur die Kurznummer (#N) gewählter Items. Antworte erneut nur mit JSON "
            "(Feld «farben»)."
        )
        roh_voriges = voriges.get("farben")
        echo_farben = (
            {handles.handle_fuer(k): v for k, v in roh_voriges.items()}
            if isinstance(roh_voriges, dict)
            else roh_voriges
        )
        messages = [
            *basis_messages,
            {"role": "assistant", "content": json.dumps({"farben": echo_farben})},
            {"role": "user", "content": hinweis},
        ]
        try:
            antwort = self._rufe_llm(messages, seed)
        except (httpx.HTTPError, json.JSONDecodeError, KeyError) as e:
            log.warning("kurator[farben]: repair-aufruf fehlgeschlagen (%s)", e)
            return None
        roh_farben = antwort.get("farben")
        farben = (
            {handles.id_fuer(k): v for k, v in roh_farben.items()}
            if isinstance(roh_farben, dict)
            else roh_farben
        )
        if _validiere_farben(farben, auswahl, by_id) is not None:
            return None
        return farben

    def _anzahl_repair(
        self,
        basis_messages: list[dict[str, str]],
        handles: HandleKarte,
        haupt: list[str],
        erg: list[dict[str, Any]],
        total: int,
        korridor: tuple[int, int],
        slots: dict[str, list[dict[str, Any]]],
        room_type: str,
        budget: float | None,
        platz_budget: float | None,
        by_id: dict[str, dict[str, Any]],
        seed: int | None = None,
    ) -> dict[str, Any] | None:
        """Ein WEICHER Anzahl-Repair-Aufruf (analog `_farben_repair`): meldet die
        Instanz-Gesamtzahl vs. Korridor zurück ans LLM und verlangt eine erneute
        (voll gültige) Call-A-Antwort. Rückgabe = hart valide Antwort (die
        Korridor-Lage entscheidet der Aufrufer), sonst None.

        `handles` (Call-A-Karte, Handle-Mapping s. Moduldoc): das Echo der
        vorigen Antwort zeigt hauptObjekte/ergaenzungen im Handle-Vokabular; die
        neue Antwort wird vor der Validierung wieder zu echten itemIds übersetzt."""
        lo, hi = korridor
        richtung = "zu wenige" if total < lo else "zu viele"
        hinweis = (
            f"Du hast {total} Objekt-Instanzen gewählt – Ziel {lo}–{hi} für diesen "
            f"Raum ({richtung}). Passe hauptObjekte/ergaenzungen (inkl. anzahl) an und "
            "antworte erneut nur mit JSON im selben Schema."
        )
        echo_haupt = [handles.handle_fuer(i) for i in haupt]
        echo_erg = [{**e, "itemId": handles.handle_fuer(e["itemId"])} for e in erg]
        messages = [
            *basis_messages,
            {
                "role": "assistant",
                "content": json.dumps({"hauptObjekte": echo_haupt, "ergaenzungen": echo_erg}),
            },
            {"role": "user", "content": hinweis},
        ]
        try:
            roh = self._rufe_llm(messages, seed)
        except (httpx.HTTPError, json.JSONDecodeError, KeyError) as e:
            log.warning("kurator[anzahl]: repair-aufruf fehlgeschlagen (%s)", e)
            return None
        antwort = _uebersetze_auswahl_antwort(roh, handles)
        if _validiere_ebenen(antwort, slots, room_type, budget, platz_budget, by_id) is not None:
            return None
        return antwort

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
        platz_budget = _platz_budget(room, slots, room_type)

        # Call A – Auswahl (Objekt-Ebenen: hauptObjekte + ergaenzungen). Harte
        # Kontrolle via _validiere_ebenen; scheitert A → alles Baseline (B/C
        # brauchen die Auswahl). Alt-Form (nur `auswahl`) läuft transparent mit.
        # Handle-Mapping (s. Moduldoc): `messages_a`/`handles_a` bündeln Prompt +
        # Kurznummer-Karte für diesen Call – Repair-Schritte (Anzahl/Farben)
        # bauen dieselbe Karte einfach erneut über dieselben Argumente.
        messages_a, handles_a = self._prompt_auswahl(stilprofil, room, slots, budget)

        def _validiere_a(a: dict[str, Any]) -> str | None:
            return _validiere_ebenen(a, slots, room_type, budget, platz_budget, by_id)

        antwort_a = self._call_json(
            messages_a,
            _validiere_a,
            "auswahl",
            seed,
            uebersetze=lambda a: _uebersetze_auswahl_antwort(a, handles_a),
            temperature=TEMP_AUSWAHL,
            max_antwort_tokens=_ANTWORT_TOKENS_AUSWAHL,
        )
        platz_hinweis = ""
        if antwort_a is None:
            # Rettungsversuch VOR dem Fallback: scheiterte die Antwort einzig am
            # Platz-Budget, wird die KI-Auswahl deterministisch getrimmt statt
            # verworfen (Bryans Vorgabe – die KI-Entscheidung ist der Wert).
            gerettet = self._trimme_letzte_auswahl(slots, platz_budget, stilprofil, _validiere_a)
            if gerettet is not None:
                antwort_a, entfernt = gerettet
                platz_hinweis = (
                    f" (Platz-Budget: CURATOR_PLATZ_REDUZIERT, {entfernt} "
                    f"Ergänzung{'en' if entfernt != 1 else ''} entfernt)"
                )
        if antwort_a is None:
            ergebnis = BaselineKurator().kuratiere(stilprofil, room, catalog, budget, seed)
            # Marker-Präfix «CURATOR_FALLBACK_USED» bleibt stabil (Tests/Konsumenten
            # matchen per Substring); die Ursache (z.B. «HTTP 413») wird angehängt.
            ursache = self._letzte_ursache
            marker = "CURATOR_FALLBACK_USED" + (f" ({ursache})" if ursache else "")
            ergebnis["begruendung"] += f" (Fallback: {marker})"
            return ergebnis
        finale_a = antwort_a
        haupt_objekte, ergaenzungen = _extrahiere_ebenen(antwort_a)
        auswahl: list[str] = _auswahl_aus_ebenen(haupt_objekte, ergaenzungen)
        # Konzept ist weich/optional (keine Norm) → fehlend = kein Konzept-Block.
        konzept = antwort_a.get("konzept")
        begruendung = str(antwort_a.get("begruendung", "")) + platz_hinweis
        gewaehlte_typen = {by_id[i]["funktionsTyp"] for i in auswahl}

        # Anzahl-Korridor (WEICH, ADR-0014): nur bei der neuen zweistufigen Form
        # (Alt-Form ohne hauptObjekte/ergaenzungen bleibt unberührt). Liegt die
        # Instanz-Gesamtzahl ausserhalb → 1 Repair-Hinweis; bleibt sie draussen,
        # wird akzeptiert + Marker CURATOR_ANZAHL_AUSSERHALB (hart bleibt nur das
        # Platz-Budget aus _validiere_ebenen).
        neue_form = (
            antwort_a.get("hauptObjekte") is not None or antwort_a.get("ergaenzungen") is not None
        )
        korridor = anzahl_leitplanke(room_type, room["shell"]["floor"].get("area") or 0.0)
        if neue_form and korridor is not None:
            total = _instanz_anzahl(haupt_objekte, ergaenzungen)
            if not (korridor[0] <= total <= korridor[1]):
                repariert_a = self._anzahl_repair(
                    messages_a,
                    handles_a,
                    haupt_objekte,
                    ergaenzungen,
                    total,
                    korridor,
                    slots,
                    room_type,
                    budget,
                    platz_budget,
                    by_id,
                    seed,
                )
                if repariert_a is not None:
                    finale_a = repariert_a
                    haupt_objekte, ergaenzungen = _extrahiere_ebenen(repariert_a)
                    auswahl = _auswahl_aus_ebenen(haupt_objekte, ergaenzungen)
                    gewaehlte_typen = {by_id[i]["funktionsTyp"] for i in auswahl}
                    total = _instanz_anzahl(haupt_objekte, ergaenzungen)
                if not (korridor[0] <= total <= korridor[1]):
                    begruendung += " (Anzahl ausserhalb Korridor: CURATOR_ANZAHL_AUSSERHALB)"

        # Farben (Welle 3) – EIGENER Validierungsschritt NACH _validiere/Call A:
        # die Auswahl steht bereits (A-Fallback unberührt). Ungültige Farbwahl →
        # 1 Farb-Repair; scheitert auch der NUR an den Farben, werden die
        # ungültigen Einträge entfernt (Rest behalten) statt alles zu verwerfen.
        roh_farben = finale_a.get("farben")
        farb_fehler = _validiere_farben(roh_farben, auswahl, by_id)
        farben: dict[str, str] | None
        if farb_fehler is None:
            farben = roh_farben
        else:
            repariert_f = self._farben_repair(
                messages_a,
                handles_a,
                finale_a,
                farb_fehler,
                auswahl,
                by_id,
                seed,
            )
            if repariert_f is not None:
                farben = repariert_f
            else:
                farben = _bereinige_farben(roh_farben, auswahl, by_id)
                begruendung += " (Farben bereinigt: CURATOR_FARBEN_BEREINIGT)"

        # Calls B und C hängen beide NUR von Call A ab – sie laufen darum
        # nebenläufig (zwei Threads; die HTTP-Calls sind I/O-bound, ein
        # async-Umbau des ganzen Moduls wäre unverhältnismässig). Der Nutzer
        # wartet dadurch spürbar kürzer auf seinen Vorschlag. Die Ergebnisse
        # werden anschliessend in FESTER Reihenfolge ausgewertet (erst
        # Anordnung, dann Flächen), damit die Marker-Reihenfolge in der
        # `begruendung` und damit alle Tests/Diagnosen stabil bleiben.
        # Eigene Handle-Karte für B (Call-A-Handles gelten nicht 1:1 weiter – B
        # zeigt nur die Auswahl, frisch 1..N nummeriert, s. `_prompt_anordnung`).
        messages_b, handles_b = self._prompt_anordnung(auswahl, by_id, room, stilprofil, konzept)
        messages_c = self._prompt_flaechen(stilprofil, room, auswahl, by_id, konzept)

        def _hole_anordnung() -> dict[str, Any] | None:
            return self._call_json(
                messages_b,
                lambda a: _validiere_anordnung(a, auswahl, n_walls, gewaehlte_typen),
                "anordnung",
                seed,
                uebersetze=lambda a: _uebersetze_anordnung_antwort(a, handles_b),
                temperature=TEMP_FOKUSSIERT,
                max_antwort_tokens=_ANTWORT_TOKENS_ANORDNUNG,
            )

        def _hole_flaechen() -> dict[str, Any] | None:
            return self._call_json(
                messages_c,
                lambda a: _validiere_flaechen(a, n_walls, MATERIAL_SLUGS),
                "flaechen",
                seed,
                temperature=TEMP_FOKUSSIERT,
                max_antwort_tokens=_ANTWORT_TOKENS_FLAECHEN,
            )

        with ThreadPoolExecutor(max_workers=2) as pool:
            future_b = pool.submit(_hole_anordnung)
            future_c = pool.submit(_hole_flaechen)
            antwort_b = _future_ergebnis(future_b, "anordnung")
            antwort_c = _future_ergebnis(future_c, "flaechen")

        if antwort_b is not None:
            anordnung: list[dict[str, Any]] = antwort_b["anordnung"]
        else:
            anordnung = _baseline_anordnung(auswahl, by_id)
            begruendung += " (Teil-Fallback Anordnung: CURATOR_ANORDNUNG_FALLBACK)"

        # Call C – Flächen (oben parallel zu B geholt). Zwei Kontrollen,
        # «davor UND danach»:
        #   1. strukturell (_call_json: Slugs/Bereiche, +1 Repair) – scheitert das
        #      oder der HTTP-Call → Teil-Fallback flaechen=None (Client leitet ab).
        #   2. hart normativ (pruefe_flaechen gegen data/rules/flaechen.json):
        #      bei Verstoß 1 Norm-Repair-Retry → sonst deterministische
        #      korrigiere_flaechen (verwirft NICHT, sondern macht konform).
        flaechen: dict[str, Any] | None
        if antwort_c is None:
            flaechen = None
            begruendung += " (Teil-Fallback Flächen: CURATOR_FLAECHEN_FALLBACK)"
        else:
            flaechen = antwort_c["flaechen"]
            verstoesse = pruefe_flaechen(flaechen, room, FLAECHEN_REGELN)
            if verstoesse:
                repariert = self._flaechen_norm_repair(
                    messages_c,
                    flaechen,
                    verstoesse,
                    n_walls,
                    room,
                    seed,
                )
                if repariert is not None:
                    flaechen = repariert
                    begruendung += " (Norm-Repair Flächen: CURATOR_FLAECHEN_NORMREPAIR)"
                else:
                    flaechen = korrigiere_flaechen(flaechen, room, FLAECHEN_REGELN)
                    begruendung += " (Norm-Korrektur Flächen: CURATOR_FLAECHEN_NORMKORREKTUR)"

        return {
            "konzept": konzept,
            "auswahl": auswahl,
            "hauptObjekte": haupt_objekte,
            "ergaenzungen": ergaenzungen,
            "relationaleAbsichten": _absichten_aus_anordnung(anordnung),
            "anordnung": anordnung,
            "flaechen": flaechen,
            "farben": farben,
            "begruendung": begruendung,
        }


def waehle_port() -> KuratorPort:
    """llm-api, wenn konfiguriert (FP_KURATOR_URL [+MODEL,+API_KEY]); sonst Baseline.

    Alle Werte werden ge-`strip()`t: In Secret-UIs (HF Space) rutscht beim
    Kopieren leicht ein Leerzeichen/Zeilenumbruch ans Ende – ein unsichtbares
    «modell \\n» ergibt beim Provider ein 404, das niemand versteht.
    """
    url = (os.environ.get("FP_KURATOR_URL") or "").strip()
    if url:
        return LlmKurator(
            url=url,
            model=(os.environ.get("FP_KURATOR_MODEL") or "qwen2.5-32b-instruct").strip(),
            api_key=(os.environ.get("FP_KURATOR_API_KEY") or "").strip() or None,
        )
    return BaselineKurator()
