"""Deklarativer Regel-Interpreter (Python-Seite, Solver/Server).

⚠️ PARITÄT: 1:1-Spiegel von packages/shared/src/rules/interpreter.ts.
Jede Änderung beidseitig + Fixtures aktualisieren (goldener Paritätstest).
Semantik (Ampel, Parameter-Konventionen): packages/shared/src/rules/README.md.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

from fp_engines.rules.geometry import (
    Quad,
    Vec2,
    containment_violation,
    dist_point_to_segment,
    front_dir,
    point_in_polygon,
    quad_distance,
    round_cm,
    separation,
)
from fp_engines.rules.scene import Scene, SceneObject

Params = dict[str, Any]


def _num(params: Params, key: str, fallback: float) -> float:
    v = params.get(key)
    return float(v) if isinstance(v, int | float) else fallback


def _str(params: Params, key: str, fallback: str) -> str:
    v = params.get(key)
    return v if isinstance(v, str) else fallback


def _effective_params(rule: dict[str, Any], norm_profile: str) -> Params:
    # Normprofil-Overlay: Profilwerte überschreiben die Basis (Norm-Regelsatz-v0).
    out: Params = dict(rule.get("params", {}))
    out.update(rule.get("profilOverrides", {}).get(norm_profile, {}))
    return out


def _matches(obj: SceneObject, applies_to: str) -> bool:
    return applies_to == "*" or obj.funktions_typ == applies_to


def _massive_walls(scene: Scene) -> list[dict[str, Any]]:
    return [w for w in scene.walls if w["kind"] == "massiv"]


def _threshold(scene: Scene) -> float:
    """Schwelle in Metern, unterhalb derer Beteiligte als «offenders» gelistet werden."""
    return scene.marge_cm / 100


def _front_zone(obj: SceneObject, depth: float, width: float) -> Quad:
    """Rechteck-Zone vor der Front eines Objekts (depth tief, width breit, anliegend)."""
    f = front_dir(obj.yaw_deg)
    rx = f[1]
    rz = -f[0]
    front_center = (obj.center[0] + f[0] * obj.d / 2, obj.center[1] + f[1] * obj.d / 2)
    hw = width / 2
    c1 = (front_center[0] - rx * hw, front_center[1] - rz * hw)
    c2 = (front_center[0] + rx * hw, front_center[1] + rz * hw)
    c3 = (c2[0] + f[0] * depth, c2[1] + f[1] * depth)
    c4 = (c1[0] + f[0] * depth, c1[1] + f[1] * depth)
    return (c1, c2, c3, c4)


def _opening_zone(scene: Scene, opening: dict[str, Any], depth: float) -> Quad | None:
    """Zone vor einer Öffnung, ins Rauminnere extrudiert (Seite via Polygon-Test)."""
    wall = next((w for w in scene.walls if w["id"] == opening["hostWall"]), None)
    if wall is None:
        return None
    dx = wall["end"][0] - wall["start"][0]
    dz = wall["end"][1] - wall["start"][1]
    length = math.sqrt(dx * dx + dz * dz)
    if length == 0:
        return None
    ux = dx / length
    uz = dz / length
    a: Vec2 = (
        wall["start"][0] + ux * opening["offset"],
        wall["start"][1] + uz * opening["offset"],
    )
    b: Vec2 = (a[0] + ux * opening["width"], a[1] + uz * opening["width"])
    for sgn in (1, -1):
        nx = -uz * sgn
        nz = ux * sgn
        quad: Quad = (
            a,
            b,
            (b[0] + nx * depth, b[1] + nz * depth),
            (a[0] + nx * depth, a[1] + nz * depth),
        )
        cx = (quad[0][0] + quad[2][0]) / 2
        cz = (quad[0][1] + quad[2][1]) / 2
        if point_in_polygon((cx, cz), scene.floor):
            return quad
    return None


def _zone_margin(
    scene: Scene,
    zone: Quad,
    exclude_ids: list[str],
    offenders: list[str],
    threshold_m: float,
    height_filter: Callable[[SceneObject], bool] | None = None,
) -> float | None:
    """Marge einer Zone: muss im Raum liegen und frei von anderen Objekten sein."""
    margin: float | None = None
    contain = containment_violation(zone, scene.floor)
    if contain < 0:
        margin = contain
    for o in scene.objects:
        if o.id in exclude_ids:
            continue
        if height_filter is not None and not height_filter(o):
            continue
        sep = separation(zone, o.quad)
        if margin is None or sep < margin:
            margin = sep
        if sep < threshold_m and o.is_placement and o.id not in offenders:
            offenders.append(o.id)
    return margin


def _vertikal_getrennt(a: SceneObject, b: SceneObject) -> bool:
    """Wandobjekte über Bodenobjekten (Spiegel über Lavabo) kollidieren nicht:
    Kollision nur, wenn sich die Höhenintervalle [unterkante, oberkante]
    überlappen (Berührung = getrennt)."""
    a_lo = a.mount_height or 0.0
    b_lo = b.mount_height or 0.0
    return a_lo + a.h <= b_lo or b_lo + b.h <= a_lo


def _eval_collision(
    scene: Scene, params: Params, applies_to: str, offenders: list[str]
) -> float | None:
    margin: float | None = None
    threshold_m = _threshold(scene)

    def track(value: float, ids: list[SceneObject]) -> None:
        nonlocal margin
        if margin is None or value < margin:
            margin = value
        if value < threshold_m:
            for o in ids:
                if o.is_placement and o.id not in offenders:
                    offenders.append(o.id)

    for o in scene.objects:
        contain = containment_violation(o.quad, scene.floor)
        if contain < 0:
            track(contain, [o])
    for i in range(len(scene.objects)):
        for j in range(i + 1, len(scene.objects)):
            a = scene.objects[i]
            b = scene.objects[j]
            if _vertikal_getrennt(a, b):
                continue
            track(separation(a.quad, b.quad), [a, b])
    return margin


def _eval_wall_distance(
    scene: Scene, params: Params, applies_to: str, offenders: list[str]
) -> float | None:
    min_dist = _num(params, "minDist", 0.0)
    margin: float | None = None
    for o in (x for x in scene.objects if _matches(x, applies_to)):
        dist = math.inf
        for w in _massive_walls(scene):
            d = dist_point_to_segment(o.center, tuple(w["start"]), tuple(w["end"]))
            if d < dist:
                dist = d
        if dist == math.inf:
            continue
        m = dist - min_dist
        if margin is None or m < margin:
            margin = m
        if m < _threshold(scene) and o.is_placement:
            offenders.append(o.id)
    return margin


def _eval_object_distance(
    scene: Scene, params: Params, applies_to: str, offenders: list[str]
) -> float | None:
    min_dist = _num(params, "minDist", 0.0)
    target = _str(params, "target", "*")
    measure = _str(params, "measure", "edge")
    margin: float | None = None
    for a in (x for x in scene.objects if _matches(x, applies_to)):
        for b in (x for x in scene.objects if _matches(x, target)):
            if a.id == b.id:
                continue
            if measure == "center":
                dist = math.sqrt(
                    (a.center[0] - b.center[0]) ** 2 + (a.center[1] - b.center[1]) ** 2
                )
            else:
                dist = quad_distance(a.quad, b.quad)
            m = dist - min_dist
            if margin is None or m < margin:
                margin = m
            if m < _threshold(scene):
                for o in (a, b):
                    if o.is_placement and o.id not in offenders:
                        offenders.append(o.id)
    return margin


def _eval_clearance(
    scene: Scene, params: Params, applies_to: str, offenders: list[str]
) -> float | None:
    depth = _num(params, "depth", 0.6)
    margin: float | None = None
    for o in (x for x in scene.objects if _matches(x, applies_to)):
        width = _num(params, "width", o.w)
        zone = _front_zone(o, depth, width)
        m = _zone_margin(scene, zone, [o.id], offenders, _threshold(scene))
        if m is not None and (margin is None or m < margin):
            margin = m
        if m is not None and m < _threshold(scene) and o.is_placement and o.id not in offenders:
            offenders.append(o.id)
    return margin


def _eval_door_swing(
    scene: Scene, params: Params, applies_to: str, offenders: list[str]
) -> float | None:
    radius = _num(params, "radius", 0.9)
    margin: float | None = None
    for opening in (o for o in scene.openings if o["type"] == "door"):
        # v0-Näherung: Rechteck Türbreite × radius statt Viertelkreis (konservativ,
        # identisch einfach in TS & Python). Echte Schwenkrichtung kommt mit M3.
        zone = _opening_zone(scene, opening, radius)
        if zone is None:
            continue
        m = _zone_margin(scene, zone, [], offenders, _threshold(scene))
        if m is not None and (margin is None or m < margin):
            margin = m
    return margin


def _eval_keep_clear(
    scene: Scene, params: Params, applies_to: str, offenders: list[str]
) -> float | None:
    depth = _num(params, "depth", 0.3)
    max_h = _num(params, "maxObjektHoehe", 0.9)
    margin: float | None = None
    for opening in (o for o in scene.openings if o["type"] == "window"):
        zone = _opening_zone(scene, opening, depth)
        if zone is None:
            continue
        # Nur hohe Objekte verstellen ein Fenster: Gesamthöhe = Montagehöhe + Korpus.
        m = _zone_margin(
            scene,
            zone,
            [],
            offenders,
            _threshold(scene),
            lambda o: (o.mount_height or 0.0) + o.h > max_h,
        )
        if m is not None and (margin is None or m < margin):
            margin = m
    return margin


def _eval_host_binding(
    scene: Scene, params: Params, applies_to: str, offenders: list[str]
) -> float | None:
    mount = _str(params, "mount", "boden")
    margin: float | None = None
    for o in (x for x in scene.objects if _matches(x, applies_to)):
        m: float | None = None
        if mount == "wand":
            dist = math.inf
            for w in _massive_walls(scene):
                d = math.inf
                for i in range(4):
                    dd = dist_point_to_segment(o.quad[i], tuple(w["start"]), tuple(w["end"]))
                    if dd < d:
                        d = dd
                if d < dist:
                    dist = d
            max_gap = _num(params, "maxWandabstand", 0.05)
            m = -max_gap if dist == math.inf else max_gap - dist
        # Höhenfenster (z.B. Lavabo-Oberkante 0.85–0.95): mountHeight = UNTERKANTE
        # über Boden (Plan-Schema) → geprüfte Oberkante = mountHeight + Korpushöhe.
        min_h = params.get("minHoehe")
        max_h = params.get("maxHoehe")
        if isinstance(min_h, int | float) and isinstance(max_h, int | float):
            hk = o.mount_height
            hm = (
                -float(min_h)
                if hk is None
                else min(hk + o.h - float(min_h), float(max_h) - (hk + o.h))
            )
            m = hm if m is None else min(m, hm)
        if m is not None:
            if margin is None or m < margin:
                margin = m
            if m < _threshold(scene) and o.is_placement:
                offenders.append(o.id)
    return margin


def _eval_connection(
    scene: Scene, params: Params, applies_to: str, offenders: list[str]
) -> float | None:
    typ = _str(params, "anschluss", "wasser")
    max_dist = _num(params, "maxDist", 1.0)
    margin: float | None = None
    for o in (x for x in scene.objects if _matches(x, applies_to)):
        dist = math.inf
        for fp in (f for f in scene.fixpoints if f["type"] == typ):
            pos: Vec2 = (fp["position"][0], fp["position"][1])
            # Punkt-zu-Footprint: 0, wenn der Fixpunkt im/auf dem Footprint liegt.
            if point_in_polygon(pos, list(o.quad)):
                d = 0.0
            else:
                d = math.inf
                for i in range(4):
                    dd = dist_point_to_segment(pos, o.quad[i], o.quad[(i + 1) % 4])
                    if dd < d:
                        d = dd
            if d < dist:
                dist = d
        m = -max_dist if dist == math.inf else max_dist - dist
        if margin is None or m < margin:
            margin = m
        if m < _threshold(scene) and o.is_placement:
            offenders.append(o.id)
    return margin


Evaluator = Callable[[Scene, Params, str, list[str]], float | None]

# Verkehrsweg (circulation) braucht Freiraum-Analyse (Grid/Erosion) → kommt mit
# M3 (Solver); relation ist Solver-Scoring. Ehrlich «nicht-geprueft» statt ok.
_EVALUATORS: dict[str, Evaluator | None] = {
    "collision": _eval_collision,
    "wall-distance": _eval_wall_distance,
    "object-distance": _eval_object_distance,
    "clearance": _eval_clearance,
    "door-swing": _eval_door_swing,
    "keep-clear": _eval_keep_clear,
    "host-binding": _eval_host_binding,
    "connection": _eval_connection,
    "circulation": None,
    "relation": None,
}


def evaluate_rules(scene: Scene, rules: list[dict[str, Any]]) -> dict[str, Any]:
    """Wertet Regeln gegen die Szene aus und liefert den constraintReport (Plan-Schema)."""
    results: list[dict[str, Any]] = []

    for rule in rules:
        if rule["roomType"] not in ("alle", scene.room_type):
            continue
        if "normProfile" in rule and rule["normProfile"] != scene.norm_profile:
            continue

        if rule["type"] not in _EVALUATORS:
            raise ValueError(f"Unbekannter Regel-Typ: {rule['type']}")
        evaluator = _EVALUATORS[rule["type"]]

        if evaluator is None:
            result: dict[str, Any] = {
                "ruleId": rule["id"],
                "status": "nicht-geprueft",
                "margin_cm": None,
                "placements": [],
            }
            if "hinweis" in rule:
                result["hinweis"] = rule["hinweis"]
            results.append(result)
            continue

        offenders: list[str] = []
        margin_m = evaluator(
            scene, _effective_params(rule, scene.norm_profile), rule["appliesTo"], offenders
        )

        margin_cm: float | None = None
        if margin_m is None:
            status = "ok"  # Regel hat keine anwendbaren Objekte → trivial erfüllt.
        else:
            margin_cm = round_cm(margin_m)
            if margin_cm < 0:
                status = "verletzt"
            elif margin_cm < scene.marge_cm:
                status = "knapp"
            else:
                status = "ok"

        result = {
            "ruleId": rule["id"],
            "status": status,
            "margin_cm": margin_cm,
            "placements": [] if status == "ok" else offenders,
        }
        if "hinweis" in rule:
            result["hinweis"] = rule["hinweis"]
        results.append(result)

    hard_ids = {r["id"] for r in rules if r["severity"] == "hard"}
    summary = {"erfuellt": 0, "knapp": 0, "verletzt": 0}
    for r in results:
        if r["ruleId"] not in hard_ids:
            continue
        if r["status"] == "ok":
            summary["erfuellt"] += 1
        elif r["status"] == "knapp":
            summary["knapp"] += 1
        elif r["status"] == "verletzt":
            summary["verletzt"] += 1

    return {
        "hard": {"ok": summary["verletzt"] == 0, "summary": summary},
        "results": results,
        "softScore": {"stil": 0.0, "ergonomie": 0.0, "relation": 0.0},
    }
