/** Reiner Geometrie-Kern der 2D-Grundriss-Ansicht (testbar, ohne DOM).
 *
 *  Welt → SVG: Grundriss in der x/z-Ebene (y-up, Meter). x → Bildschirm-X
 *  (rechts), z → Bildschirm-Y (unten) – ein gewöhnlicher Aufriss von oben,
 *  spiegelfrei. Footprints kommen aus `footprint()` von @fp/shared/rules, also
 *  exakt der Solver-/Interpreter-Konvention (keine eigene Rotationsmathematik).
 */
import { footprint, pointInPolygon, type Vec2 } from "@fp/shared/rules";

export interface PlanTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** Passt die Bounding-Box des Polygons mittig in eine quadratische SVG der
 *  Kantenlänge `size` ein (Rand `pad`). Gleicher Massstab in x und z. */
export function computeTransform(polygon: Vec2[], size: number, pad: number): PlanTransform {
  const xs = polygon.map((p) => p[0]);
  const zs = polygon.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const breite = Math.max(maxX - minX, 1e-6);
  const tiefe = Math.max(maxZ - minZ, 1e-6);
  const innen = size - 2 * pad;
  const scale = innen / Math.max(breite, tiefe);
  // zentrieren: ungenutzte Achse bekommt halben Rest als zusätzlichen Offset.
  const offsetX = pad + (innen - breite * scale) / 2 - minX * scale;
  const offsetY = pad + (innen - tiefe * scale) / 2 - minZ * scale;
  return { scale, offsetX, offsetY };
}

/** Welt-Punkt (x,z) → SVG-Punkt (x rechts, z runter). */
export function toScreen(p: Vec2, t: PlanTransform): Vec2 {
  return [p[0] * t.scale + t.offsetX, p[1] * t.scale + t.offsetY];
}

/** SVG-`points`-String des (rotierten) Footprints eines Objekts. */
export function footprintPoints(
  center: Vec2,
  w: number,
  d: number,
  yawDeg: number,
  t: PlanTransform,
): string {
  return footprint(center, w, d, yawDeg)
    .map((ecke) => {
      const [sx, sy] = toScreen(ecke, t);
      return `${round(sx)},${round(sy)}`;
    })
    .join(" ");
}

/** Einheits-Normale einer Wand, die ins Rauminnere zeigt (für Türschwenk). */
export function innwardNormal(start: Vec2, end: Vec2, floor: Vec2[]): Vec2 {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len;
  const uz = dz / len;
  const mid: Vec2 = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
  for (const sgn of [1, -1]) {
    const n: Vec2 = [-uz * sgn, ux * sgn];
    if (pointInPolygon([mid[0] + n[0] * 0.1, mid[1] + n[1] * 0.1], floor)) return entnull(n);
  }
  return entnull([-uz, ux]);
}

/** −0 → +0 (sonst stolpern Vergleiche; auf das Rendern hat es keinen Einfluss). */
function entnull(v: Vec2): Vec2 {
  return [v[0] === 0 ? 0 : v[0], v[1] === 0 ? 0 : v[1]];
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
