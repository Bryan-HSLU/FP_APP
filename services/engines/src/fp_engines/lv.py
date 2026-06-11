"""LV-Ableitung: Plan-Trigger → Positionen (deklarativ, LV-Bauzeit-Detailkonzept).

Gleiche Philosophie wie der Norm-Regelsatz: der Positionskatalog
(data/positions/) ist Daten, nicht Code. Das LV erfindet keine Zahlen – Mengen
kommen aus Plan/Raum (Mengenermittlung); jede Position ist über `herkunft`
rückverfolgbar zum Auslöser im Plan.
"""

import re
from typing import Any

from fp_engines.auswertung import _wandflaeche


def _menge(
    template: dict[str, Any], anzahl: int, room: dict[str, Any], items: list[dict[str, Any]]
) -> float:
    """Mengenformel je mengeQuelle; faktor deckt z.B. 8 % Verschnitt ab."""
    quelle = template["mengeQuelle"]
    faktor = float(template["faktor"])
    if quelle == "stk":
        return anzahl * faktor
    if quelle == "pauschal":
        return faktor
    if quelle == "bodenflaeche":
        return round((room["shell"]["floor"].get("area") or 0.0) * faktor, 2)
    if quelle == "wandflaeche":
        return round(_wandflaeche(room) * faktor, 2)
    if quelle == "duschbereich":
        # v0-Näherung: Duschboden + 2 Wandseiten à 2.0 m Höhe je Dusche.
        m2 = sum(
            i["masse"]["w"] * i["masse"]["d"] + (i["masse"]["w"] + i["masse"]["d"]) * 2.0
            for i in items
        )
        return float(round(m2 * faktor, 2))
    raise ValueError(f"Unbekannte mengeQuelle: {quelle}")


def _matcht_placement(trigger: dict[str, Any], item: dict[str, Any]) -> bool:
    if "funktionsTyp" in trigger:
        if not re.fullmatch(trigger["funktionsTyp"], item["funktionsTyp"]):
            return False
    if "gewerk" in trigger and item["gewerk"] != trigger["gewerk"]:
        return False
    if "anschluss" in trigger:
        muster = trigger["anschluss"].split("|")
        if not any(a in muster for a in item.get("anschluesse", [])):
            return False
    return True


def erzeuge_lv(
    room: dict[str, Any],
    plan: dict[str, Any],
    catalog: list[dict[str, Any]],
    positionskatalog: list[dict[str, Any]],
) -> dict[str, Any]:
    """Plan → Leistungsverzeichnis (je Gewerk gruppiert, Positionen rückverfolgbar)."""
    by_id = {c["id"]: c for c in catalog}
    positionen: list[dict[str, Any]] = []

    for template in positionskatalog:
        trigger = template["trigger"]
        art = trigger["art"]
        herkunft: list[str] = []
        items: list[dict[str, Any]] = []

        if art == "projekt":
            herkunft = [f"projekt:{plan['id']}"]
            anzahl = 1
        elif art == "placement":
            gesehen: set[str] = set()
            for p in plan["placements"]:
                item = by_id[p["catalogItemId"]]
                if not _matcht_placement(trigger, item):
                    continue
                # einmalJe: z.B. EIN Anschlusspunkt je funktionsTyp, nicht je Stück.
                if trigger.get("einmalJe") == "funktionsTyp":
                    if item["funktionsTyp"] in gesehen:
                        continue
                    gesehen.add(item["funktionsTyp"])
                herkunft.append(f"placement:{p['id']}")
                items.append(item)
            anzahl = len(herkunft)
        elif art == "bestand":
            for o in room["objects"]:
                if re.fullmatch(trigger.get("label", ".*"), o["label"]):
                    herkunft.append(f"bestand:{o['id']}")
            anzahl = len(herkunft)
        elif art == "intervention":
            for iv in plan["interventions"]:
                if iv["kind"] == trigger["kind"]:
                    herkunft.append(f"intervention:{iv['id']}")
            anzahl = len(herkunft)
        elif art == "finish":
            for f in plan["finishes"]:
                if f["surface"].startswith(trigger["surface"]):
                    herkunft.append(f"finish:{f['surface']}")
            anzahl = len(herkunft)
        else:
            raise ValueError(f"Unbekannte Trigger-Art: {art}")

        if anzahl == 0:
            continue
        menge = _menge(template, anzahl, room, items)
        if menge <= 0:
            continue
        ep = template["einheitspreis"]
        positionen.append(
            {
                "posNr": template["posNr"],
                "gewerk": template["gewerk"],
                "phase": template["phase"],
                "text": template["text"],
                "menge": menge,
                "einheit": template["einheit"],
                "einheitspreis": ep,
                "total_chf": round(menge * ep["value"], 2),
                "aufwandswert_h": template["aufwandswert_h"],
                "aufwand_h": round(menge * template["aufwandswert_h"], 2),
                "npkRef": template.get("npkRef"),
                "herkunft": herkunft,
            }
        )

    positionen.sort(key=lambda p: p["posNr"])
    summe = round(sum(p["total_chf"] for p in positionen), 2)
    gewerke: dict[str, list[dict[str, Any]]] = {}
    for p in positionen:
        gewerke.setdefault(p["gewerk"], []).append(p)

    return {
        "raumName": room["name"],
        "planRef": plan["id"],
        "positionen": positionen,
        "gewerke": gewerke,
        "summe_chf": summe,
        "hinweis": "Vereinfachtes LV mit eigenen Positionen (NPK/CRB-mapping-fähig, "
        "npkRef vorgesehen). Preise = Schätzwerte mit Bandbreite, keine Offerte.",
    }
