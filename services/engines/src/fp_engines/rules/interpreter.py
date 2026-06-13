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


# --- Verkehrsweg-Freiraum (circulation) -------------------------------------
# Raster/Erosion-Analyse v0. Bewusst ganzzahlig gehalten (Grid-Indizes, BFS,
# Union-Find), damit TS & Python BIT-identisch urteilen – Float nur bei
# Zell-Mittelpunkten und der Schluss-Marge (identische Formeln/Reihenfolge).
_CIRC_CELL = 0.05  # Rasterweite (m). Läuft NICHT im Solver-Hot-Path (nur_hart), daher fein.
_CIRC_MAX_CELLS = 20000  # Schutz: riesige Räume vergröbern statt Speicher sprengen.
# Feste Nachbarschaftsreihenfolge – Determinismus/Parität (BFS-Erst-Treffer!).
_CIRC_NB: tuple[tuple[int, int], ...] = ((1, 0), (-1, 0), (0, 1), (0, -1))


def _eval_circulation(
    scene: Scene, params: Params, applies_to: str, offenders: list[str]
) -> float | None:
    """Gibt es einen durchgehenden Verkehrsweg ≥ minWidth (Detailkonzept/Norm-Regelsatz)?

    Deterministische Grid/Erosion-Analyse: Bodenraster → freie Zellen (im Raum,
    nicht unter BODENstehenden Objekten; Wandobjekte blockieren nicht, man läuft
    darunter durch) → Manhattan-Distanztransform als Engstellen-Mass → Bottleneck
    (breitester Korridor, der die Anker verbindet) via Union-Find über fallende
    Clearance-Schwellen. Anker = alle Türmünder; bei genau EINER Tür zusätzlich
    der offenste Punkt («kommt man von der Tür in den Raum?»). 0/1 Anker ⇒ keine
    Durchgangs-Anforderung (None → trivial erfüllt).

    Marge = 2·Bottleneck − minWidth (grob ±Raster). v0: keine Verursacher-
    Zuordnung (`offenders` bleibt leer); bodenstehende Objekte werden als
    achsparallele Bounding-Box genähert (konservativ, schnell, paritätssicher).
    """
    min_width = _num(params, "minWidth", 0.9)
    floor = scene.floor
    xs = [p[0] for p in floor]
    zs = [p[1] for p in floor]
    x0, x1 = min(xs), max(xs)
    z0, z1 = min(zs), max(zs)
    cell = _CIRC_CELL
    nx = int((x1 - x0) / cell) + 1
    nz = int((z1 - z0) / cell) + 1
    while nx * nz > _CIRC_MAX_CELLS:
        cell *= 2
        nx = int((x1 - x0) / cell) + 1
        nz = int((z1 - z0) / cell) + 1

    boxes: list[tuple[float, float, float, float]] = []
    for o in scene.objects:
        if o.mount == "wand":
            continue
        qx = [c[0] for c in o.quad]
        qz = [c[1] for c in o.quad]
        boxes.append((min(qx), max(qx), min(qz), max(qz)))

    def cx(i: int) -> float:
        return x0 + (i + 0.5) * cell

    def cz(j: int) -> float:
        return z0 + (j + 0.5) * cell

    free = [[False] * nz for _ in range(nx)]
    n_free = 0
    for i in range(nx):
        px = cx(i)
        for j in range(nz):
            pz = cz(j)
            if not point_in_polygon((px, pz), floor):
                continue
            blocked = False
            for xa, xb, za, zb in boxes:
                if xa <= px <= xb and za <= pz <= zb:
                    blocked = True
                    break
            if not blocked:
                free[i][j] = True
                n_free += 1
    if n_free == 0:
        return None

    inf = nx + nz + 1
    dist = [[0 if not free[i][j] else inf for j in range(nz)] for i in range(nx)]
    queue: list[tuple[int, int]] = [(i, j) for i in range(nx) for j in range(nz) if dist[i][j] == 0]
    head = 0
    while head < len(queue):
        i, j = queue[head]
        head += 1
        for di, dj in _CIRC_NB:
            ni, nj = i + di, j + dj
            if 0 <= ni < nx and 0 <= nj < nz and dist[ni][nj] > dist[i][j] + 1:
                dist[ni][nj] = dist[i][j] + 1
                queue.append((ni, nj))

    def cell_at(px: float, pz: float) -> tuple[int, int]:
        ci = int((px - x0) / cell)
        cj = int((pz - z0) / cell)
        ci = 0 if ci < 0 else (nx - 1 if ci > nx - 1 else ci)
        cj = 0 if cj < 0 else (nz - 1 if cj > nz - 1 else cj)
        return ci, cj

    def nearest_free(px: float, pz: float) -> tuple[int, int] | None:
        si, sj = cell_at(px, pz)
        if free[si][sj]:
            return (si, sj)
        seen = {(si, sj)}
        bfs: list[tuple[int, int]] = [(si, sj)]
        h = 0
        while h < len(bfs):
            i, j = bfs[h]
            h += 1
            for di, dj in _CIRC_NB:
                ni, nj = i + di, j + dj
                if 0 <= ni < nx and 0 <= nj < nz and (ni, nj) not in seen:
                    if free[ni][nj]:
                        return (ni, nj)
                    seen.add((ni, nj))
                    bfs.append((ni, nj))
        return None

    doors = [o for o in scene.openings if o["type"] == "door"]
    anchors: list[tuple[int, int]] = []
    for d in doors:
        wall = next((w for w in scene.walls if w["id"] == d["hostWall"]), None)
        if wall is None:
            continue
        sx, sz = wall["start"][0], wall["start"][1]
        ex, ez = wall["end"][0], wall["end"][1]
        wl = math.sqrt((ex - sx) ** 2 + (ez - sz) ** 2)
        if wl == 0:
            continue
        ux, uz = (ex - sx) / wl, (ez - sz) / wl
        mid = d["offset"] + d["width"] / 2
        mx, mz = sx + ux * mid, sz + uz * mid
        # 1.5 Zellen ins Rauminnere schieben (Seite via Polygon-Test bestimmen).
        for sgn in (1, -1):
            tx = mx + (-uz * sgn) * cell * 1.5
            tz = mz + (ux * sgn) * cell * 1.5
            if point_in_polygon((tx, tz), floor):
                a = nearest_free(tx, tz)
                if a is not None:
                    anchors.append(a)
                break
    if len(doors) == 1:
        best: tuple[int, int] | None = None
        best_c = -1
        for i in range(nx):
            for j in range(nz):
                if free[i][j] and dist[i][j] > best_c:
                    best_c = dist[i][j]
                    best = (i, j)
        if best is not None:
            anchors.append(best)
    if len(anchors) < 2:
        return None

    max_lvl = 0
    buckets: dict[int, list[tuple[int, int]]] = {}
    for i in range(nx):
        for j in range(nz):
            if free[i][j]:
                lvl = dist[i][j]
                buckets.setdefault(lvl, []).append((i, j))
                if lvl > max_lvl:
                    max_lvl = lvl
    parent: dict[tuple[int, int], tuple[int, int]] = {}

    def find(x: tuple[int, int]) -> tuple[int, int]:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    active: set[tuple[int, int]] = set()
    bottleneck = -1
    for lvl in range(max_lvl, -1, -1):
        for c in buckets.get(lvl, []):
            parent[c] = c
            active.add(c)
            for di, dj in _CIRC_NB:
                n = (c[0] + di, c[1] + dj)
                if n in active:
                    ra, rb = find(c), find(n)
                    if ra != rb:
                        parent[ra] = rb
        if all(a in active for a in anchors) and len({find(a) for a in anchors}) == 1:
            bottleneck = lvl
            break

    if bottleneck < 0:
        return -min_width
    return 2 * bottleneck * cell - min_width


Evaluator = Callable[[Scene, Params, str, list[str]], float | None]

# relation ist Solver-Scoring (soft) → ehrlich «nicht-geprueft» statt ok.
_EVALUATORS: dict[str, Evaluator | None] = {
    "collision": _eval_collision,
    "wall-distance": _eval_wall_distance,
    "object-distance": _eval_object_distance,
    "clearance": _eval_clearance,
    "door-swing": _eval_door_swing,
    "keep-clear": _eval_keep_clear,
    "host-binding": _eval_host_binding,
    "connection": _eval_connection,
    "circulation": _eval_circulation,
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
