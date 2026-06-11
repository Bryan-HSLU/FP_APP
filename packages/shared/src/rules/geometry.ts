/**
 * 2D-Geometrie für den Regel-Interpreter (Grundriss x/z, Meter).
 *
 * ⚠️ PARITÄT: Dieses Modul ist 1:1 in Python gespiegelt
 * (services/engines/src/fp_engines/rules/geometry.py). Jede Änderung hier
 * MUSS dort identisch nachgezogen werden – der Paritätstest über die
 * goldenen Fixtures erzwingt das. Gleiche Formeln, gleiche Reihenfolge der
 * Operationen (IEEE-754-Determinismus).
 */

export type Vec2 = [number, number];

/** Konvexes Viereck (Footprint/Zone) als 4 Eckpunkte gegen den Uhrzeigersinn. */
export type Quad = [Vec2, Vec2, Vec2, Vec2];

/** cos/sin in Grad; Vielfache von 90° exakt (vermeidet Float-Rauschen libm-übergreifend). */
export function cosDeg(deg: number): number {
  const n = ((deg % 360) + 360) % 360;
  if (n === 0) return 1;
  if (n === 90) return 0;
  if (n === 180) return -1;
  if (n === 270) return 0;
  return Math.cos((deg * Math.PI) / 180);
}

export function sinDeg(deg: number): number {
  const n = ((deg % 360) + 360) % 360;
  if (n === 0) return 0;
  if (n === 90) return 1;
  if (n === 180) return 0;
  if (n === 270) return -1;
  return Math.sin((deg * Math.PI) / 180);
}

/** Rotation um y (y-up, rechtshändig): (x,z) → (x·cos + z·sin, −x·sin + z·cos). */
export function rotateY(v: Vec2, yawDeg: number): Vec2 {
  const c = cosDeg(yawDeg);
  const s = sinDeg(yawDeg);
  return [v[0] * c + v[1] * s, -v[0] * s + v[1] * c];
}

/** Blickrichtung der «Front» eines Objekts: lokal +z, rotiert um yaw. */
export function frontDir(yawDeg: number): Vec2 {
  return rotateY([0, 1], yawDeg);
}

/** Footprint-Ecken eines Objekts: Breite w lokal entlang x, Tiefe d lokal entlang z. */
export function footprint(center: Vec2, w: number, d: number, yawDeg: number): Quad {
  const hw = w / 2;
  const hd = d / 2;
  const local: Quad = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];
  return local.map((p) => {
    const r = rotateY(p, yawDeg);
    return [center[0] + r[0], center[1] + r[1]] as Vec2;
  }) as Quad;
}

/** Achsparalleles Rechteck als Quad. */
export function rectQuad(xMin: number, zMin: number, xMax: number, zMax: number): Quad {
  return [
    [xMin, zMin],
    [xMax, zMin],
    [xMax, zMax],
    [xMin, zMax],
  ];
}

export function distPointToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b[0] - a[0];
  const abz = b[1] - a[1];
  const apx = p[0] - a[0];
  const apz = p[1] - a[1];
  const len2 = abx * abx + abz * abz;
  let t = len2 === 0 ? 0 : (apx * abx + apz * abz) / len2;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  const dx = p[0] - (a[0] + t * abx);
  const dz = p[1] - (a[1] + t * abz);
  return Math.sqrt(dx * dx + dz * dz);
}

export function distSegmentToSegment(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): number {
  if (segmentsIntersect(a1, a2, b1, b2)) return 0;
  return Math.min(
    distPointToSegment(a1, b1, b2),
    distPointToSegment(a2, b1, b2),
    distPointToSegment(b1, a1, a2),
    distPointToSegment(b2, a1, a2),
  );
}

function cross(o: Vec2, a: Vec2, b: Vec2): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function segmentsIntersect(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): boolean {
  const d1 = cross(b1, b2, a1);
  const d2 = cross(b1, b2, a2);
  const d3 = cross(a1, a2, b1);
  const d4 = cross(a1, a2, b2);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  const onSeg = (o1: Vec2, o2: Vec2, p: Vec2): boolean =>
    Math.min(o1[0], o2[0]) <= p[0] &&
    p[0] <= Math.max(o1[0], o2[0]) &&
    Math.min(o1[1], o2[1]) <= p[1] &&
    p[1] <= Math.max(o1[1], o2[1]);
  if (d1 === 0 && onSeg(b1, b2, a1)) return true;
  if (d2 === 0 && onSeg(b1, b2, a2)) return true;
  if (d3 === 0 && onSeg(a1, a2, b1)) return true;
  if (d4 === 0 && onSeg(a1, a2, b2)) return true;
  return false;
}

export function distPointToPolygonBoundary(p: Vec2, poly: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as Vec2;
    const b = poly[(i + 1) % poly.length] as Vec2;
    const d = distPointToSegment(p, a, b);
    if (d < best) best = d;
  }
  return best;
}

/** Punkt im (einfachen) Polygon; Punkte AUF dem Rand zählen als innen. */
export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  if (distPointToPolygonBoundary(p, poly) < 1e-9) return true;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i] as Vec2;
    const pj = poly[j] as Vec2;
    if (
      pi[1] > p[1] !== pj[1] > p[1] &&
      p[0] < ((pj[0] - pi[0]) * (p[1] - pi[1])) / (pj[1] - pi[1]) + pi[0]
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** SAT-Überlappungstiefe zweier konvexer Quads; null wenn getrennt/berührend. */
export function overlapDepth(a: Quad, b: Quad): number | null {
  let minOverlap = Infinity;
  for (const quad of [a, b]) {
    for (let i = 0; i < 4; i++) {
      const p1 = quad[i] as Vec2;
      const p2 = quad[(i + 1) % 4] as Vec2;
      const ex = p2[0] - p1[0];
      const ez = p2[1] - p1[1];
      const len = Math.sqrt(ex * ex + ez * ez);
      if (len === 0) continue;
      const nx = -ez / len;
      const nz = ex / len;
      let aMin = Infinity;
      let aMax = -Infinity;
      for (const p of a) {
        const proj = p[0] * nx + p[1] * nz;
        if (proj < aMin) aMin = proj;
        if (proj > aMax) aMax = proj;
      }
      let bMin = Infinity;
      let bMax = -Infinity;
      for (const p of b) {
        const proj = p[0] * nx + p[1] * nz;
        if (proj < bMin) bMin = proj;
        if (proj > bMax) bMax = proj;
      }
      const overlap = Math.min(aMax, bMax) - Math.max(aMin, bMin);
      if (overlap <= 0) return null;
      if (overlap < minOverlap) minOverlap = overlap;
    }
  }
  return minOverlap;
}

/** Echte Mindestdistanz zweier konvexer Quads (0 bei Berührung/Überlappung). */
export function quadDistance(a: Quad, b: Quad): number {
  if (overlapDepth(a, b) !== null) return 0;
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const d = distSegmentToSegment(
        a[i] as Vec2,
        a[(i + 1) % 4] as Vec2,
        b[j] as Vec2,
        b[(j + 1) % 4] as Vec2,
      );
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * Trennung zweier Quads als Marge: positiv = Abstand, negativ = Überlappungstiefe,
 * 0 = Berührung.
 */
export function separation(a: Quad, b: Quad): number {
  const depth = overlapDepth(a, b);
  if (depth !== null) return -depth;
  return quadDistance(a, b);
}

/**
 * Wie weit ein Quad aus dem Polygon herausragt: 0 = vollständig innen
 * (Berührung erlaubt), sonst negative Marge (−max. Austrittstiefe der Ecken).
 * v0: Ecken-Heuristik – reicht für Footprints in einfachen Raumpolygonen.
 */
export function containmentViolation(quad: Quad, poly: Vec2[]): number {
  let worst = 0;
  for (const corner of quad) {
    if (!pointInPolygon(corner, poly)) {
      const d = distPointToPolygonBoundary(corner, poly);
      if (-d < worst) worst = -d;
    }
  }
  return worst;
}

/** Kaufmännisch gerundete cm-Marge (Halbschritt aufwärts, vorzeichensymmetrisch) auf 0.1 cm. */
export function roundCm(meters: number): number {
  const cm = meters * 100;
  const sign = cm < 0 ? -1 : 1;
  return (sign * Math.floor(Math.abs(cm) * 10 + 0.5)) / 10;
}
