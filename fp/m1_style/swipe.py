"""Modul 1 - Stilanalyse: turn like/dislike swipes into six parallel vectors.

Each catalog image carries predefined tag data. Per swipe the six vectors are
updated independently (no single averaged profile):

  1. style_axes        - 8 continuous axes, like/dislike-weighted mean
  2. brand_origin      - categorical preference (tag scores)
  3. design_element    - categorical
  4. object_category   - categorical
  5. accessory         - categorical
  6. atmosphere_density - [fullness, liveliness], weighted mean

M1 only captures and structures. Interpretation happens in M3.
"""

from __future__ import annotations

import json
from pathlib import Path

from fp.schemas import STYLE_AXES, SixStyleVectors, StyleProfile, SwipeEvent

LIKE_W = 1.0
DISLIKE_W = -0.6

# vector field name -> key used in the image tag data
CAT_TAG_KEY = {
    "brand_origin": "brand",
    "design_element": "design_element",
    "object_category": "object_category",
    "accessory": "accessory",
}


def load_tags(path: str | Path) -> dict[str, dict]:
    return json.loads(Path(path).read_text())


class _Accumulator:
    def __init__(self) -> None:
        self.axes_sum = [0.0] * len(STYLE_AXES)
        self.axes_wsum = 0.0
        self.atmo_sum = [0.0, 0.0]
        self.atmo_wsum = 0.0
        self.cat: dict[str, dict[str, float]] = {
            "brand_origin": {},
            "design_element": {},
            "object_category": {},
            "accessory": {},
        }
        self.count = 0

    def add(self, tags: dict, liked: bool) -> None:
        w = LIKE_W if liked else DISLIKE_W
        self.count += 1
        axes = tags.get("axes", {})
        if axes:
            for i, name in enumerate(STYLE_AXES):
                self.axes_sum[i] += w * float(axes.get(name, 0.5))
            self.axes_wsum += abs(w)
        atmo = tags.get("atmosphere_density")
        if atmo:
            self.atmo_sum[0] += w * float(atmo[0])
            self.atmo_sum[1] += w * float(atmo[1])
            self.atmo_wsum += abs(w)
        for field in self.cat:
            for tag in tags.get(CAT_TAG_KEY[field], []):
                self.cat[field][tag] = self.cat[field].get(tag, 0.0) + w

    def vectors(self) -> SixStyleVectors:
        def axis_val(s: float) -> float:
            v = (s / self.axes_wsum) if self.axes_wsum else 0.5
            return round(min(1.0, max(0.0, v)), 4)

        axes = [axis_val(s) for s in self.axes_sum]
        atmo = (
            [round(min(1.0, max(0.0, c / self.atmo_wsum)), 4) for c in self.atmo_sum]
            if self.atmo_wsum
            else [0.5, 0.5]
        )

        def norm(d: dict[str, float]) -> dict[str, float]:
            # keep only net-positive preferences, scale to [0,1]
            pos = {k: v for k, v in d.items() if v > 0}
            if not pos:
                return {}
            mx = max(pos.values())
            return {k: round(v / mx, 4) for k, v in sorted(pos.items(), key=lambda kv: -kv[1])}

        return SixStyleVectors(
            style_axes=axes,
            brand_origin=norm(self.cat["brand_origin"]),
            design_element=norm(self.cat["design_element"]),
            object_category=norm(self.cat["object_category"]),
            accessory=norm(self.cat["accessory"]),
            atmosphere_density=atmo,
        )


def build_profile(
    swipes: list[SwipeEvent], tags: dict[str, dict], session_id: str = "session"
) -> StyleProfile:
    acc = _Accumulator()
    for sw in swipes:
        img_tags = tags.get(sw.image_id)
        if img_tags is None:
            continue
        acc.add(img_tags, sw.liked)
    return StyleProfile(session_id=session_id, swipe_count=acc.count, vectors=acc.vectors())


def load_swipes(path: str | Path) -> list[SwipeEvent]:
    data = json.loads(Path(path).read_text())
    return [SwipeEvent(**s) for s in data]
