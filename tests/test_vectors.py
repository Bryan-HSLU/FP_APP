"""Modul 1 - the six style vectors react correctly to like/dislike."""

from fp.m1_style.swipe import build_profile
from fp.schemas import STYLE_AXES, SwipeEvent

TAGS = {
    "bright_warm": {
        "axes": {a: 0.0 for a in STYLE_AXES} | {"brightness": 0.95, "color_temperature": 0.9},
        "atmosphere_density": [0.8, 0.7],
        "brand": ["scandi"], "design_element": ["wood"],
        "object_category": ["sofa"], "accessory": ["plant"],
    },
    "dark_cool": {
        "axes": {a: 1.0 for a in STYLE_AXES} | {"brightness": 0.05, "color_temperature": 0.1},
        "atmosphere_density": [0.2, 0.3],
        "brand": ["industrial"], "design_element": ["metal"],
        "object_category": ["shelf"], "accessory": ["lamp"],
    },
}


def _axis(profile, name):
    return profile.vectors.style_axes[STYLE_AXES.index(name)]


def test_like_raises_matching_axis():
    p = build_profile([SwipeEvent(image_id="bright_warm", liked=True)], TAGS)
    assert _axis(p, "brightness") > 0.8
    assert _axis(p, "color_temperature") > 0.8


def test_dislike_lowers_axis():
    liked = build_profile([SwipeEvent(image_id="bright_warm", liked=True)], TAGS)
    mixed = build_profile(
        [SwipeEvent(image_id="bright_warm", liked=True),
         SwipeEvent(image_id="dark_cool", liked=False)],
        TAGS,
    )
    # adding a disliked dark image must not raise brightness preference
    assert _axis(mixed, "brightness") <= _axis(liked, "brightness")


def test_categorical_preference_tracks_likes():
    p = build_profile(
        [SwipeEvent(image_id="bright_warm", liked=True),
         SwipeEvent(image_id="dark_cool", liked=False)],
        TAGS,
    )
    # liked brand should rank, disliked brand should be dropped (net negative)
    assert "scandi" in p.vectors.brand_origin
    assert "industrial" not in p.vectors.brand_origin
    assert p.swipe_count == 2
