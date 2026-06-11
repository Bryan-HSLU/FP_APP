"""2D-Geometrie für den Regel-Interpreter (Grundriss x/z, Meter).

⚠️ PARITÄT: 1:1-Spiegel von packages/shared/src/rules/geometry.ts.
Jede Änderung hier MUSS dort identisch nachgezogen werden – der Paritätstest
über die goldenen Fixtures erzwingt das. Gleiche Formeln, gleiche Reihenfolge
der Operationen (IEEE-754-Determinismus).
"""

from __future__ import annotations

import math

Vec2 = tuple[float, float]
Quad = tuple[Vec2, Vec2, Vec2, Vec2]


def cos_deg(deg: float) -> float:
    """cos in Grad; Vielfache von 90° exakt (vermeidet Float-Rauschen libm-übergreifend)."""
    n = ((deg % 360) + 360) % 360
    if n == 0:
        return 1.0
    if n == 90:
        return 0.0
    if n == 180:
        return -1.0
    if n == 270:
        return 0.0
    return math.cos(deg * math.pi / 180)


def sin_deg(deg: float) -> float:
    n = ((deg % 360) + 360) % 360
    if n == 0:
        return 0.0
    if n == 90:
        return 1.0
    if n == 180:
        return 0.0
    if n == 270:
        return -1.0
    return math.sin(deg * math.pi / 180)


def rotate_y(v: Vec2, yaw_deg: float) -> Vec2:
    """Rotation um y (y-up, rechtshändig): (x,z) → (x·cos + z·sin, −x·sin + z·cos)."""
    c = cos_deg(yaw_deg)
    s = sin_deg(yaw_deg)
    return (v[0] * c + v[1] * s, -v[0] * s + v[1] * c)


def front_dir(yaw_deg: float) -> Vec2:
    """Blickrichtung der «Front» eines Objekts: lokal +z, rotiert um yaw."""
    return rotate_y((0.0, 1.0), yaw_deg)


def footprint(center: Vec2, w: float, d: float, yaw_deg: float) -> Quad:
    """Footprint-Ecken: Breite w lokal entlang x, Tiefe d lokal entlang z."""
    hw = w / 2
    hd = d / 2
    local = ((-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd))
    out = []
    for p in local:
        r = rotate_y(p, yaw_deg)
        out.append((center[0] + r[0], center[1] + r[1]))
    return (out[0], out[1], out[2], out[3])


def rect_quad(x_min: float, z_min: float, x_max: float, z_max: float) -> Quad:
    return ((x_min, z_min), (x_max, z_min), (x_max, z_max), (x_min, z_max))


def dist_point_to_segment(p: Vec2, a: Vec2, b: Vec2) -> float:
    abx = b[0] - a[0]
    abz = b[1] - a[1]
    apx = p[0] - a[0]
    apz = p[1] - a[1]
    len2 = abx * abx + abz * abz
    t = 0.0 if len2 == 0 else (apx * abx + apz * abz) / len2
    if t < 0:
        t = 0.0
    if t > 1:
        t = 1.0
    dx = p[0] - (a[0] + t * abx)
    dz = p[1] - (a[1] + t * abz)
    return math.sqrt(dx * dx + dz * dz)


def _cross(o: Vec2, a: Vec2, b: Vec2) -> float:
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])


def _on_seg(o1: Vec2, o2: Vec2, p: Vec2) -> bool:
    return min(o1[0], o2[0]) <= p[0] <= max(o1[0], o2[0]) and min(o1[1], o2[1]) <= p[1] <= max(
        o1[1], o2[1]
    )


def segments_intersect(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2) -> bool:
    d1 = _cross(b1, b2, a1)
    d2 = _cross(b1, b2, a2)
    d3 = _cross(a1, a2, b1)
    d4 = _cross(a1, a2, b2)
    if ((d1 > 0 and d2 < 0) or (d1 < 0 and d2 > 0)) and (
        (d3 > 0 and d4 < 0) or (d3 < 0 and d4 > 0)
    ):
        return True
    if d1 == 0 and _on_seg(b1, b2, a1):
        return True
    if d2 == 0 and _on_seg(b1, b2, a2):
        return True
    if d3 == 0 and _on_seg(a1, a2, b1):
        return True
    if d4 == 0 and _on_seg(a1, a2, b2):
        return True
    return False


def dist_segment_to_segment(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2) -> float:
    if segments_intersect(a1, a2, b1, b2):
        return 0.0
    return min(
        dist_point_to_segment(a1, b1, b2),
        dist_point_to_segment(a2, b1, b2),
        dist_point_to_segment(b1, a1, a2),
        dist_point_to_segment(b2, a1, a2),
    )


def dist_point_to_polygon_boundary(p: Vec2, poly: list[Vec2]) -> float:
    best = math.inf
    for i in range(len(poly)):
        a = poly[i]
        b = poly[(i + 1) % len(poly)]
        d = dist_point_to_segment(p, a, b)
        if d < best:
            best = d
    return best


def point_in_polygon(p: Vec2, poly: list[Vec2]) -> bool:
    """Punkt im (einfachen) Polygon; Punkte AUF dem Rand zählen als innen."""
    if dist_point_to_polygon_boundary(p, poly) < 1e-9:
        return True
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        pi = poly[i]
        pj = poly[j]
        if (pi[1] > p[1]) != (pj[1] > p[1]) and p[0] < (pj[0] - pi[0]) * (p[1] - pi[1]) / (
            pj[1] - pi[1]
        ) + pi[0]:
            inside = not inside
        j = i
    return inside


def overlap_depth(a: Quad, b: Quad) -> float | None:
    """SAT-Überlappungstiefe zweier konvexer Quads; None wenn getrennt/berührend."""
    min_overlap = math.inf
    for quad in (a, b):
        for i in range(4):
            p1 = quad[i]
            p2 = quad[(i + 1) % 4]
            ex = p2[0] - p1[0]
            ez = p2[1] - p1[1]
            length = math.sqrt(ex * ex + ez * ez)
            if length == 0:
                continue
            nx = -ez / length
            nz = ex / length
            a_min = math.inf
            a_max = -math.inf
            for p in a:
                proj = p[0] * nx + p[1] * nz
                if proj < a_min:
                    a_min = proj
                if proj > a_max:
                    a_max = proj
            b_min = math.inf
            b_max = -math.inf
            for p in b:
                proj = p[0] * nx + p[1] * nz
                if proj < b_min:
                    b_min = proj
                if proj > b_max:
                    b_max = proj
            overlap = min(a_max, b_max) - max(a_min, b_min)
            if overlap <= 0:
                return None
            if overlap < min_overlap:
                min_overlap = overlap
    return min_overlap


def quad_distance(a: Quad, b: Quad) -> float:
    """Echte Mindestdistanz zweier konvexer Quads (0 bei Berührung/Überlappung)."""
    if overlap_depth(a, b) is not None:
        return 0.0
    best = math.inf
    for i in range(4):
        for j in range(4):
            d = dist_segment_to_segment(a[i], a[(i + 1) % 4], b[j], b[(j + 1) % 4])
            if d < best:
                best = d
    return best


def separation(a: Quad, b: Quad) -> float:
    """Trennung als Marge: positiv = Abstand, negativ = Überlappungstiefe, 0 = Berührung."""
    depth = overlap_depth(a, b)
    if depth is not None:
        return -depth
    return quad_distance(a, b)


def containment_violation(quad: Quad, poly: list[Vec2]) -> float:
    """0 = vollständig innen (Berührung erlaubt), sonst −max. Austrittstiefe der Ecken.

    v0: Ecken-Heuristik – reicht für Footprints in einfachen Raumpolygonen.
    """
    worst = 0.0
    for corner in quad:
        if not point_in_polygon(corner, poly):
            d = dist_point_to_polygon_boundary(corner, poly)
            if -d < worst:
                worst = -d
    return worst


def round_cm(meters: float) -> float:
    """Kaufmännisch gerundete cm-Marge (Halbschritt aufwärts, vorzeichensymmetrisch), 0.1 cm."""
    cm = meters * 100
    sign = -1.0 if cm < 0 else 1.0
    return sign * math.floor(abs(cm) * 10 + 0.5) / 10
