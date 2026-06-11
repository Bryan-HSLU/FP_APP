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

  // Verkehrsweg braucht Freiraum-Analyse (Grid/Erosion) → kommt mit M3 (Solver).
  // Ehrlich «nicht-geprueft» statt stilles ok (STATUS.md, Abweichungen).
  circulation: null,
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
