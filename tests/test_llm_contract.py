"""Modul 3, Layer 1 - directives schema validation + AI mocking."""

import json
from pathlib import Path

import pytest

from fp.m3_planning import llm
from fp.m3_planning.llm import (
    _validate,
    generate_directives,
    generate_directives_heuristic,
)
from fp.schemas import FurnitureCatalog, RoomModel, SixStyleVectors, StyleProfile

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def room() -> RoomModel:
    return RoomModel.model_validate_json((ROOT / "tests/fixtures/room_fixture.json").read_text())


@pytest.fixture
def catalog() -> FurnitureCatalog:
    return FurnitureCatalog.model_validate_json((ROOT / "data/catalog/furniture.json").read_text())


@pytest.fixture
def profile() -> StyleProfile:
    return StyleProfile(session_id="t", swipe_count=5, vectors=SixStyleVectors(style_axes=[0.5] * 8))


def test_validate_accepts_known_ids(catalog):
    raw = json.dumps({
        "room_type": "living_room",
        "objects": [{"id": "s1", "catalog_id": "sofa_3seat", "klass": "main", "priority": 1}],
        "relations": [],
    })
    d = _validate(raw, set(catalog.by_id()))
    assert d.objects[0].catalog_id == "sofa_3seat"


def test_validate_rejects_unknown_id(catalog):
    raw = json.dumps({
        "objects": [{"id": "x", "catalog_id": "flying_carpet", "klass": "main", "priority": 1}],
        "relations": [],
    })
    with pytest.raises(ValueError, match="unknown catalog_id"):
        _validate(raw, set(catalog.by_id()))


def test_heuristic_is_valid_and_uses_catalog(room, profile, catalog):
    d = generate_directives_heuristic(profile, room, catalog)
    ids = set(catalog.by_id())
    assert d.objects, "heuristic produced no objects"
    assert all(o.catalog_id in ids for o in d.objects)


def test_generate_falls_back_without_key(room, profile, catalog, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    directives, source = generate_directives(profile, room, catalog)
    assert source == "heuristic"
    assert directives.objects


def test_generate_llm_path_mocked(room, profile, catalog, monkeypatch):
    """The Claude path validates and returns directives when the API responds."""
    payload = json.dumps({
        "room_type": "living_room",
        "global_params": {"density": 0.5, "symmetry": 0.5},
        "objects": [{"id": "sofa_1", "catalog_id": "sofa_3seat", "klass": "main", "priority": 1}],
        "relations": [{"type": "not_blocking", "opening": "opening_door_1"}],
    })

    class _Block:
        type = "text"
        text = payload

    class _Resp:
        content = [_Block()]

    class _Messages:
        def create(self, **_):
            return _Resp()

    class _Client:
        def __init__(self, *a, **k):
            self.messages = _Messages()

    monkeypatch.setattr(llm.anthropic if hasattr(llm, "anthropic") else __import__("anthropic"),
                        "Anthropic", _Client, raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    directives, source = generate_directives(profile, room, catalog, use_llm=True)
    assert source == "llm"
    assert directives.objects[0].catalog_id == "sofa_3seat"
