/** 2D-Objektsymbole für den Grundriss-Viewer (Architekten-Draufsicht).
 *
 *  Reines, DOM-freies Modul (testbar): je funktionsTyp eine einfache
 *  Draufsicht-Signatur (Schüssel, Becken, Sitzfläche …) INNERHALB der bbox.
 *  Die Symbole werden in **lokalen Metern** relativ zum Objektzentrum
 *  beschrieben (x = Breite w entlang der lokalen x-Achse, z = Tiefe d entlang
 *  der lokalen z-Achse; Front = lokal +z, exakt wie `footprint()`/`frontDir()`
 *  in @fp/shared/rules). `symbolScreenPrims` dreht sie um den Yaw, verschiebt
 *  ans Zentrum und projiziert über `toScreen` – also deckungsgleich mit dem
 *  Footprint-Polygon (keine zweite Rotationsmathematik).
 *
 *  Neue funktionsTypen: einen `Bauer` schreiben (lokale Meter) und in `BAUER`
 *  eintragen. Nicht kartierte Typen liefern `null` → der Viewer fällt auf die
 *  bisherige beschriftete Box zurück.
 */
import { rotateY, type Vec2 } from "@fp/shared/rules";
import { toScreen, type PlanTransform } from "./plan2d.ts";
import { ECKSOFA, SOFA } from "./moebelProportionen.ts";

/** 2D-Punkt im lokalen Objekt-System (Meter, Ursprung = bbox-Mitte). */
type LVec = [number, number];

/** Primitiv im lokalen System – Rotation/Projektion macht symbolScreenPrims. */
type LPrim =
  | { k: "poly"; p: LVec[]; close: boolean; dash?: boolean }
  | { k: "line"; a: LVec; b: LVec; dash?: boolean }
  | { k: "circle"; c: LVec; r: number; dash?: boolean };

/** Fertig projiziertes Primitiv (Bildschirm-Koordinaten) für den SVG-Renderer. */
export type ScreenPrim =
  | { kind: "poly"; points: string; close: boolean; dash: boolean }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; dash: boolean }
  | { kind: "circle"; cx: number; cy: number; r: number; dash: boolean };

type Bauer = (w: number, d: number) => LPrim[];

// --- Konstruktoren ---------------------------------------------------------

const poly = (p: LVec[], dash = false): LPrim => ({ k: "poly", p, close: true, dash });
const line = (a: LVec, b: LVec, dash = false): LPrim => ({ k: "line", a, b, dash });
const circle = (c: LVec, r: number, dash = false): LPrim => ({ k: "circle", c, r, dash });

/** Achsparalleles Rechteck (halbe Breite hw, halbe Tiefe hd) als Polygon. */
const box = (hw: number, hd: number): LPrim =>
  poly([
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ]);

function arcPts(cx: number, cz: number, r: number, a0: number, a1: number, n = 5): LVec[] {
  const out: LVec[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i / n);
    out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
  }
  return out;
}

/** Ellipse als geschlossenes Polygon (n Segmente). */
function ellipse(cx: number, cz: number, rx: number, rz: number, n = 28): LPrim {
  const p: LVec[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    p.push([cx + Math.cos(a) * rx, cz + Math.sin(a) * rz]);
  }
  return poly(p);
}

/** Abgerundetes Rechteck (x0,z0)–(x1,z1) mit Eckradius r, als Polygon. */
function roundRect(x0: number, z0: number, x1: number, z1: number, r: number): LPrim {
  const rr = Math.min(r, Math.abs(x1 - x0) / 2, Math.abs(z1 - z0) / 2);
  const HALF = Math.PI / 2;
  const p: LVec[] = [
    ...arcPts(x1 - rr, z0 + rr, rr, -HALF, 0),
    ...arcPts(x1 - rr, z1 - rr, rr, 0, HALF),
    ...arcPts(x0 + rr, z1 - rr, rr, HALF, Math.PI),
    ...arcPts(x0 + rr, z0 + rr, rr, Math.PI, Math.PI * 1.5),
  ];
  return poly(p);
}

// --- Symbol-Bausätze je funktionsTyp --------------------------------------
// Alle Masse als Bruchteile von w/d, damit jede Katalog-Grösse passt und die
// Signatur innerhalb der bbox bleibt. Front (Bedien-/Sitzseite) = lokal +z.

// BAD ----------------------------------------------------------------------

// WC: Spülkasten hinten (−z) + Schüssel-Oval vorne + Abfluss
const wc: Bauer = (w, d) => {
  const hd = d / 2;
  return [
    poly([
      [-0.34 * w, -hd],
      [0.34 * w, -hd],
      [0.34 * w, -hd + 0.2 * d],
      [-0.34 * w, -hd + 0.2 * d],
    ]),
    ellipse(0, 0.12 * d, 0.3 * w, 0.34 * d),
    circle([0, 0.12 * d], Math.min(w, d) * 0.05),
  ];
};

// Lavabo: Aussenkontur + Becken-Ellipse + Armatur hinten
const lavabo: Bauer = (w, d) => {
  const m = Math.min(w, d);
  return [
    roundRect(-w / 2, -d / 2, w / 2, d / 2, m * 0.18),
    ellipse(0, 0.04 * d, 0.34 * w, 0.34 * d),
    circle([0, -d / 2 + 0.12 * d], m * 0.05),
  ];
};

// Dusche: Quadrat + Diagonalen + Abfluss
const dusche: Bauer = (w, d) => [
  box(w / 2, d / 2),
  line([-w / 2, -d / 2], [w / 2, d / 2]),
  line([w / 2, -d / 2], [-w / 2, d / 2]),
  circle([0, 0], Math.min(w, d) * 0.07),
];

// Badewanne: abgerundetes Rechteck + Innenwanne + Abfluss
const badewanne: Bauer = (w, d) => {
  const m = Math.min(w, d);
  return [
    roundRect(-w / 2, -d / 2, w / 2, d / 2, m * 0.22),
    roundRect(-w / 2 + 0.09 * w, -d / 2 + 0.09 * d, w / 2 - 0.09 * w, d / 2 - 0.09 * d, m * 0.16),
    circle([0, d / 2 - 0.18 * d], m * 0.05),
  ];
};

// WOHNEN / SCHLAFEN --------------------------------------------------------

// Sofa/Sessel: Rückenlehne hinten + zwei Armlehnen + Sitzkissen.
// Die Anteile kommen aus `moebelProportionen.SOFA` – dieselbe Quelle wie der
// 3D-Bausatz, damit Grundriss und 3D dasselbe Möbel zeigen.
const sofa: Bauer = (w, d) => {
  const m = Math.min(w, d);
  const armB = SOFA.armBreite * w;
  const lehneZ = -d / 2 + SOFA.lehneTiefe * d;
  const armZ0 = SOFA.armVersatz * d - (SOFA.armTiefe * d) / 2;
  const armZ1 = SOFA.armVersatz * d + (SOFA.armTiefe * d) / 2;
  const innen = w - 2 * armB;
  const kissB = SOFA.kissenBreite * innen;
  const kissX = SOFA.kissenVersatz * innen;
  const kissZ0 = SOFA.kissenVersatzTiefe * d - (SOFA.kissenTiefe * d) / 2;
  const kissZ1 = SOFA.kissenVersatzTiefe * d + (SOFA.kissenTiefe * d) / 2;
  return [
    // Rückenlehne (hinten, −z)
    poly([
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, lehneZ],
      [-w / 2, lehneZ],
    ]),
    // Armlehnen links/rechts – enden wie im 3D vor der Vorderkante
    poly([
      [-w / 2, armZ0],
      [-w / 2 + armB, armZ0],
      [-w / 2 + armB, armZ1],
      [-w / 2, armZ1],
    ]),
    poly([
      [w / 2 - armB, armZ0],
      [w / 2, armZ0],
      [w / 2, armZ1],
      [w / 2 - armB, armZ1],
    ]),
    // Zwei Sitzkissen (Teilung macht die Sitzplätze im Plan ablesbar)
    roundRect(-kissX - kissB / 2, kissZ0, -kissX + kissB / 2, kissZ1, m * 0.06),
    roundRect(kissX - kissB / 2, kissZ0, kissX + kissB / 2, kissZ1, m * 0.06),
  ];
};

// L-Sofa (`modell3d: "sofa-l"`): Hauptbank hinten + Longchair rechts nach
// vorne. Gleiche Anteile wie der 3D-Bausatz (`moebelProportionen.ECKSOFA`) –
// vorher fehlte dieses Symbol, weshalb der Grundriss ein normales Sofa zeigte.
const ecksofa: Bauer = (w, d) => {
  const m = Math.min(w, d);
  const hauptZ = -d / 2 + ECKSOFA.hauptTiefe * d;
  const schenkelX = w / 2 - ECKSOFA.schenkelBreite * w;
  const arm = ECKSOFA.armBreite * w;
  return [
    // L-Umriss (ein Polygon: Hauptzeile + Schenkel)
    poly([
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [schenkelX, d / 2],
      [schenkelX, hauptZ],
      [-w / 2, hauptZ],
    ]),
    // Rückenlehne der Hauptzeile
    line([-w / 2, -d / 2 + 0.14 * d], [schenkelX, -d / 2 + 0.14 * d]),
    // Rückenlehne des Schenkels (an der rechten Aussenkante)
    line([w / 2 - 0.14 * w, -d / 2], [w / 2 - 0.14 * w, d / 2]),
    // Aussen-Armlehne links
    poly([
      [-w / 2, -d / 2],
      [-w / 2 + arm, -d / 2],
      [-w / 2 + arm, hauptZ],
      [-w / 2, hauptZ],
    ]),
    // Sitzflächen-Teilung: eine Fuge in der Hauptzeile, eine im Schenkel
    line([0, -d / 2 + 0.16 * d], [0, hauptZ]),
    line([schenkelX, 0], [w / 2 - 0.12 * w, 0]),
    // Eckkissen im Knick
    roundRect(schenkelX - m * 0.18, hauptZ - m * 0.18, schenkelX, hauptZ, m * 0.05),
  ];
};

// Esstisch: Platte + Stuhl-Andeutungen an vier Seiten
const esstisch: Bauer = (w, d) => {
  const m = Math.min(w, d);
  return [
    roundRect(-w / 2 + 0.12 * w, -d / 2 + 0.12 * d, w / 2 - 0.12 * w, d / 2 - 0.12 * d, m * 0.06),
    poly([
      [-0.18 * w, -d / 2],
      [0.18 * w, -d / 2],
      [0.18 * w, -d / 2 + 0.08 * d],
      [-0.18 * w, -d / 2 + 0.08 * d],
    ]),
    poly([
      [-0.18 * w, d / 2 - 0.08 * d],
      [0.18 * w, d / 2 - 0.08 * d],
      [0.18 * w, d / 2],
      [-0.18 * w, d / 2],
    ]),
    poly([
      [-w / 2, -0.18 * d],
      [-w / 2 + 0.08 * w, -0.18 * d],
      [-w / 2 + 0.08 * w, 0.18 * d],
      [-w / 2, 0.18 * d],
    ]),
    poly([
      [w / 2 - 0.08 * w, -0.18 * d],
      [w / 2, -0.18 * d],
      [w / 2, 0.18 * d],
      [w / 2 - 0.08 * w, 0.18 * d],
    ]),
  ];
};

// Couch-/Beistelltisch: nur die Platte (abgerundet)
const tischPlatte: Bauer = (w, d) => [
  roundRect(
    -w / 2 + 0.08 * w,
    -d / 2 + 0.08 * d,
    w / 2 - 0.08 * w,
    d / 2 - 0.08 * d,
    Math.min(w, d) * 0.1,
  ),
];

// Bett: Kontur + Kopfkissen hinten + Deckenlinie
const bett: Bauer = (w, d) => {
  const m = Math.min(w, d);
  return [
    box(w / 2, d / 2),
    roundRect(-w / 2 + 0.08 * w, -d / 2 + 0.05 * d, w / 2 - 0.08 * w, -d / 2 + 0.22 * d, m * 0.05),
    line([-w / 2, -d / 2 + 0.34 * d], [w / 2, -d / 2 + 0.34 * d]),
  ];
};

// Regal/Sideboard: Kontur + Tiefenlinie (Front)
const schrankTiefe: Bauer = (w, d) => [
  box(w / 2, d / 2),
  line([-w / 2, d / 2 - 0.28 * d], [w / 2, d / 2 - 0.28 * d]),
];

// TV-Möbel: Korpus + Tiefenlinie + TV-Streifen hinten
const tvmoebel: Bauer = (w, d) => [
  box(w / 2, d / 2),
  line([-w / 2, d / 2 - 0.25 * d], [w / 2, d / 2 - 0.25 * d]),
  poly([
    [-0.3 * w, -d / 2],
    [0.3 * w, -d / 2],
    [0.3 * w, -d / 2 + 0.06 * d],
    [-0.3 * w, -d / 2 + 0.06 * d],
  ]),
];

// KÜCHE --------------------------------------------------------------------

// Kochfeld: 4 Kreise
const kochfeld: Bauer = (w, d) => {
  const r = Math.min(w, d) * 0.16;
  return [
    box(w / 2, d / 2),
    circle([-0.22 * w, -0.22 * d], r),
    circle([0.22 * w, -0.22 * d], r),
    circle([-0.22 * w, 0.22 * d], r),
    circle([0.22 * w, 0.22 * d], r),
  ];
};

// Spüle: Korpus + Becken + Armatur hinten
const spuele: Bauer = (w, d) => {
  const m = Math.min(w, d);
  return [
    box(w / 2, d / 2),
    roundRect(-0.42 * w, -0.3 * d, 0.05 * w, 0.3 * d, m * 0.05),
    circle([-0.18 * w, -d / 2 + 0.14 * d], m * 0.05),
  ];
};

// Kühlschrank: Korpus + Türlinie
const kuehlschrank: Bauer = (w, d) => [
  box(w / 2, d / 2),
  line([w / 2 - 0.12 * w, -d / 2], [w / 2 - 0.12 * w, d / 2]),
];

// Geschirrspüler: Korpus + Frontkante + Bedienpunkt
const geschirrspueler: Bauer = (w, d) => [
  box(w / 2, d / 2),
  line([-w / 2, d / 2 - 0.2 * d], [w / 2, d / 2 - 0.2 * d]),
  circle([0.3 * w, d / 2 - 0.1 * d], Math.min(w, d) * 0.04),
];

// Schrank (Unter-/Hoch-/Bad-/Hängeschrank): Kontur + Front + Türtrennung
const schrank: Bauer = (w, d) => [
  box(w / 2, d / 2),
  line([-w / 2, d / 2 - 0.22 * d], [w / 2, d / 2 - 0.22 * d]),
  line([0, d / 2 - 0.22 * d], [0, d / 2]),
];

// Eckschrank: Kontur + Diagonale
const eckschrank: Bauer = (w, d) => [box(w / 2, d / 2), line([-w / 2, -d / 2], [w / 2, d / 2])];

// Füllstück: schmale Kontur + Diagonal-Schraffur
const fuellstueck: Bauer = (w, d) => [box(w / 2, d / 2), line([-w / 2, -d / 2], [w / 2, d / 2])];

// Dunstabzug: Kontur + Innenrechteck (Fangschirm)
const dunstabzug: Bauer = (w, d) => [
  box(w / 2, d / 2),
  roundRect(
    -w / 2 + 0.16 * w,
    -d / 2 + 0.16 * d,
    w / 2 - 0.16 * w,
    d / 2 - 0.16 * d,
    Math.min(w, d) * 0.05,
  ),
];

// Handtuchheizung: Kontur + horizontale Heizrohre
const handtuchheizung: Bauer = (w, d) => {
  const prims: LPrim[] = [box(w / 2, d / 2)];
  const n = 5;
  for (let i = 0; i < n; i++) {
    const z = -d / 2 + 0.18 * d + (i / (n - 1)) * 0.64 * d;
    prims.push(line([-w / 2 + 0.12 * w, z], [w / 2 - 0.12 * w, z]));
  }
  return prims;
};

// Handtuchstange: Stange + zwei Endhalter
const handtuchstange: Bauer = (w, d) => [
  line([-w / 2, 0], [w / 2, 0]),
  line([-w / 2, -0.3 * d], [-w / 2, 0.3 * d]),
  line([w / 2, -0.3 * d], [w / 2, 0.3 * d]),
];

// Spiegel: schmale Kontur + Glas-Diagonale
const spiegel: Bauer = (w, d) => [box(w / 2, d / 2), line([-w / 2, -d / 2], [w / 2, d / 2])];

// Wandbild: Rahmen + Kreuz
const wandbild: Bauer = (w, d) => [
  box(w / 2, d / 2),
  line([-w / 2, -d / 2], [w / 2, d / 2]),
  line([w / 2, -d / 2], [-w / 2, d / 2]),
];

// Leuchte (Steh-/Wandleuchte): Kreis + Strahlen
const leuchte: Bauer = (w, d) => {
  const m = Math.min(w, d);
  const rInnen = m * 0.28;
  const rAussen = m * 0.48;
  const prims: LPrim[] = [circle([0, 0], rInnen)];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    prims.push(
      line(
        [Math.cos(a) * rInnen, Math.sin(a) * rInnen],
        [Math.cos(a) * rAussen, Math.sin(a) * rAussen],
      ),
    );
  }
  return prims;
};

// Pflanze: Topf-Kreis + Blätter-Strahlen
const pflanze: Bauer = (w, d) => {
  const m = Math.min(w, d);
  const rTopf = m * 0.18;
  const rBlatt = m * 0.44;
  const prims: LPrim[] = [circle([0, 0], rTopf)];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    prims.push(line([0, 0], [Math.cos(a) * rBlatt, Math.sin(a) * rBlatt]));
  }
  return prims;
};

// Teppich: gestricheltes Rechteck (Kontur + Innenrahmen)
const teppich: Bauer = (w, d) => [
  poly(
    [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ],
    true,
  ),
  poly(
    [
      [-w / 2 + 0.08 * w, -d / 2 + 0.08 * d],
      [w / 2 - 0.08 * w, -d / 2 + 0.08 * d],
      [w / 2 - 0.08 * w, d / 2 - 0.08 * d],
      [-w / 2 + 0.08 * w, d / 2 - 0.08 * d],
    ],
    true,
  ),
];

// Deko: konzentrische Kreise
const deko: Bauer = (w, d) => {
  const m = Math.min(w, d);
  return [circle([0, 0], m * 0.35), circle([0, 0], m * 0.15)];
};

// Stuhl: Sitzfläche + Rückenlehnen-Andeutung hinten
const stuhl: Bauer = (w, d) => {
  const m = Math.min(w, d);
  return [
    roundRect(-w / 2 + 0.1 * w, -d / 2 + 0.1 * d, w / 2 - 0.1 * w, d / 2 - 0.1 * d, m * 0.08),
    line([-w / 2 + 0.1 * w, -d / 2 + 0.24 * d], [w / 2 - 0.1 * w, -d / 2 + 0.24 * d]),
  ];
};

// Wäschekorb: Kontur + Innenring (Rundkorb-Andeutung)
const waeschekorb: Bauer = (w, d) => {
  const m = Math.min(w, d);
  return [box(w / 2, d / 2), circle([0, 0], m * 0.34)];
};

// Badhocker: Kontur + Sitzkreis
const badhocker: Bauer = (w, d) => {
  const m = Math.min(w, d);
  return [box(w / 2, d / 2), circle([0, 0], m * 0.36)];
};

// Abfalleimer: Kreis mit Kreuz (Deckel-Andeutung)
const abfalleimer: Bauer = (w, d) => {
  const m = Math.min(w, d);
  const r = m * 0.42;
  return [circle([0, 0], r), line([-r, 0], [r, 0]), line([0, -r], [0, r])];
};

// Midischrank: Kontur + Front + Türtrennung (wie Schrank, mittelhoch)
const midischrank: Bauer = (w, d) => [
  box(w / 2, d / 2),
  line([-w / 2, d / 2 - 0.2 * d], [w / 2, d / 2 - 0.2 * d]),
  line([0, d / 2 - 0.2 * d], [0, d / 2]),
];

// Pouf: gerundetes Quadrat + Innenrahmen
const pouf: Bauer = (w, d) => {
  const m = Math.min(w, d);
  return [
    roundRect(-w / 2, -d / 2, w / 2, d / 2, m * 0.24),
    roundRect(-w / 2 + 0.16 * w, -d / 2 + 0.16 * d, w / 2 - 0.16 * w, d / 2 - 0.16 * d, m * 0.14),
  ];
};

// Vitrine: Kontur + Glasfront-Diagonale (wie Schrank, aber Diagonale statt Trennlinie)
const vitrine: Bauer = (w, d) => [
  box(w / 2, d / 2),
  line([-w / 2, d / 2 - 0.2 * d], [w / 2, d / 2 - 0.2 * d]),
  line([-w / 2, -d / 2], [w / 2, d / 2 - 0.2 * d]),
];

// Konsolentisch: schmale Kontur + Doppellinie (Plattenkante, wandnah)
const konsolentisch: Bauer = (w, d) => [
  box(w / 2, d / 2),
  line([-w / 2 + 0.1 * w, -d / 2 + 0.16 * d], [w / 2 - 0.1 * w, -d / 2 + 0.16 * d]),
];

// Barwagen: Kontur + vier Rollen-Punkte an den Ecken
const barwagen: Bauer = (w, d) => {
  const r = Math.min(w, d) * 0.08;
  return [
    box(w / 2, d / 2),
    circle([-0.36 * w, -0.36 * d], r),
    circle([0.36 * w, -0.36 * d], r),
    circle([-0.36 * w, 0.36 * d], r),
    circle([0.36 * w, 0.36 * d], r),
  ];
};

// Servierwagen: wie Barwagen – Kontur + vier Rollen-Punkte, zwei Ablageböden
const servierwagen: Bauer = (w, d) => {
  const r = Math.min(w, d) * 0.08;
  return [
    box(w / 2, d / 2),
    line([-w / 2, 0], [w / 2, 0]),
    circle([-0.36 * w, -0.36 * d], r),
    circle([0.36 * w, -0.36 * d], r),
    circle([-0.36 * w, 0.36 * d], r),
    circle([0.36 * w, 0.36 * d], r),
  ];
};

// Recamiere: Sofa-ähnlich, aber nur eine (rechte) Armlehne statt zweier
const recamiere: Bauer = (w, d) => {
  const m = Math.min(w, d);
  return [
    poly([
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, -d / 2 + 0.22 * d],
      [-w / 2, -d / 2 + 0.22 * d],
    ]),
    poly([
      [w / 2 - 0.14 * w, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [w / 2 - 0.14 * w, d / 2],
    ]),
    roundRect(-w / 2, -d / 2 + 0.22 * d, w / 2 - 0.14 * w, d / 2, m * 0.08),
  ];
};

// Barhocker: Kreis in Kontur (rund, klein) mit Fussring
const barhocker: Bauer = (w, d) => {
  const m = Math.min(w, d);
  return [circle([0, 0], m * 0.46), circle([0, 0], m * 0.3)];
};

// Vorratsschrank: Kontur + Front + Türtrennung (hoher Schrank)
const vorratsschrank: Bauer = (w, d) => [
  box(w / 2, d / 2),
  line([-w / 2, d / 2 - 0.18 * d], [w / 2, d / 2 - 0.18 * d]),
  line([0, d / 2 - 0.18 * d], [0, d / 2]),
];

// Weinkühlschrank: Kontur + Glasfront-Doppellinie + Flaschen-Punkte
const weinkuehlschrank: Bauer = (w, d) => {
  const r = Math.min(w, d) * 0.06;
  return [
    box(w / 2, d / 2),
    line([-w / 2 + 0.1 * w, -d / 2 + 0.14 * d], [w / 2 - 0.1 * w, -d / 2 + 0.14 * d]),
    line([-w / 2 + 0.1 * w, d / 2 - 0.14 * d], [w / 2 - 0.1 * w, d / 2 - 0.14 * d]),
    circle([-0.22 * w, 0], r),
    circle([0, 0], r),
    circle([0.22 * w, 0], r),
  ];
};

/** funktionsTyp → Symbol-Bauer. Aliase teilen sich einen Bauer. */
const BAUER: Record<string, Bauer> = {
  // Bad
  wc,
  lavabo,
  dusche,
  badewanne,
  badmoebel: schrank,
  handtuchheizung,
  handtuchstange,
  spiegel,
  badteppich: teppich,
  // Wohnen / Schlafen
  sofa,
  sessel: sofa,
  "sofa-l": ecksofa,
  esstisch,
  couchtisch: tischPlatte,
  beistelltisch: tischPlatte,
  bett,
  einzelbett: bett,
  doppelbett: bett,
  kinderbett: bett,
  regal: schrankTiefe,
  sideboard: schrankTiefe,
  tvmoebel,
  stehleuchte: leuchte,
  wandleuchte: leuchte,
  leuchte,
  wandbild,
  teppich,
  stuhl,
  // Küche
  kochfeld,
  spuele,
  kuehlschrank,
  geschirrspueler,
  unterschrank: schrank,
  hochschrank: schrank,
  haengeschrank: schrank,
  eckschrank,
  fuellstueck,
  dunstabzug,
  midischrank,
  vorratsschrank,
  weinkuehlschrank,
  // Wohnen / Schlafen (Ergänzung)
  pouf,
  vitrine,
  konsolentisch,
  barwagen,
  servierwagen,
  recamiere,
  barhocker,
  // Bad (Ergänzung)
  waeschekorb,
  badhocker,
  // Gemeinsam
  abfalleimer,
  pflanze,
  deko,
};

/** Gibt es für diesen funktionsTyp ein 2D-Symbol (sonst Box-Fallback)? */
export function hatSymbol(funktionsTyp: string): boolean {
  return funktionsTyp in BAUER;
}

function runde(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Projiziert das Symbol eines funktionsTyps in Bildschirm-Koordinaten –
 * gedreht um `yawDeg`, verschoben ans Weltzentrum `center`, skaliert über `t`.
 * Deckungsgleich mit dem Footprint-Polygon. `null` → kein Symbol (Box-Fallback).
 */
/** Alle registrierten Symbol-Schlüssel (funktionsTypen UND modell3d-Varianten).
 *  Grundlage des bbox-Tests über den kompletten Bestand. */
export function alleSymbolTypen(): string[] {
  return Object.keys(BAUER);
}

export function symbolScreenPrims(
  funktionsTyp: string,
  center: Vec2,
  w: number,
  d: number,
  yawDeg: number,
  t: PlanTransform,
  modell3d?: string,
): ScreenPrim[] | null {
  // `modell3d` hat Vorrang (gleiche Auflösung wie im 3D-Viewer): so zeichnet
  // ein Ecksofa im Grundriss auch ein L, obwohl sein funktionsTyp «sofa» ist.
  const bauer = (modell3d ? BAUER[modell3d] : undefined) ?? BAUER[funktionsTyp];
  if (!bauer) return null;

  const zuScreen = (p: LVec): Vec2 => {
    const r = rotateY(p, yawDeg);
    return toScreen([center[0] + r[0], center[1] + r[1]], t);
  };

  return bauer(w, d).map((prim): ScreenPrim => {
    if (prim.k === "circle") {
      const [cx, cy] = zuScreen(prim.c);
      return {
        kind: "circle",
        cx: runde(cx),
        cy: runde(cy),
        r: runde(prim.r * t.scale),
        dash: !!prim.dash,
      };
    }
    if (prim.k === "line") {
      const [x1, y1] = zuScreen(prim.a);
      const [x2, y2] = zuScreen(prim.b);
      return {
        kind: "line",
        x1: runde(x1),
        y1: runde(y1),
        x2: runde(x2),
        y2: runde(y2),
        dash: !!prim.dash,
      };
    }
    const points = prim.p
      .map(zuScreen)
      .map(([x, y]) => `${runde(x)},${runde(y)}`)
      .join(" ");
    return { kind: "poly", points, close: prim.close, dash: !!prim.dash };
  });
}
