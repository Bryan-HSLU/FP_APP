"""Auswertung Stufe 1+2: Mengen → Kosten (KV) – Auswertung-Bauvorhaben §M3.

Gestuft: M3 liefert Mengenauszug + Kostenschätzung (Bandbreite ±, NIE Offerte);
LV/Bauzeit/Offert-Paket kommen mit M4 (LV-Bauzeit-Detailkonzept). Preise tragen
Provenance (quelle/stand) und sind als Schätzung markiert.
"""

from collections import Counter
from typing import Any


def _wandflaeche(room: dict[str, Any]) -> float:
    """Massive Wandfläche abzüglich Öffnungen (v0: Öffnung = width × height)."""
    brutto = sum(
        ((w["end"][0] - w["start"][0]) ** 2 + (w["end"][1] - w["start"][1]) ** 2) ** 0.5
        * w["height"]
        for w in room["shell"]["walls"]
        if w["kind"] == "massiv"
    )
    oeffnungen = sum(o["width"] * o["height"] for o in room["openings"])
    return float(max(0.0, brutto - oeffnungen))


def evaluate_plan(
    room: dict[str, Any], plan: dict[str, Any], catalog: list[dict[str, Any]]
) -> dict[str, Any]:
    """Plan → Mengenauszug + Kostenschätzung (KV-Datenstruktur fürs PDF/UI)."""
    by_id = {c["id"]: c for c in catalog}
    anzahl = Counter(p["catalogItemId"] for p in plan["placements"])

    positionen: list[dict[str, Any]] = []
    for item_id, menge in anzahl.items():
        item = by_id[item_id]
        preis = item["preis"]
        positionen.append(
            {
                "bezeichnung": item["name"],
                "funktionsTyp": item["funktionsTyp"],
                "gewerk": item["gewerk"],
                "menge": menge,
                "einheit": "Stk",
                "einzelpreis_chf": preis["value"],
                "total_chf": round(menge * preis["value"], 2),
                "bandbreitePct": preis["bandbreitePct"],
                "quelle": preis["quelle"],
                "preisstand": preis["stand"],
            }
        )
    positionen.sort(key=lambda p: (-p["total_chf"], p["bezeichnung"]))

    summe = round(sum(p["total_chf"] for p in positionen), 2)
    # Bandbreite der Summe: gewichtetes Mittel der Positions-Bandbreiten.
    bandbreite = (
        round(sum(p["total_chf"] * p["bandbreitePct"] for p in positionen) / summe, 1)
        if summe
        else 0.0
    )

    gewerke = sorted({p["gewerk"] for p in positionen})
    knapp = [
        r for r in plan["constraintReport"]["results"] if r["status"] in ("knapp", "nicht-geprueft")
    ]

    return {
        "raumName": room["name"],
        "mengen": {
            "bodenflaeche_m2": round(room["shell"]["floor"].get("area") or 0.0, 2),
            "wandflaeche_m2": round(_wandflaeche(room), 2),
            "objekte": sum(anzahl.values()),
        },
        "positionen": positionen,
        "summe_chf": summe,
        "bandbreitePct": bandbreite,
        "von_chf": round(summe * (1 - bandbreite / 100), 2),
        "bis_chf": round(summe * (1 + bandbreite / 100), 2),
        "gewerke": gewerke,
        "nextSteps": [
            f"Regel «{r['ruleId']}»: {r.get('hinweis', r['status'])} (Status: {r['status']})"
            for r in knapp
        ],
        "hinweis": "Kostenschätzung mit Bandbreite – KEINE Offerte. "
        "Preise: Sample-Mittelwerte, vor Verwendung verifizieren.",
    }


def gewerke_uebersicht(lv: dict[str, Any], bauzeitenplan: dict[str, Any]) -> dict[str, Any]:
    """MVP-Dokument «Gewerke-Übersicht»: je Gewerk Summe, Positionen, Zeitfenster."""
    fenster: dict[str, list[float]] = {}
    for z in bauzeitenplan["zeilen"]:
        for g in z["gewerke"]:
            von, bis = fenster.get(g, [float("inf"), 0.0])
            fenster[g] = [min(von, z["start_tag"]), max(bis, z["start_tag"] + z["dauer_tage"])]

    eintraege = []
    for gewerk, positionen in lv["gewerke"].items():
        eintraege.append(
            {
                "gewerk": gewerk,
                "anzahlPositionen": len(positionen),
                "summe_chf": round(sum(p["total_chf"] for p in positionen), 2),
                "aufwand_h": round(sum(p["aufwand_h"] for p in positionen), 1),
                "zeitfenster_arbeitstage": fenster.get(gewerk),
                "leistungen": [p["text"] for p in positionen],
            }
        )
    eintraege.sort(key=lambda e: -e["summe_chf"])
    return {
        "raumName": lv["raumName"],
        "gewerke": eintraege,
        "summe_chf": lv["summe_chf"],
        "hinweis": "Übersicht für die Handwerker-Koordination; Beträge = Schätzwerte.",
    }


def einkaufsliste(plan: dict[str, Any], catalog: list[dict[str, Any]]) -> dict[str, Any]:
    """MVP-Dokument «Material-/Einkaufsliste»: Katalog-Items mit Stückzahl + Preis."""
    by_id = {c["id"]: c for c in catalog}
    anzahl = Counter(p["catalogItemId"] for p in plan["placements"])
    zeilen = []
    for item_id, menge in anzahl.items():
        item = by_id[item_id]
        zeilen.append(
            {
                "artikel": item["name"],
                "funktionsTyp": item["funktionsTyp"],
                "menge": menge,
                "masse": item["masse"],
                "richtpreis_chf": item["preis"]["value"],
                "total_chf": round(menge * item["preis"]["value"], 2),
                "preisquelle": item["preis"]["quelle"],
            }
        )
    zeilen.sort(key=lambda z: -z["total_chf"])
    return {
        "zeilen": zeilen,
        "summe_chf": round(sum(z["total_chf"] for z in zeilen), 2),
        "hinweis": "Richtpreise (Schätzung) – konkrete Produkte/Händler frei wählbar.",
    }
