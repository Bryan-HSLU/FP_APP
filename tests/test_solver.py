"""Modul 3 - solver invariants on the fixture room (no native deps, no API)."""

import json
import math
from pathlib import Path

import pytest

from fp.m3_planning.llm import generate_directives_heuristic
from fp.m3_planning.solver import solve_layout
from fp.schemas import FurnitureCatalog, RoomModel, StyleProfile

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def room() -> RoomModel:
    return RoomModel.model_validate_json((ROOT / "tests/fixtures/room_fixture.json").read_text())


@pytest.fixture
def catalog() -> FurnitureCatalog:
    return FurnitureCatalog.model_validate_json((ROOT / "data/catalog/furniture.json").read_text())


@pytest.fixture
def profile() -> StyleProfile:
    from fp.schemas import SixStyleVectors

    return StyleProfile(session_id="t", swipe_count=10,
                        vectors=SixStyleVectors(style_axes=[0.5] * 8))


def _fp(o):
    w, h = o.dimensions[0], o.dimensions[1]
    sw, sd = (w, h) if round(o.rotation_z / (math.pi / 2)) % 2 == 0 else (h, w)
    cx, cy = o.position[0], o.position[1]
    return (cx - sw / 2, cy - sd / 2, cx + sw / 2, cy + sd / 2)


def _overlap_area(a, b):
    ox = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    oy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    return ox * oy


def test_solver_feasible_and_places_all(room, profile, catalog):
    directives = generate_directives_heuristic(profile, room, catalog)
    scene = solve_layout(room, directives, catalog)
    assert scene.solver_status in ("OPTIMAL", "FEASIBLE")
    assert len(scene.objects) == sum(o.quantity for o in directives.objects)


def test_no_solid_overlap(room, profile, catalog):
    directives = generate_directives_heuristic(profile, room, catalog)
    scene = solve_layout(room, directives, catalog)
    solid = [o for o in scene.objects if "rug" not in o.catalog_id]
    for i in range(len(solid)):
        for j in range(i + 1, len(solid)):
            assert _overlap_area(_fp(solid[i]), _fp(solid[j])) < 1e-6, (
                f"{solid[i].instance_id} overlaps {solid[j].instance_id}"
            )


def test_objects_in_bounds(room, profile, catalog):
    directives = generate_directives_heuristic(profile, room, catalog)
    scene = solve_layout(room, directives, catalog)
    ox, oy, mx, my = room.floor_bounds()
    for o in scene.objects:
        a = _fp(o)
        assert a[0] >= ox - 1e-6 and a[1] >= oy - 1e-6
        assert a[2] <= mx + 1e-6 and a[3] <= my + 1e-6


def test_doors_kept_clear(room, profile, catalog):
    directives = generate_directives_heuristic(profile, room, catalog)
    scene = solve_layout(room, directives, catalog)
    door = next(o for o in room.openings if o.kind == "door")
    xs = [p[0] for p in door.polygon]
    door_rect = (min(xs), 0.0, max(xs), 0.9)  # south-wall swing clearance
    for o in scene.objects:
        if "rug" in o.catalog_id:
            continue
        assert _overlap_area(_fp(o), door_rect) < 1e-6, f"{o.instance_id} blocks the door"


def test_rug_contains_table(room, profile, catalog):
    directives = generate_directives_heuristic(profile, room, catalog)
    scene = solve_layout(room, directives, catalog)
    by_id = {o.instance_id: o for o in scene.objects}
    if "rug_1" in by_id and "coffee_table_1" in by_id:
        rug, table = _fp(by_id["rug_1"]), _fp(by_id["coffee_table_1"])
        assert rug[0] <= table[0] + 1e-6 and rug[1] <= table[1] + 1e-6
        assert rug[2] >= table[2] - 1e-6 and rug[3] >= table[3] - 1e-6
