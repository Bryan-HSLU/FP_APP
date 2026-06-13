/**
 * Deklarativer Regel-Interpreter (TS-Seite, Live-Feedback im Viewer).
 *
 * Liest dasselbe Regel-JSON (data/rules/) wie der Python-Interpreter und
 * füllt den constraintReport (Plan-Schema): je Regel Status der
 * Konfidenz-Ampel ok | knapp | verletzt | nicht-geprueft plus Marge in cm.
 * «knapp» = erfüllt, aber Marge < Messunsicherheit (estimatedError_cm;
 * 0 nach Nutzerbestätigung) → speist den Next-Steps-Leitfaden.
 *
 * ⚠️ PARITÄT: 1:1 gespiegelt in fp_engines/rules/interpreter.py. Jede
 * Änderung beidseitig + Fixtures aktualisieren (goldener Paritätstest).
 */
import {
  containmentViolation,
  distPointToSegment,
  frontDir,
  pointInPolygon,
  quadDistance,
  roundCm,
  separation,
  type Quad,
  type Vec2,
} from "./geometry.ts";
import type { Scene, SceneObject } from "./scene.ts";

export interface Rule {
  id: string;
  roomType: string;
  appliesTo: string;
  type: string;
  severity: string;
  params?: Record<string, number | string>;
  normProfile?: string;
  profilOverrides?: Record<string, Record<string, number | string>>;
  hinweis?: string;
}

export interface RuleResult {
  ruleId: string;
  status: "ok" | "knapp" | "verletzt" | "nicht-geprueft";
  margin_cm: number | null;
  placements: string[];
  hinweis?: string;
}

export interface ConstraintReport {
  hard: { ok: boolean; summary: { erfuellt: number; knapp: number; verletzt: number } };
  results: RuleResult[];
  softScore: { stil: number; ergonomie: number; relation: number };
}

const num = (params: Record<string, number | string>, key: string, fallback: number): number => {
  const v = params[key];
  return typeof v === "number" ? v : fallback;
};

const str = (params: Record<string, number | string>, key: string, fallback: string): string => {
  const v = params[key];
  return typeof v === "string" ? v : fallback;
};

function effectiveParams(rule: Rule, normProfile: string): Record<string, number | string> {
  // Normprofil-Overlay: Profilwerte überschreiben die Basis (Norm-Regelsatz-v0).
  return { ...(rule.params ?? {}), ...(rule.profilOverrides?.[normProfile] ?? {}) };
}

function matches(obj: SceneObject, appliesTo: string): boolean {
  return appliesTo === "*" || obj.funktionsTyp === appliesTo;
}

function massiveWalls(scene: Scene): Scene["walls"] {
  return scene.walls.filter((w) => w.kind === "massiv");
}

/** Rechteck-Zone vor der Front eines Objekts (depth tief, width breit, anliegend). */
function frontZone(obj: SceneObject, depth: number, width: number): Quad {
  const f = frontDir(obj.yawDeg);
  // Rechtsvektor = Front um −90° gedreht: (f.z, −f.x)
  const rx = f[1];
  const rz = -f[0];
  const frontCenter: Vec2 = [
    obj.center[0] + (f[0] * obj.d) / 2,
    obj.center[1] + (f[1] * obj.d) / 2,
  ];
  const hw = width / 2;
  const c1: Vec2 = [frontCenter[0] - rx * hw, frontCenter[1] - rz * hw];
  const c2: Vec2 = [frontCenter[0] + rx * hw, frontCenter[1] + rz * hw];
  const c3: Vec2 = [c2[0] + f[0] * depth, c2[1] + f[1] * depth];
  const c4: Vec2 = [c1[0] + f[0] * depth, c1[1] + f[1] * depth];
  return [c1, c2, c3, c4];
}

/** Zone vor einer Öffnung, ins Rauminnere extrudiert (Seite via Polygon-Test). */
function openingZone(scene: Scene, opening: Scene["openings"][number], depth: number): Quad | null {
  const wall = scene.walls.find((w) => w.id === opening.hostWall);
  if (!wall) return null;
  const dx = wall.end[0] - wall.start[0];
  const dz = wall.end[1] - wall.start[1];
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len === 0) return null;
  const ux = dx / len;
  const uz = dz / len;
  const a: Vec2 = [wall.start[0] + ux * opening.offset, wall.start[1] + uz * opening.offset];
  const b: Vec2 = [a[0] + ux * opening.width, a[1] + uz * opening.width];
  for (const sgn of [1, -1]) {
    const nx = -uz * sgn;
    const nz = ux * sgn;
    const quad: Quad = [
      a,
      b,
      [b[0] + nx * depth, b[1] + nz * depth],
      [a[0] + nx * depth, a[1] + nz * depth],
    ];
    const cx = (quad[0][0] + quad[2][0]) / 2;
    const cz = (quad[0][1] + quad[2][1]) / 2;
    if (pointInPolygon([cx, cz], scene.floor)) return quad;
  }
  return null;
}

/** Marge einer Zone: muss im Raum liegen und frei von anderen Objekten sein. */
function zoneMargin(
  scene: Scene,
  zone: Quad,
  excludeIds: string[],
  offenders: string[],
  thresholdM: number,
  heightFilter: ((o: SceneObject) => boolean) | null = null,
): number | null {
  let margin: number | null = null;
  const contain = containmentViolation(zone, scene.floor);
  if (contain < 0) margin = contain;
  for (const o of scene.objects) {
    if (excludeIds.includes(o.id)) continue;
    if (heightFilter && !heightFilter(o)) continue;
    const sep = separation(zone, o.quad);
    if (margin === null || sep < margin) margin = sep;
    if (sep < thresholdM && o.isPlacement && !offenders.includes(o.id)) offenders.push(o.id);
  }
  return margin;
}

type Evaluator = (
  scene: Scene,
  params: Record<string, number | string>,
  appliesTo: string,
  offenders: string[],
) => number | null;

/** Wandobjekte über Bodenobjekten (Spiegel über Lavabo) kollidieren nicht:
 *  Kollision nur, wenn sich die Höhenintervalle [unterkante, oberkante]
 *  überlappen (Berührung = getrennt). */
function vertikalGetrennt(a: SceneObject, b: SceneObject): boolean {
  const aLo = a.mountHeight ?? 0;
  const bLo = b.mountHeight ?? 0;
  return aLo + a.h <= bLo || bLo + b.h <= aLo;
}

// --- Verkehrsweg-Freiraum (circulation), 1:1 zu interpreter.py ---------------
// Ganzzahlige Raster/Erosion-Analyse → bit-identisch zu Python. Float nur bei
// Zell-Mittelpunkten und der Schluss-Marge (gleiche Formeln/Reihenfolge).
const CIRC_CELL = 0.05; // Rasterweite (m). Läuft NICHT im Solver-Hot-Path (nur_hart), daher fein.
const CIRC_MAX_CELLS = 20000; // Schutz: riesige Räume vergröbern statt Speicher sprengen.
// Feste Nachbarschaftsreihenfolge – Determinismus/Parität (BFS-Erst-Treffer!).
const CIRC_NB: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const evaluators: Record<string, Evaluator | null> = {
  collision(scene, _params, _appliesTo, offenders) {
    let margin: number | null = null;
    const track = (value: number, ids: SceneObject[], thresholdM: number): void => {
      if (margin === null || value < margin) margin = value;
      if (value < thresholdM) {
        for (const o of ids) {
          if (o.isPlacement && !offenders.includes(o.id)) offenders.push(o.id);
        }
      }
    };
    const thresholdM = sceneThreshold(scene);
    for (const o of scene.objects) {
      const contain = containmentViolation(o.quad, scene.floor);
      if (contain < 0) track(contain, [o], thresholdM);
    }
    for (let i = 0; i < scene.objects.length; i++) {
      for (let j = i + 1; j < scene.objects.length; j++) {
        const a = scene.objects[i] as SceneObject;
        const b = scene.objects[j] as SceneObject;
        if (vertikalGetrennt(a, b)) continue;
        track(separation(a.quad, b.quad), [a, b], thresholdM);
      }
    }
    return margin;
  },

  "wall-distance"(scene, params, appliesTo, offenders) {
    const minDist = num(params, "minDist", 0);
    let margin: number | null = null;
    for (const o of scene.objects.filter((x) => matches(x, appliesTo))) {
      let dist = Infinity;
      for (const w of massiveWalls(scene)) {
        const d = distPointToSegment(o.center, w.start, w.end);
        if (d < dist) dist = d;
      }
      if (dist === Infinity) continue;
      const m = dist - minDist;
      if (margin === null || m < margin) margin = m;
      if (m < sceneThreshold(scene) && o.isPlacement) offenders.push(o.id);
    }
    return margin;
  },

  "object-distance"(scene, params, appliesTo, offenders) {
    const minDist = num(params, "minDist", 0);
    const target = str(params, "target", "*");
    const measure = str(params, "measure", "edge");
    let margin: number | null = null;
    for (const a of scene.objects.filter((x) => matches(x, appliesTo))) {
      for (const b of scene.objects.filter((x) => matches(x, target))) {
        if (a.id === b.id) continue;
        const dist =
          measure === "center"
            ? Math.sqrt((a.center[0] - b.center[0]) ** 2 + (a.center[1] - b.center[1]) ** 2)
            : quadDistance(a.quad, b.quad);
        const m = dist - minDist;
        if (margin === null || m < margin) margin = m;
        if (m < sceneThreshold(scene)) {
          for (const o of [a, b]) {
            if (o.isPlacement && !offenders.includes(o.id)) offenders.push(o.id);
          }
        }
      }
    }
    return margin;
  },

  clearance(scene, params, appliesTo, offenders) {
    const depth = num(params, "depth", 0.6);
    let margin: number | null = null;
    for (const o of scene.objects.filter((x) => matches(x, appliesTo))) {
      const width = num(params, "width", o.w);
      const zone = frontZone(o, depth, width);
      const m = zoneMargin(scene, zone, [o.id], offenders, sceneThreshold(scene));
      if (m !== null && (margin === null || m < margin)) margin = m;
      if (m !== null && m < sceneThreshold(scene) && o.isPlacement && !offenders.includes(o.id)) {
        offenders.push(o.id);
      }
    }
    return margin;
  },

  "door-swing"(scene, params, _appliesTo, offenders) {
    const radius = num(params, "radius", 0.9);
    let margin: number | null = null;
    for (const opening of scene.openings.filter((o) => o.type === "door")) {
      // v0-Näherung: Rechteck Türbreite × radius statt Viertelkreis (konservativ,
      // identisch einfach in TS & Python). Echte Schwenkrichtung kommt mit M3.
      const zone = openingZone(scene, opening, radius);
      if (!zone) continue;
      const m = zoneMargin(scene, zone, [], offenders, sceneThreshold(scene));
      if (m !== null && (margin === null || m < margin)) margin = m;
    }
    return margin;
  },

  "keep-clear"(scene, params, _appliesTo, offenders) {
    const depth = num(params, "depth", 0.3);
    const maxH = num(params, "maxObjektHoehe", 0.9);
    let margin: number | null = null;
    for (const opening of scene.openings.filter((o) => o.type === "window")) {
      const zone = openingZone(scene, opening, depth);
      if (!zone) continue;
      // Nur hohe Objekte verstellen ein Fenster: Gesamthöhe = Montagehöhe + Korpus.
      const m = zoneMargin(
        scene,
        zone,
        [],
        offenders,
        sceneThreshold(scene),
        (o) => (o.mountHeight ?? 0) + o.h > maxH,
      );
      if (m !== null && (margin === null || m < margin)) margin = m;
    }
    return margin;
  },

  "host-binding"(scene, params, appliesTo, offenders) {
    const mount = str(params, "mount", "boden");
    let margin: number | null = null;
    for (const o of scene.objects.filter((x) => matches(x, appliesTo))) {
      let m: number | null = null;
      if (mount === "wand") {
        let dist = Infinity;
        for (const w of massiveWalls(scene)) {
          let d = Infinity;
          for (let i = 0; i < 4; i++) {
            const corner = o.quad[i] as Vec2;
            const dd = distPointToSegment(corner, w.start, w.end);
            if (dd < d) d = dd;
          }
          if (d < dist) dist = d;
        }
        const maxGap = num(params, "maxWandabstand", 0.05);
        m = dist === Infinity ? -maxGap : maxGap - dist;
      }
      // Höhenfenster (z.B. Lavabo-Oberkante 0.85–0.95): mountHeight = UNTERKANTE
      // über Boden (Plan-Schema) → geprüfte Oberkante = mountHeight + Korpushöhe.
      const minH = params["minHoehe"];
      const maxH = params["maxHoehe"];
      if (typeof minH === "number" && typeof maxH === "number") {
        const hk = o.mountHeight;
        const hm = hk === null ? -minH : Math.min(hk + o.h - minH, maxH - (hk + o.h));
        m = m === null ? hm : Math.min(m, hm);
      }
      if (m !== null) {
        if (margin === null || m < margin) margin = m;
        if (m < sceneThreshold(scene) && o.isPlacement) offenders.push(o.id);
      }
    }
    return margin;
  },

  connection(scene, params, appliesTo, offenders) {
    const typ = str(params, "anschluss", "wasser");
    const maxDist = num(params, "maxDist", 1.0);
    let margin: number | null = null;
    for (const o of scene.objects.filter((x) => matches(x, appliesTo))) {
      let dist = Infinity;
      for (const fp of scene.fixpoints.filter((f) => f.type === typ)) {
        // Punkt-zu-Footprint: 0, wenn der Fixpunkt im/auf dem Footprint liegt.
        let d: number;
        if (pointInPolygon(fp.position, o.quad)) {
          d = 0;
        } else {
          d = Infinity;
          for (let i = 0; i < 4; i++) {
            const dd = distPointToSegment(
              fp.position,
              o.quad[i] as Vec2,
              o.quad[(i + 1) % 4] as Vec2,
            );
            if (dd < d) d = dd;
          }
        }
        if (d < dist) dist = d;
      }
      const m = dist === Infinity ? -maxDist : maxDist - dist;
      if (margin === null || m < margin) margin = m;
      if (m < sceneThreshold(scene) && o.isPlacement) offenders.push(o.id);
    }
    return margin;
  },

  // Verkehrsweg-Freiraum v0 (Grid/Erosion) – 1:1-Spiegel von
  // fp_engines/rules/interpreter._eval_circulation (siehe Docstring dort).
  // Ganzzahlig (Grid/BFS/Union-Find) → bit-identisches Urteil zu Python.
  // v0 ohne Verursacher-Zuordnung → nur scene + params (Evaluator-Typ erlaubt weniger Args).
  circulation(scene, params) {
    const minWidth = num(params, "minWidth", 0.9);
    const floor = scene.floor;
    const xs = floor.map((p) => p[0]);
    const zs = floor.map((p) => p[1]);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const z0 = Math.min(...zs);
    const z1 = Math.max(...zs);
    let cell = CIRC_CELL;
    let nx = Math.floor((x1 - x0) / cell) + 1;
    let nz = Math.floor((z1 - z0) / cell) + 1;
    while (nx * nz > CIRC_MAX_CELLS) {
      cell *= 2;
      nx = Math.floor((x1 - x0) / cell) + 1;
      nz = Math.floor((z1 - z0) / cell) + 1;
    }

    const boxes: [number, number, number, number][] = [];
    for (const o of scene.objects) {
      if (o.mount === "wand") continue;
      const qx = o.quad.map((c) => c[0]);
      const qz = o.quad.map((c) => c[1]);
      boxes.push([Math.min(...qx), Math.max(...qx), Math.min(...qz), Math.max(...qz)]);
    }

    const cx = (i: number): number => x0 + (i + 0.5) * cell;
    const cz = (j: number): number => z0 + (j + 0.5) * cell;

    // Flache typisierte Arrays (Index k = i*nz+j); Werte identisch zur 2D-Liste
    // in interpreter.py, nur TS-ergonomischer (Element-Typ number/boolean).
    const idx = (i: number, j: number): number => i * nz + j;
    const free = new Uint8Array(nx * nz);
    let nFree = 0;
    for (let i = 0; i < nx; i++) {
      const px = cx(i);
      for (let j = 0; j < nz; j++) {
        const pz = cz(j);
        if (!pointInPolygon([px, pz], floor)) continue;
        let blocked = false;
        for (const [xa, xb, za, zb] of boxes) {
          if (xa <= px && px <= xb && za <= pz && pz <= zb) {
            blocked = true;
            break;
          }
        }
        if (!blocked) {
          free[idx(i, j)] = 1;
          nFree++;
        }
      }
    }
    if (nFree === 0) return null;

    const inf = nx + nz + 1;
    const dist = new Int32Array(nx * nz);
    const queue: number[] = [];
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const k = idx(i, j);
        if (free[k]) dist[k] = inf;
        else queue.push(k);
      }
    }
    let head = 0;
    while (head < queue.length) {
      const c = queue[head] as number;
      head++;
      const i = Math.floor(c / nz);
      const j = c % nz;
      for (const [di, dj] of CIRC_NB) {
        const ni = i + di;
        const nj = j + dj;
        if (ni >= 0 && ni < nx && nj >= 0 && nj < nz) {
          const nk = idx(ni, nj);
          const dc = dist[c] as number;
          if ((dist[nk] as number) > dc + 1) {
            dist[nk] = dc + 1;
            queue.push(nk);
          }
        }
      }
    }

    const cellAt = (px: number, pz: number): number => {
      let ci = Math.floor((px - x0) / cell);
      let cj = Math.floor((pz - z0) / cell);
      ci = ci < 0 ? 0 : ci > nx - 1 ? nx - 1 : ci;
      cj = cj < 0 ? 0 : cj > nz - 1 ? nz - 1 : cj;
      return idx(ci, cj);
    };

    const nearestFree = (px: number, pz: number): number | null => {
      const start = cellAt(px, pz);
      if (free[start]) return start;
      const seen = new Set<number>([start]);
      const bfs: number[] = [start];
      let h = 0;
      while (h < bfs.length) {
        const c = bfs[h] as number;
        h++;
        const i = Math.floor(c / nz);
        const j = c % nz;
        for (const [di, dj] of CIRC_NB) {
          const ni = i + di;
          const nj = j + dj;
          if (ni >= 0 && ni < nx && nj >= 0 && nj < nz) {
            const nk = idx(ni, nj);
            if (!seen.has(nk)) {
              if (free[nk]) return nk;
              seen.add(nk);
              bfs.push(nk);
            }
          }
        }
      }
      return null;
    };

    const doors = scene.openings.filter((o) => o.type === "door");
    const anchors: number[] = [];
    for (const d of doors) {
      const wall = scene.walls.find((w) => w.id === d.hostWall);
      if (!wall) continue;
      const sx = wall.start[0];
      const sz = wall.start[1];
      const ex = wall.end[0];
      const ez = wall.end[1];
      const wl = Math.sqrt((ex - sx) ** 2 + (ez - sz) ** 2);
      if (wl === 0) continue;
      const ux = (ex - sx) / wl;
      const uz = (ez - sz) / wl;
      const mid = d.offset + d.width / 2;
      const mx = sx + ux * mid;
      const mz = sz + uz * mid;
      for (const sgn of [1, -1]) {
        const tx = mx + -uz * sgn * cell * 1.5;
        const tz = mz + ux * sgn * cell * 1.5;
        if (pointInPolygon([tx, tz], floor)) {
          const a = nearestFree(tx, tz);
          if (a !== null) anchors.push(a);
          break;
        }
      }
    }
    if (doors.length === 1) {
      let best: number | null = null;
      let bestC = -1;
      for (let i = 0; i < nx; i++) {
        for (let j = 0; j < nz; j++) {
          const k = idx(i, j);
          const clearance = dist[k] as number;
          if (free[k] && clearance > bestC) {
            bestC = clearance;
            best = k;
          }
        }
      }
      if (best !== null) anchors.push(best);
    }
    if (anchors.length < 2) return null;

    let maxLvl = 0;
    const buckets: number[][] = [];
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const k = idx(i, j);
        if (free[k]) {
          const lvl = dist[k] as number;
          (buckets[lvl] ??= []).push(k);
          if (lvl > maxLvl) maxLvl = lvl;
        }
      }
    }
    const parent = new Map<number, number>();
    const find = (x: number): number => {
      let r = x;
      while ((parent.get(r) as number) !== r) {
        parent.set(r, parent.get(parent.get(r) as number) as number);
        r = parent.get(r) as number;
      }
      return r;
    };

    const active = new Set<number>();
    let bottleneck = -1;
    for (let lvl = maxLvl; lvl >= 0; lvl--) {
      for (const c of buckets[lvl] ?? []) {
        parent.set(c, c);
        active.add(c);
        const ci = Math.floor(c / nz);
        const cj = c % nz;
        for (const [di, dj] of CIRC_NB) {
          const ni = ci + di;
          const nj = cj + dj;
          if (ni >= 0 && ni < nx && nj >= 0 && nj < nz) {
            const nb = idx(ni, nj);
            if (active.has(nb)) {
              const ra = find(c);
              const rb = find(nb);
              if (ra !== rb) parent.set(ra, rb);
            }
          }
        }
      }
      if (anchors.every((a) => active.has(a)) && new Set(anchors.map((a) => find(a))).size === 1) {
        bottleneck = lvl;
        break;
      }
    }

    if (bottleneck < 0) return -minWidth;
    return 2 * bottleneck * cell - minWidth;
  },
  relation: null,
};

/** Schwelle in Metern, unterhalb derer Beteiligte als «offenders» gelistet werden. */
function sceneThreshold(scene: Scene): number {
  return scene.margeCm / 100;
}

export function evaluateRules(scene: Scene, rules: Rule[]): ConstraintReport {
  const results: RuleResult[] = [];

  for (const rule of rules) {
    if (rule.roomType !== "alle" && rule.roomType !== scene.roomType) continue;
    if (rule.normProfile && rule.normProfile !== scene.normProfile) continue;

    const evaluator = evaluators[rule.type];
    if (evaluator === undefined) throw new Error(`Unbekannter Regel-Typ: ${rule.type}`);

    if (evaluator === null) {
      results.push({
        ruleId: rule.id,
        status: "nicht-geprueft",
        margin_cm: null,
        placements: [],
        ...(rule.hinweis !== undefined && { hinweis: rule.hinweis }),
      });
      continue;
    }

    const offenders: string[] = [];
    const marginM = evaluator(
      scene,
      effectiveParams(rule, scene.normProfile),
      rule.appliesTo,
      offenders,
    );

    let status: RuleResult["status"];
    let marginCm: number | null = null;
    if (marginM === null) {
      status = "ok"; // Regel hat keine anwendbaren Objekte → trivial erfüllt.
    } else {
      marginCm = roundCm(marginM);
      if (marginCm < 0) status = "verletzt";
      else if (marginCm < scene.margeCm) status = "knapp";
      else status = "ok";
    }

    results.push({
      ruleId: rule.id,
      status,
      margin_cm: marginCm,
      placements: status === "ok" ? [] : offenders,
      ...(rule.hinweis !== undefined && { hinweis: rule.hinweis }),
    });
  }

  const hardIds = new Set(rules.filter((r) => r.severity === "hard").map((r) => r.id));
  const summary = { erfuellt: 0, knapp: 0, verletzt: 0 };
  for (const r of results) {
    if (!hardIds.has(r.ruleId)) continue;
    if (r.status === "ok") summary.erfuellt += 1;
    else if (r.status === "knapp") summary.knapp += 1;
    else if (r.status === "verletzt") summary.verletzt += 1;
  }

  return {
    hard: { ok: summary.verletzt === 0, summary },
    results,
    softScore: { stil: 0, ergonomie: 0, relation: 0 },
  };
}
