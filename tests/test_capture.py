"""Modul 2 - synthetic reconstruction yields a usable room model (no native deps)."""

from fp.m2_capture.openings import detect_openings
from fp.m2_capture.structure import detect_structure
from fp.m2_capture.synthetic import generate_room_cloud


def test_structure_recovers_room_dimensions():
    pts = generate_room_cloud(w=4.0, l=5.0, h=2.6)
    room = detect_structure(pts)
    w = room.floor_polygon[1][0]
    l = room.floor_polygon[2][1]
    assert abs(w - 4.0) < 0.2
    assert abs(l - 5.0) < 0.2
    assert abs(room.ceiling_height - 2.6) < 0.2
    assert len(room.walls) == 4


def test_detects_one_door_and_one_window():
    pts = generate_room_cloud()
    room = detect_structure(pts)
    openings = detect_openings(pts, room)
    kinds = sorted(o.kind for o in openings)
    assert kinds == ["door", "window"], f"got {kinds}"


def test_door_on_south_window_on_north():
    pts = generate_room_cloud()
    room = detect_structure(pts)
    openings = detect_openings(pts, room)
    door = next(o for o in openings if o.kind == "door")
    window = next(o for o in openings if o.kind == "window")
    assert door.on_wall == "wall_south"
    assert window.on_wall == "wall_north"
