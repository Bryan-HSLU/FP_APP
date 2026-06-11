"""Stil-Engine: Swipes/Preset → Stilprofil (Stilprofil-Auswertung-Detailkonzept).

Zwei Wege (POC): A Swipen (Likes/Dislikes über getaggte Bilder) · B Preset per
Bild-Klick (kuratierter Achsen-Vektor, verfeinerbar). Reine Achsen, keine
benannten Stile (ADR-0006). Bilder sind raumtyp-gebunden.

v0-Aggregation (bewusst einfach, transparent): Achsenwert = Mittel der
Like-Tags − 0.5 × Mittel der Dislike-Tags, geklemmt auf [−1, 1]. Palette =
häufigste Farben der Likes. sampleSufficient ab 6 Bewertungen.
"""

import uuid
from collections import Counter
from typing import Any

MIN_STICHPROBE = 6


def _clamp(v: float) -> float:
    return max(-1.0, min(1.0, v))


def erzeuge_stilprofil(
    room_type: str,
    bilder: list[dict[str, Any]],
    likes: list[str],
    dislikes: list[str],
    preset_id: str | None,
    taxonomy_version: str,
) -> dict[str, Any]:
    """Bild-Bewertungen bzw. Preset → Stilprofil-Artefakt (Vertrag 3)."""
    by_id = {b["id"]: b for b in bilder}

    if preset_id is not None:
        preset = by_id[preset_id]
        vektor = dict(preset.get("presetProfile") or preset["achsenTags"])
        palette = list(preset["palette"])
        method = "preset"
    else:
        like_items = [by_id[i] for i in likes if i in by_id]
        dislike_items = [by_id[i] for i in dislikes if i in by_id]

        summen: dict[str, list[float]] = {}
        for item in like_items:
            for achse, wert in item["achsenTags"].items():
                summen.setdefault(achse, []).append(float(wert))
        abzug: dict[str, list[float]] = {}
        for item in dislike_items:
            for achse, wert in item["achsenTags"].items():
                abzug.setdefault(achse, []).append(float(wert))

        vektor = {}
        for achse in set(summen) | set(abzug):
            plus = sum(summen.get(achse, [])) / len(summen[achse]) if achse in summen else 0.0
            minus = sum(abzug.get(achse, [])) / len(abzug[achse]) if achse in abzug else 0.0
            vektor[achse] = round(_clamp(plus - 0.5 * minus), 3)

        farben = Counter(farbe for i in like_items for farbe in i["palette"])
        palette = [farbe for farbe, _ in farben.most_common(4)]
        method = "swipe"

    # Abgeleitete Anforderungen v0: markante Achsen (>0.5) als Hinweis-Tags.
    anforderungen = [
        f"{achse}:{'hoch' if wert > 0 else 'tief'}"
        for achse, wert in sorted(vektor.items())
        if abs(wert) >= 0.5
    ]

    profil: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "schemaVersion": "0.1.0",
        "taxonomyVersion": taxonomy_version,
        "styleVector": vektor,
        "derivedRequirements": anforderungen,
        "palette": palette,
        "meta": {
            "method": method,
            "roomType": room_type,
            "likes": len(likes),
            "dislikes": len(dislikes),
            "sampleSufficient": method == "preset" or len(likes) + len(dislikes) >= MIN_STICHPROBE,
        },
    }
    if preset_id is not None:
        profil["meta"]["presetId"] = preset_id
    return profil
