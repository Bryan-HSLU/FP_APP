"""Parser der weichen Relations-Grammatik (fp_engines.relationen).

Kernzusicherung: gültige Strings → typisierte Relation; alles Kaputte/Unbekannte
→ None (nie eine Exception), damit die weiche Ebene einen Plan nie scheitern lässt.
"""

import math

from fp_engines.relationen import (
    AgainstWall,
    Corner,
    Facing,
    Group,
    Near,
    Opposite,
    PairWith,
    parse_relation,
    parse_relationen,
)


def test_near_mit_und_ohne_distanz() -> None:
    assert parse_relation("near:sofa:1.3") == Near("sofa", 1.3)
    assert parse_relation("near:sofa") == Near("sofa", math.inf)


def test_flags_ohne_argument() -> None:
    assert parse_relation("against-wall") == AgainstWall()
    assert parse_relation("corner") == Corner()


def test_gerichtete_und_gruppen_relationen() -> None:
    assert parse_relation("facing:tvmoebel") == Facing("tvmoebel")
    assert parse_relation("opposite:sofa") == Opposite("sofa")
    assert parse_relation("group:sitzgruppe") == Group("sitzgruppe")
    assert parse_relation("pair-with:abc-123") == PairWith("abc-123")


def test_unbekannt_oder_kaputt_gibt_none() -> None:
    assert parse_relation("foo:bar") is None
    assert parse_relation("near") is None  # funktionsTyp fehlt
    assert parse_relation("near:sofa:xxx") is None  # kaputte Distanz
    assert parse_relation("facing") is None  # Argument fehlt
    assert parse_relation("group:") is None  # leere groupId
    assert parse_relation("") is None
    assert parse_relation("   ") is None
    assert parse_relation(None) is None
    assert parse_relation(42) is None


def test_whitespace_wird_toleriert() -> None:
    assert parse_relation("  near:sofa:1.0  ") == Near("sofa", 1.0)


def test_parse_relationen_filtert_kaputte_weg() -> None:
    roh = ["near:sofa:1.3", "kaputt", "corner", "group:", "against-wall"]
    assert parse_relationen(roh) == [Near("sofa", 1.3), Corner(), AgainstWall()]
