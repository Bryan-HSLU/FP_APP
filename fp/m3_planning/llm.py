"""Modul 3, Layer 1 - turn the style profile + room into AI directives.

Primary path: Claude generates the directives (the required "AI in the loop").
Fallback path: a deterministic heuristic so the pipeline still runs end-to-end
without an API key (clearly flagged). The fallback is NOT a substitute for the
AI - it only exists so the solver/visualisation can be demonstrated offline.
"""

from __future__ import annotations

import json
import os

from pydantic import ValidationError

from fp.m3_planning.prompts import SYSTEM_PROMPT, build_user_message
from fp.schemas import (
    Directives,
    DirectiveObject,
    FurnitureCatalog,
    GlobalParams,
    FocalPoint,
    Relation,
    RelationType,
    RoomModel,
    StyleProfile,
    Zone,
)

DEFAULT_MODEL = "claude-sonnet-4-6"


def _validate(raw: str, valid_ids: set[str]) -> Directives:
    data = json.loads(raw)
    directives = Directives.model_validate(data)
    bad = [o.catalog_id for o in directives.objects if o.catalog_id not in valid_ids]
    if bad:
        raise ValueError(f"unknown catalog_id(s): {bad}")
    return directives


def generate_directives_llm(
    profile: StyleProfile,
    room: RoomModel,
    catalog: FurnitureCatalog,
    *,
    model: str = DEFAULT_MODEL,
    api_key: str | None = None,
) -> Directives:
    import anthropic

    client = anthropic.Anthropic(api_key=api_key or os.environ.get("ANTHROPIC_API_KEY"))
    valid_ids = set(catalog.by_id())
    user_msg = build_user_message(profile, room, catalog)

    def _call(extra: str = "") -> str:
        resp = client.messages.create(
            model=model,
            max_tokens=2000,
            system=[{"type": "text", "text": SYSTEM_PROMPT,
                     "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": user_msg + extra}],
        )
        return "".join(b.text for b in resp.content if b.type == "text").strip()

    raw = _call()
    try:
        return _validate(raw, valid_ids)
    except (ValidationError, ValueError, json.JSONDecodeError) as exc:
        # one repair retry with the error fed back
        raw = _call(f"\n\nDein letzter Output war ungueltig: {exc}\n"
                    f"Gib NUR korrektes JSON gemaess Schema zurueck.")
        return _validate(raw, valid_ids)


def generate_directives_heuristic(
    profile: StyleProfile, room: RoomModel, catalog: FurnitureCatalog
) -> Directives:
    """Deterministic offline fallback (no AI). Picks a sensible living-room set."""
    ids = set(catalog.by_id())
    density = float(profile.vectors.atmosphere_density[0]) if profile.vectors.atmosphere_density else 0.5
    door = next((o.id for o in room.openings if o.kind == "door"), None)
    window = next((o.id for o in room.openings if o.kind == "window"), None)

    objs: list[DirectiveObject] = []
    rels: list[Relation] = []

    def add(oid, cid, klass, prio, q=1, orient="free"):
        if cid in ids:
            objs.append(DirectiveObject(id=oid, catalog_id=cid, klass=klass,
                                        priority=prio, quantity=q, orientation_pref=orient))

    add("sofa_1", "sofa_3seat", "main", 1, orient="face_focal")
    add("coffee_table_1", "coffee_table", "main", 2)
    add("tv_unit_1", "tv_unit", "main", 3, orient="against_wall")
    add("rug_1", "rug_large", "accessory", 5)
    add("plant_1", "floor_plant", "accessory", 6, q=1 if density < 0.6 else 2)
    add("lamp_1", "floor_lamp", "accessory", 7)

    rels.append(Relation(type=RelationType.facing, a="sofa_1", b="tv_unit_1"))
    rels.append(Relation(type=RelationType.near, a="coffee_table_1", b="sofa_1", max_dist=0.7))
    rels.append(Relation(type=RelationType.on_top_footprint, a="coffee_table_1", b="rug_1"))
    rels.append(Relation(type=RelationType.against_wall, a="sofa_1", wall_pref="longest"))
    rels.append(Relation(type=RelationType.against_wall, a="tv_unit_1", wall_pref="longest"))
    rels.append(Relation(type=RelationType.near, a="lamp_1", b="sofa_1", max_dist=1.0))
    if door:
        rels.append(Relation(type=RelationType.not_blocking, opening=door))

    focal = [FocalPoint(type="window", ref_id=window)] if window else [FocalPoint(type="center")]
    return Directives(
        room_type=room.room_type,
        global_params=GlobalParams(
            density=round(min(0.7, max(0.3, density)), 2),
            symmetry=round(float(profile.vectors.style_axes[3]), 2) if profile.vectors.style_axes else 0.5,
            focal_points=focal,
            zoning=[Zone(name="seating", members=["sofa_1", "coffee_table_1", "rug_1"])],
        ),
        objects=objs,
        relations=rels,
    )


def generate_directives(
    profile: StyleProfile,
    room: RoomModel,
    catalog: FurnitureCatalog,
    *,
    use_llm: bool | None = None,
) -> tuple[Directives, str]:
    """Returns (directives, source) where source is 'llm' or 'heuristic'."""
    has_key = bool(os.environ.get("ANTHROPIC_API_KEY"))
    if use_llm is None:
        use_llm = has_key
    if use_llm and has_key:
        return generate_directives_llm(profile, room, catalog), "llm"
    return generate_directives_heuristic(profile, room, catalog), "heuristic"
