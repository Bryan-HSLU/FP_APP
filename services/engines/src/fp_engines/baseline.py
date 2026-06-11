"""Deterministische Kurator-Baseline («MVP-Baseline = deterministisches Scoring»).

Fallback-Pfad gemäss Gestaltungs-Engine-Prioritätsklassen: wählt OHNE LLM ein
Möbel-Set aus dem Katalog. v0-Heuristik: alle P1-Pflichttypen des Raumtyps,
P2/P3 dazu, solange sie grob in die Restfläche passen. Liefert denselben
Kurator-Response-Vertrag wie später das LLM (auswahl + relationaleAbsichten) –
der Solver sieht keinen Unterschied (austauschbare Schnittstelle, ADR-0007).
"""

from typing import Any

# Pflicht-Funktionskern je Raumtyp (P1, «je Funktion Pflicht»). Reihenfolge =
# Platzierungsreihenfolge im Solver (anschlussgebundenstes zuerst).
P1_PFLICHT: dict[str, list[str]] = {
    "bad": ["wc", "lavabo", "dusche"],
}

# Grobe Flächen-Daumenregel: Footprint + Bewegungsfläche je Objekt (m²),
# damit die Baseline in Kleinsträumen nicht mehr auswählt, als je passen kann.
_FLAECHE_FAKTOR = 2.5


def baseline_auswahl(room: dict[str, Any], catalog: list[dict[str, Any]]) -> dict[str, Any]:
    """Kurator-Response (Vertrag 7) ohne LLM – deterministisch, immer verfügbar."""
    room_type = room["roomType"]
    flaeche = room["shell"]["floor"].get("area") or 0.0
    passend = [c for c in catalog if room_type in c["roomTypes"]]

    auswahl: list[str] = []
    absichten: list[dict[str, Any]] = []
    budget_flaeche = flaeche

    def passt(item: dict[str, Any]) -> bool:
        bedarf = item["masse"]["w"] * item["masse"]["d"] * _FLAECHE_FAKTOR
        # Wandmontierte Kleinobjekte (Spiegel etc.) brauchen keine Bodenfläche.
        if item.get("mount") == "wand" and item["priorityClass"] != "P1":
            return True
        return bool(bedarf <= budget_flaeche)

    # P1: Pflichttypen in definierter Reihenfolge; was nicht passt, wird
    # ehrlich weggelassen (kleines Gäste-WC = Teilmenge, Norm-Regelsatz-v0).
    for ft in P1_PFLICHT.get(room_type, []):
        for item in passend:
            if item["funktionsTyp"] == ft and item["priorityClass"] == "P1":
                if passt(item):
                    auswahl.append(item["id"])
                    budget_flaeche -= item["masse"]["w"] * item["masse"]["d"] * _FLAECHE_FAKTOR
                break

    gewaehlte_typen = {c["funktionsTyp"] for c in passend if c["id"] in auswahl}

    # P2/P3: nur aufnehmen, wenn der relationale Anker überhaupt im Set ist.
    for item in passend:
        if item["priorityClass"] == "P1" or item["id"] in auswahl:
            continue
        anker_fehlt = False
        for rel in item.get("relationalRules", []):
            teile = rel.split(":")
            if teile[0] == "near" and teile[1] not in gewaehlte_typen:
                anker_fehlt = True
        if anker_fehlt or not passt(item):
            continue
        auswahl.append(item["id"])
        for rel in item.get("relationalRules", []):
            absichten.append({"itemId": item["id"], "relation": rel})

    return {
        "auswahl": auswahl,
        "relationaleAbsichten": absichten,
        "begruendung": "Deterministische Baseline (ohne LLM): P1-Pflichttypen "
        "plus passende P2/P3 nach Flächen-Daumenregel.",
    }
