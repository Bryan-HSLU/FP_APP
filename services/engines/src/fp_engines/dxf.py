"""2D-Grundriss als DXF (ezdxf) – Auswertung-Bauvorhaben: PDF+DXF im POC.

Koordinaten-Mapping laut Schema-Spezifikation: Grundriss liegt in der
x/z-Ebene (y-up) → DXF (x, y) = (x, z). Layer: WAENDE, OEFFNUNGEN, MOEBEL,
BESCHRIFTUNG. DWG kommt später (ODA-Konverter, bewusst nicht POC).
"""

import math
from io import StringIO
from typing import Any

import ezdxf

from fp_engines.rules.geometry import footprint


def grundriss_dxf(room: dict[str, Any], plan: dict[str, Any], catalog: list[dict[str, Any]]) -> str:
    by_id = {c["id"]: c for c in catalog}
    doc = ezdxf.new("R2010", setup=True)  # type: ignore[attr-defined]
    doc.layers.add("WAENDE", color=7)
    doc.layers.add("OEFFNUNGEN", color=3)
    doc.layers.add("MOEBEL", color=5)
    doc.layers.add("BESCHRIFTUNG", color=8)
    msp = doc.modelspace()

    for w in room["shell"]["walls"]:
        msp.add_line(tuple(w["start"]), tuple(w["end"]), dxfattribs={"layer": "WAENDE"})

    for o in room["openings"]:
        wall = next(w for w in room["shell"]["walls"] if w["id"] == o["hostWall"])
        sx, sz = wall["start"]
        ex, ez = wall["end"]
        laenge = math.hypot(ex - sx, ez - sz)
        ux, uz = (ex - sx) / laenge, (ez - sz) / laenge
        a = (sx + ux * o["offset"], sz + uz * o["offset"])
        b = (a[0] + ux * o["width"], a[1] + uz * o["width"])
        msp.add_line(a, b, dxfattribs={"layer": "OEFFNUNGEN"})
        msp.add_text(
            "TUER" if o["type"] == "door" else "FENSTER",
            dxfattribs={"layer": "BESCHRIFTUNG", "height": 0.08},
        ).set_placement(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2))

    for p in plan["placements"]:
        item = by_id[p["catalogItemId"]]
        quad = footprint(
            (p["pose"]["pos"][0], p["pose"]["pos"][1]),
            item["masse"]["w"],
            item["masse"]["d"],
            p["pose"]["yawDeg"],
        )
        msp.add_lwpolyline([*quad, quad[0]], dxfattribs={"layer": "MOEBEL"})
        msp.add_text(
            item["funktionsTyp"].upper(), dxfattribs={"layer": "BESCHRIFTUNG", "height": 0.1}
        ).set_placement(tuple(p["pose"]["pos"]))

    out = StringIO()
    doc.write(out)
    return out.getvalue()
