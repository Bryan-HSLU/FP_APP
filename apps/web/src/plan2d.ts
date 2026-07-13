/** Reiner Geometrie-Kern der 2D-Grundriss-Ansicht (testbar, ohne DOM).
 *
 *  Welt → SVG: Grundriss in der x/z-Ebene (y-up, Meter). x → Bildschirm-X
 *  (rechts), z → Bildschirm-Y (unten) – ein gewöhnlicher Aufriss von oben,
 *  spiegelfrei. Footprints kommen aus `footprint()` von @fp/shared/rules, also
 *  exakt der Solver-/Interpreter-Konvention (keine eigene Rotationsmathematik).
 */
import { footprint, frontDir, pointInPolygon, type Vec2 } from "@fp/shared/rules";

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

/** SVG-Punkt → Welt (x,z); Umkehrung von toScreen (für Drag&Drop). */
export function toWorld(p: Vec2, t: PlanTransform): Vec2 {
  return [(p[0] - t.offsetX) / t.scale, (p[1] - t.offsetY) / t.scale];
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

/** Wand als gefülltes Rechteck (Polygon in Welt) – Dicke mittig auf der
 *  Wandachse verteilt (je halbe Dicke nach beiden Seiten). */
export function wallQuad(start: Vec2, end: Vec2, thickness: number): Vec2[] {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const len = Math.hypot(dx, dz) || 1;
  const nx = -dz / len; // Wand-Normale (Einheit)
  const nz = dx / len;
  const h = thickness / 2;
  return [
    [start[0] + nx * h, start[1] + nz * h],
    [end[0] + nx * h, end[1] + nz * h],
    [end[0] - nx * h, end[1] - nz * h],
    [start[0] - nx * h, start[1] - nz * h],
  ];
}

/** Schnittpunkt zweier Geraden (Punkt + Richtung). `null` bei (nahezu) parallel. */
function schnittGeraden(p1: Vec2, d1: Vec2, p2: Vec2, d2: Vec2): Vec2 | null {
  const denom = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(denom) < 1e-9) return null;
  const wx = p2[0] - p1[0];
  const wz = p2[1] - p1[1];
  const s = (wx * d2[1] - wz * d2[0]) / denom;
  return [p1[0] + d1[0] * s, p1[1] + d1[1] * s];
}

/**
 * Nach aussen versetztes Polygon (CAD-Wand-Aussenkante): jeder Eckpunkt wird
 * entlang der **Winkelhalbierenden** um `thickness` aus dem Raum heraus versetzt
 * (Gehrung/Miter über den Schnitt der beiden versetzten Kanten-Geraden).
 *
 * ⚠️ Das Raumpolygon (`floor.polygon`) ist semantisch die **INNENKANTE** des
 * Raums – die nutzbare Fläche, bis an die der Solver Objekte platziert. Die
 * Wand liegt deshalb **ausserhalb** dieser Linie: Innenkante der Wand = Polygon-
 * Linie, die Wandstärke wächst nach aussen. So decken sich die dargestellte
 * Raumfläche und die Solver-Realität (Bryan 2026-07-13).
 *
 * Ergebnis-Index i gehört zu `polygon[i]`, sodass benachbarte Wände sich
 * denselben Aussen-Eckpunkt teilen (keine Lücke/Überlappung). Kollineare Ecken
 * (180°, kein echter Knick) fallen auf den reinen Normalenversatz zurück.
 */
export function aussenPolygon(polygon: Vec2[], thickness: number): Vec2[] {
  const n = polygon.length;
  return polygon.map((curr, i) => {
    const prev = polygon[(i - 1 + n) % n] as Vec2;
    const next = polygon[(i + 1) % n] as Vec2;
    // Aussen-Normale = negierte Innen-Normale (aus dem Raum heraus).
    const nPrevIn = innwardNormal(prev, curr, polygon);
    const nNextIn = innwardNormal(curr, next, polygon);
    const nPrev: Vec2 = [-nPrevIn[0], -nPrevIn[1]];
    const nNext: Vec2 = [-nNextIn[0], -nNextIn[1]];
    const p1: Vec2 = [curr[0] + nPrev[0] * thickness, curr[1] + nPrev[1] * thickness];
    const d1: Vec2 = [curr[0] - prev[0], curr[1] - prev[1]];
    const p2: Vec2 = [curr[0] + nNext[0] * thickness, curr[1] + nNext[1] * thickness];
    const d2: Vec2 = [next[0] - curr[0], next[1] - curr[1]];
    return schnittGeraden(p1, d1, p2, d2) ?? p1;
  });
}

/**
 * Wand-«Bänder» einer Wand als gefüllte Polygone (Welt) im CAD-Look: die
 * **Innenkante** liegt exakt auf der Wandachse (= Raumpolygon-Linie, nutzbare
 * Raumfläche), die Stärke wächst per `nAussen` nach **aussen**. Pro Öffnung wird
 * das Band ausgespart (Segmentierung via `wandLuecken`) – ein Band je
 * Voll-Segment.
 *
 * An den Wand-Enden (Raumecken) werden – falls übergeben – die gehrungs-
 * versetzten Aussenpunkte `aussenStart`/`aussenEnd` aus {@link aussenPolygon}
 * verwendet, damit die Ecken sauber schliessen. Für Öffnungs-Laibungen mitten
 * in der Wand (kein Eck) genügt der senkrechte Normalenversatz – er liegt auf
 * derselben Aussenkanten-Geraden wie die Gehrungsecke.
 *
 * @param start   Wand-Startpunkt (Welt, auf der Innenkante = Polygon-Linie)
 * @param end     Wand-Endpunkt (Welt, auf der Innenkante = Polygon-Linie)
 * @param nAussen Einheits-Normale aus dem Raum heraus (= −innwardNormal)
 * @param thickness Wandstärke (m)
 * @param oeffnungen Öffnungen dieser Wand (offset/width entlang der Achse)
 * @param aussenStart optionaler Gehrungs-Aussenpunkt am Start (sonst Normalversatz)
 * @param aussenEnd   optionaler Gehrungs-Aussenpunkt am Ende (sonst Normalversatz)
 * @returns je Voll-Segment ein Polygon [innenA, innenB, aussenB, aussenA]
 */
export function wandBaender(
  start: Vec2,
  end: Vec2,
  nAussen: Vec2,
  thickness: number,
  oeffnungen: { offset: number; width: number }[],
  aussenStart?: Vec2,
  aussenEnd?: Vec2,
): Vec2[][] {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const len = Math.hypot(dx, dz) || 1;
  const u: Vec2 = [dx / len, dz / len];
  const EPS = 1e-6;
  const aussenVersatz = (p: Vec2): Vec2 => [
    p[0] + nAussen[0] * thickness,
    p[1] + nAussen[1] * thickness,
  ];
  const { segmente } = wandLuecken(len, oeffnungen);
  return segmente.map(({ a, b }) => {
    const innenA: Vec2 = [start[0] + u[0] * a, start[1] + u[1] * a];
    const innenB: Vec2 = [start[0] + u[0] * b, start[1] + u[1] * b];
    const aussenA: Vec2 = a <= EPS ? (aussenStart ?? aussenVersatz(innenA)) : aussenVersatz(innenA);
    const aussenB: Vec2 =
      b >= len - EPS ? (aussenEnd ?? aussenVersatz(innenB)) : aussenVersatz(innenB);
    return [innenA, innenB, aussenB, aussenA];
  });
}

/** Euklidische Distanz (Meter) zwischen zwei Weltpunkten – für das Messwerkzeug. */
export function distanz(a: Vec2, b: Vec2): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/**
 * Bewegungsflächen-Rechteck (Clearance) vor einem Objekt, in Weltkoordinaten.
 *
 * ⚠️ Deckungsgleich mit `frontZone()` im Regel-Interpreter (@fp/shared/rules) –
 * dieselbe Zone, die die Ampel für `type:"clearance"`-Regeln prüft. Die Front
 * ist lokal +z (= `frontDir(yaw)`), die Zone liegt bündig an der Objekt-Front,
 * `breite` breit (um die Front zentriert) und `tiefe` tief nach vorn. Wird die
 * Interpreter-Zone geändert, muss diese Funktion mitgezogen werden.
 *
 * @param center Objektzentrum (Welt, x/z)
 * @param d      Objekttiefe (m) – die Front sitzt bei center + frontDir·d/2
 * @param yawDeg Objekt-Yaw (Grad)
 * @param tiefe  Zonentiefe nach vorn (m, = clearance-param `depth`)
 * @param breite Zonenbreite (m, = param `width`; fehlt er, Objektbreite `w`)
 * @returns 4 Welt-Eckpunkte (c1,c2,c3,c4) gegen den Uhrzeigersinn wie footprint
 */
export function clearanceRect(
  center: Vec2,
  d: number,
  yawDeg: number,
  tiefe: number,
  breite: number,
): [Vec2, Vec2, Vec2, Vec2] {
  const f = frontDir(yawDeg);
  // Rechtsvektor = Front um −90° gedreht: (f.z, −f.x) – exakt wie im Interpreter.
  const rx = f[1];
  const rz = -f[0];
  const frontCenter: Vec2 = [center[0] + (f[0] * d) / 2, center[1] + (f[1] * d) / 2];
  const hw = breite / 2;
  const c1: Vec2 = [frontCenter[0] - rx * hw, frontCenter[1] - rz * hw];
  const c2: Vec2 = [frontCenter[0] + rx * hw, frontCenter[1] + rz * hw];
  const c3: Vec2 = [c2[0] + f[0] * tiefe, c2[1] + f[1] * tiefe];
  const c4: Vec2 = [c1[0] + f[0] * tiefe, c1[1] + f[1] * tiefe];
  return [c1, c2, c3, c4];
}

/** Öffnungs-Intervall entlang der Wandachse (Meter ab Wand-Start). */
export interface Luecke {
  a: number;
  b: number;
}

/**
 * Zerlegt eine Wand (Achslänge `laenge`) an ihren Öffnungen in Teilstücke.
 *
 * Für die 2D-Darstellung: die Wandfüllung wird NUR über den `segmente`-Intervallen
 * gezeichnet, in den `luecken` bleibt sie ausgespart (echte Öffnung in der
 * Wandstärke, keine Linie obendrauf). Robust bei mehreren/überlappenden
 * Öffnungen: Intervalle werden auf [0, laenge] geclampt, überlappende gemerged,
 * degenerierte (≤1 mm) verworfen. Analog zu `wandSegmente` in `raum3d.ts`, aber
 * rein auf die Wandachse projiziert (2D).
 */
export function wandLuecken(
  laenge: number,
  oeffnungen: { offset: number; width: number }[],
): { segmente: Luecke[]; luecken: Luecke[] } {
  const EPS = 1e-3;
  const clamp = (v: number): number => Math.min(laenge, Math.max(0, v));
  const roh = oeffnungen
    .map((o) => ({ a: clamp(o.offset), b: clamp(o.offset + o.width) }))
    .filter((o) => o.b - o.a > EPS)
    .sort((x, y) => x.a - y.a);

  const luecken: Luecke[] = [];
  for (const o of roh) {
    const last = luecken[luecken.length - 1];
    if (last && o.a <= last.b + 1e-9) last.b = Math.max(last.b, o.b);
    else luecken.push({ ...o });
  }

  const segmente: Luecke[] = [];
  let cursor = 0;
  for (const o of luecken) {
    if (o.a - cursor > EPS) segmente.push({ a: cursor, b: o.a });
    cursor = o.b;
  }
  if (laenge - cursor > EPS) segmente.push({ a: cursor, b: laenge });
  return { segmente, luecken };
}

/** Alle Wand-Endpunkte (Ecken) als Snap-Kandidaten fürs Messwerkzeug. */
export function wandEcken(walls: { start: Vec2; end: Vec2 }[]): Vec2[] {
  const ecken: Vec2[] = [];
  for (const w of walls) {
    ecken.push([w.start[0], w.start[1]], [w.end[0], w.end[1]]);
  }
  return ecken;
}

/** Snappt einen Weltpunkt auf die nächste Ecke, falls sie näher als
 *  `schwelle` (Meter) liegt – sonst den Punkt unverändert. */
export function naechsteEcke(welt: Vec2, ecken: Vec2[], schwelle: number): Vec2 {
  let beste: Vec2 = welt;
  let min = schwelle;
  for (const e of ecken) {
    const dd = distanz(welt, e);
    if (dd <= min) {
      min = dd;
      beste = e;
    }
  }
  return beste;
}

/** Yaw (Grad, gerastet) aus der Zeiger-Richtung relativ zum Objektzentrum.
 *  Front = lokal +z ⇒ frontDir(yaw) = (sin,cos) ⇒ yaw = atan2(dx, dz). */
export function yawAusZeiger(center: Vec2, welt: Vec2, schrittGrad = 15): number {
  const dx = welt[0] - center[0];
  const dz = welt[1] - center[1];
  if (dx === 0 && dz === 0) return 0;
  const deg = (Math.atan2(dx, dz) * 180) / Math.PI;
  const gerastet = Math.round(deg / schrittGrad) * schrittGrad;
  return ((gerastet % 360) + 360) % 360;
}

/** Auf ein Raster (Meter) runden – für gerastetes Ziehen (Default 5 cm). */
export function rasten(v: number, schritt = 0.05): number {
  return Math.round(v / schritt) * schritt;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
