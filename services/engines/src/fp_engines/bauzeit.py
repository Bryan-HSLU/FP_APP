"""Bauzeitenplan: LV-Aufwände + Sequenz-DAG → Gantt mit Trocknungs-Wartekanten.

Mechanik (LV-Bauzeit-Detailkonzept §3): Dauer je Phase = Σ(menge×aufwandswert)
÷ (Teamgrösse × 8 h), aufgerundet auf halbe Tage, Mindestdauer je Einsatz;
Trocknungszeiten sind Wartekanten NACH einer Phase (treiben real die Dauer).
POC strikt sequenziell (keine Gewerk-Überlappung) = konservativ.
Disclaimer: Richtwert – reale Dauer hängt an Handwerker-Verfügbarkeit.
"""

import math
from typing import Any


def erzeuge_bauzeitenplan(lv: dict[str, Any], sequenz: dict[str, Any]) -> dict[str, Any]:
    stunden_pro_tag = sequenz["teamgroesse"] * sequenz["stunden_pro_tag"]
    mindest = sequenz["mindestdauer_tage"]

    aufwand_je_phase: dict[str, float] = {}
    for p in lv["positionen"]:
        aufwand_je_phase[p["phase"]] = aufwand_je_phase.get(p["phase"], 0.0) + p["aufwand_h"]

    ende: dict[str, float] = {}
    zeilen: list[dict[str, Any]] = []
    # Phasenliste ist topologisch sortiert gepflegt (Stammdaten); der max-über-
    # Vorgänger-Start funktioniert auch für echte DAG-Verzweigungen.
    for phase in sequenz["phasen"]:
        aufwand = aufwand_je_phase.get(phase["id"], 0.0)
        if aufwand <= 0:
            continue
        dauer = max(mindest, math.ceil(aufwand / stunden_pro_tag * 2) / 2)
        start = max((ende[v] for v in phase["nach"] if v in ende), default=0.0)
        trocknung = float(phase.get("trocknung_tage", 0))
        ende[phase["id"]] = start + dauer + trocknung
        zeilen.append(
            {
                "phase": phase["id"],
                "name": phase["name"],
                "start_tag": round(start, 1),
                "dauer_tage": dauer,
                "trocknung_tage": trocknung,
                "aufwand_h": round(aufwand, 1),
                "gewerke": sorted(
                    {p["gewerk"] for p in lv["positionen"] if p["phase"] == phase["id"]}
                ),
            }
        )

    gesamt = round(max(ende.values(), default=0.0), 1)
    band = sequenz["bandbreitePct"]
    return {
        "raumName": lv["raumName"],
        "zeilen": zeilen,
        "gesamtdauer_arbeitstage": gesamt,
        "von_tage": round(gesamt * (1 - band / 100), 1),
        "bis_tage": round(gesamt * (1 + band / 100), 1),
        "bandbreitePct": band,
        "hinweis": "Richtwert aus Aufwandswerten v0 (zu-verifizieren) – reale Dauer "
        "hängt an Handwerker-Verfügbarkeit; Trocknungszeiten eingerechnet.",
    }
