"""Prompt templates for Modul 3, Layer 1 (Claude -> directives)."""

from __future__ import annotations

import json

from fp.schemas import FurnitureCatalog, RoomModel, StyleProfile

SYSTEM_PROMPT = """\
Du bist der Planungs-Stratege von "Future Planning". Du bekommst (1) ein \
Nutzer-Stilprofil aus sechs parallelen Vektoren und (2) ein reales Raummodell. \
Deine Aufgabe ist NICHT, Koordinaten zu bestimmen, sondern eine gestalterische \
Entwurfslogik als strukturierte Vorgaben auszugeben. Ein nachgelagerter \
Constraint-Solver platziert die Objekte dann regelkonform.

Du gibst AUSSCHLIESSLICH ein einziges JSON-Objekt zurueck, das exakt diesem \
Schema entspricht:

{
  "room_type": <string>,
  "global_params": {
    "density": <0..1>,            // gewuenschte Moeblierungsdichte
    "symmetry": <0..1>,           // gewuenschter Symmetriegrad
    "focal_points": [{"type": "window"|"door"|"wall"|"center", "ref_id": <opening-id|null>}],
    "zoning": [{"name": <string>, "members": [<object-id>, ...]}]
  },
  "objects": [
    {"id": <eindeutige-id>, "catalog_id": <MUSS aus dem Katalog stammen>,
     "klass": "main"|"accessory", "priority": <int, 1=hoechste>,
     "quantity": <int>, "orientation_pref": "face_focal"|"against_wall"|"free"}
  ],
  "relations": [
    {"type": "facing", "a": <id>, "b": <id>},
    {"type": "near", "a": <id>, "b": <id>, "max_dist": <meter>},
    {"type": "on_top_footprint", "a": <id>, "b": <id>},   // a steht auf b (z.B. Tisch auf Teppich)
    {"type": "against_wall", "a": <id>, "wall_pref": "longest"|"shortest"|<wall-id>},
    {"type": "clear_in_front", "a": <id>, "depth": <meter>},
    {"type": "not_blocking", "opening": <opening-id>}
  ]
}

Regeln:
- Verwende NUR catalog_id-Werte aus dem bereitgestellten Katalog. Erfinde keine.
- Hauptobjekte (klass=main) zuerst und mit niedriger priority-Zahl; Ergaenzungen \
(Pflanzen, Teppiche, Leuchten) als accessory mit hoeherer Zahl.
- Leite Auswahl und Dichte aus dem Stilprofil ab (mehr "Dichte"/Fuelle -> mehr \
Ergaenzungsobjekte; ruhiger Stil -> weniger).
- Halte alle Tueren frei (not_blocking fuer jede Tuer).
- Gib KEINE Koordinaten, KEINEN Fliesstext, KEIN Markdown aus. Nur das JSON.
"""


def build_user_message(
    profile: StyleProfile, room: RoomModel, catalog: FurnitureCatalog
) -> str:
    cat = [
        {"id": it.id, "klass": it.klass, "dims_m": it.dims, "name": it.name}
        for it in catalog.items
    ]
    room_summary = {
        "room_type": room.room_type,
        "size_m": {
            "width": round(room.floor_bounds()[2] - room.floor_bounds()[0], 2),
            "length": round(room.floor_bounds()[3] - room.floor_bounds()[1], 2),
            "ceiling_height": room.ceiling_height,
            "floor_area_m2": round(room.floor_area(), 2),
        },
        "openings": [{"id": o.id, "kind": o.kind, "on_wall": o.on_wall} for o in room.openings],
        "walls": [w.id for w in room.walls],
        "fixpoints": [{"kind": f.kind, "position": f.position} for f in room.fixpoints],
    }
    profile_summary = {
        "swipe_count": profile.swipe_count,
        "style_axes": dict(zip(
            ("color_temperature", "brightness", "materiality", "form_language",
             "density", "epoch", "atmosphere", "color_intensity"),
            [round(v, 2) for v in profile.vectors.style_axes],
        )),
        "atmosphere_density": profile.vectors.atmosphere_density,
        "top_brands": profile.top_tags("brand_origin"),
        "top_design_elements": profile.top_tags("design_element"),
        "top_object_categories": profile.top_tags("object_category"),
        "top_accessories": profile.top_tags("accessory"),
    }
    return (
        "MOEBELKATALOG (nur diese catalog_id verwenden):\n"
        + json.dumps(cat, ensure_ascii=False)
        + "\n\nRAUMMODELL:\n"
        + json.dumps(room_summary, ensure_ascii=False)
        + "\n\nNUTZER-STILPROFIL:\n"
        + json.dumps(profile_summary, ensure_ascii=False)
        + "\n\nGib jetzt das Directives-JSON aus."
    )
