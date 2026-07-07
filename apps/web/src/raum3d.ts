/** Reine Raumhüllen-Geometrie für den 3D-Viewer (kein React/three).
 *
 * Aufgabe: aus einer Wand + ihren Öffnungen die **massiven Wandquader** ableiten,
 * damit Türen/Fenster als echte Löcher erscheinen (Vollsegmente, Sturz, Brüstung)
 * – ohne CSG. Bewusste POC-Entscheidung: statt boolescher Wandschnitte (CSG,
 * z.B. three-bvh-csg) zerlegen wir die Wand in achsparallele Segment-Quader.
 * Das ist dependency-frei, deterministisch und rein testbar; die «Löcher» sind
 * schlicht die von keinem Quader belegten Bereiche. CSG wäre exakter (schräge
 * Laibungen), lohnt für den Box-Platzhalter-POC aber nicht.
 *
 * Koordinaten der Rückgabe («Wand-Lokalraum»): x läuft entlang der Wand ab
 * ihrem Start (0…laenge), y ab Boden (0…hoehe). {@link WandQuader} liefert die
 * MITTE (x,y) plus Breite/Höhe – passend für `boxGeometry` (zentriert).
 */

export type Vec2 = [number, number];

/** Öffnung im Wand-Lokalraum (Meter). `sill`=Brüstungshöhe (Türen: 0). */
export interface WandOeffnung {
  type: string;
  /** Abstand des Öffnungs-Anfangs vom Wand-Start entlang der Wand (m). */
  offset: number;
  width: number;
  height: number;
  sill: number;
}

/** Ein massiver Wandquader: (x,y)=Mitte im Wand-Lokalraum, w×h die Ausdehnung. */
export interface WandQuader {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Minimale Sicht auf eine Wand (start/end in der x/z-Ebene). */
export interface WandRef {
  start: Vec2;
  end: Vec2;
}

// Kleinste sinnvolle Kantenlänge: alles ≤1 cm gilt als degeneriert und entfällt.
const EPS = 0.01;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Zerlegt eine Wand (Länge×Höhe) in massive Quader; Öffnungen bleiben als Löcher
 * frei. Je Öffnung entstehen ein **Sturz** (über sill+height bis Wandhöhe) und –
 * bei Fenstern – eine **Brüstung** (0 bis sill); dazwischen liegen Vollsegmente.
 *
 * Robustheit: Öffnungen werden auf [0, laenge] geclampt, überlappende Bereiche
 * zusammengefasst (x-Union; für die Höhenzonen min(sill)/max(sill+height) –
 * bewusst grob, wie im Auftrag beschrieben), Degeneriertes (≤1 cm) verworfen.
 */
export function wandSegmente(
  laenge: number,
  hoehe: number,
  oeffnungen: WandOeffnung[],
): WandQuader[] {
  const bereinigt = oeffnungen
    .map((o) => ({
      a: clamp(o.offset, 0, laenge),
      b: clamp(o.offset + o.width, 0, laenge),
      sill: clamp(o.sill, 0, hoehe),
      top: clamp(o.sill + o.height, 0, hoehe),
    }))
    .filter((o) => o.b - o.a > EPS)
    .sort((x, y) => x.a - y.a);

  // Überlappende Öffnungen zu einem Bereich mergen (Union der x-Intervalle).
  const merged: { a: number; b: number; sill: number; top: number }[] = [];
  for (const o of bereinigt) {
    const last = merged[merged.length - 1];
    if (last && o.a <= last.b + 1e-9) {
      last.b = Math.max(last.b, o.b);
      last.sill = Math.min(last.sill, o.sill);
      last.top = Math.max(last.top, o.top);
    } else {
      merged.push({ ...o });
    }
  }

  const quads: WandQuader[] = [];
  const push = (x0: number, x1: number, y0: number, y1: number): void => {
    if (x1 - x0 > EPS && y1 - y0 > EPS) {
      quads.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 });
    }
  };

  let cursor = 0;
  for (const o of merged) {
    push(cursor, o.a, 0, hoehe); // Vollsegment links der Öffnung
    push(o.a, o.b, o.top, hoehe); // Sturz über der Öffnung
    push(o.a, o.b, 0, o.sill); // Brüstung unter der Öffnung (bei Türen sill=0 → entfällt)
    cursor = o.b;
  }
  push(cursor, laenge, 0, hoehe); // abschliessendes Vollsegment
  return quads;
}

/**
 * Schneidet eine Quader-Liste auf ein Höhenband [yUnten, yOben] zu (für die
 * gestapelten Wandzonen im Bad: Fliesensockel unten, Uni oben). Quader ausserhalb
 * oder ≤1 cm im Band entfallen; teilweise überlappende werden gekürzt.
 */
export function clipZone(quader: WandQuader[], yUnten: number, yOben: number): WandQuader[] {
  const out: WandQuader[] = [];
  for (const q of quader) {
    const bottom = q.y - q.h / 2;
    const top = q.y + q.h / 2;
    const nb = Math.max(bottom, yUnten);
    const nt = Math.min(top, yOben);
    if (nt - nb > EPS) out.push({ x: q.x, y: (nb + nt) / 2, w: q.w, h: nt - nb });
  }
  return out;
}

/** Weltpose (x/z-Mitte + Yaw) einer Öffnung aus Wand-start/end + offset + width/2. */
export function oeffnungsPose(
  wand: WandRef,
  oeffnung: WandOeffnung,
): { mitte: Vec2; yawRad: number } {
  const dx = wand.end[0] - wand.start[0];
  const dz = wand.end[1] - wand.start[1];
  const laenge = Math.hypot(dx, dz) || 1;
  const ux = dx / laenge;
  const uz = dz / laenge;
  const d = oeffnung.offset + oeffnung.width / 2;
  return {
    mitte: [wand.start[0] + ux * d, wand.start[1] + uz * d],
    yawRad: Math.atan2(dz, dx),
  };
}
