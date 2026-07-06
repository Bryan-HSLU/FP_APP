/** Provisorische 3D-Möbel aus Primitiven (Box/Zylinder/Kugel).
 *
 * Ersetzt den nackten Box-Platzhalter durch erkennbare Kompositionen – ohne
 * neue Dependencies oder externe Assets. Jedes Kompositum bleibt **vollständig
 * innerhalb der Katalog-bbox w×d×h**: Die Bauteile werden im lokalen
 * Koordinatensystem der bisherigen Box beschrieben (Ursprung = Box-Mitte,
 * x∈[-w/2,w/2], y∈[-h/2,h/2], z∈[-d/2,d/2]). Die Pose (Position/Rotation) und
 * die Ampel-/Auswahl-Logik bleiben in `Viewer3D` und werden 1:1 über die
 * umschliessende Gruppe angewandt; `Moebel3D` liefert nur die Innengeometrie.
 *
 * Farben: Der Hauptkörper nutzt exakt die übergebene Ampel-/Basisfarbe. Akzente
 * werden nur daraus abgeleitet (heller/dunkler) – keine eigene Farblogik, die
 * die Ampel übersteuern würde.
 */

/** Material-/Basisfarbe je funktionsTyp für den 3D-Viewer (Bryans Möbel-
 *  Materialwunsch). WICHTIG: Nur wirksam, wenn die Norm-Ampel «ok» ist –
 *  knapp/verletzt/gesperrt behalten im Viewer3D ihre Statusfarben, die Ampel
 *  MUSS dominieren. Nicht kartierte Typen fallen auf Salbei zurück. */
export const MATERIAL_FARBE: Record<string, string> = {
  // Sanitär – Keramik-Hellton
  wc: "#EDEDE6",
  lavabo: "#EDEDE6",
  dusche: "#EDEDE6",
  badewanne: "#EDEDE6",
  spuele: "#EDEDE6",
  // Holz-Möbel – warmes gedämpftes Holz (CI-Orange-nah, entsättigt)
  esstisch: "#B9906B",
  couchtisch: "#B9906B",
  beistelltisch: "#B9906B",
  regal: "#B9906B",
  sideboard: "#B9906B",
  schrank: "#B9906B",
  badmoebel: "#B9906B",
  tvmoebel: "#B9906B",
  unterschrank: "#B9906B",
  hochschrank: "#B9906B",
  haengeschrank: "#B9906B",
  eckschrank: "#B9906B",
  fuellstueck: "#B9906B",
  // Polster – Salbei
  sofa: "#9BA494",
  // Geräte – Edelstahl
  kuehlschrank: "#B9BEBE",
  geschirrspueler: "#B9BEBE",
  kochfeld: "#B9BEBE",
  dunstabzug: "#B9BEBE",
  // Textil – Terracotta gedämpft
  teppich: "#C9A38A",
  badteppich: "#C9A38A",
  // Grün
  pflanze: "#6F8F6A",
};

/** Salbei-Fallback für alle nicht kartierten Typen (Spiegel, Leuchten, Deko …). */
export const MATERIAL_FALLBACK = "#9BA494";

/** Materialfarbe eines funktionsTyps oder Salbei-Fallback. */
export function materialFarbe(funktionsTyp: string): string {
  return MATERIAL_FARBE[funktionsTyp] ?? MATERIAL_FALLBACK;
}

/** Rolle eines Bauteils – steuert nur die Farbableitung, nie die Ampel. */
export type Rolle = "koerper" | "hell" | "dunkel" | "glas";

/** Ein Primitiv im lokalen Box-Koordinatensystem (Meter, Ursprung = Mitte). */
export type Teil =
  | { form: "box"; groesse: [number, number, number]; pos: [number, number, number]; rolle: Rolle }
  | {
      form: "zylinder";
      rTop: number;
      rBottom: number;
      hoehe: number;
      pos: [number, number, number];
      rolle: Rolle;
    }
  | { form: "kugel"; radius: number; pos: [number, number, number]; rolle: Rolle };

// Kurz-Konstruktoren, damit die Bauteil-Listen kompakt lesbar bleiben.
const box = (
  groesse: [number, number, number],
  pos: [number, number, number],
  rolle: Rolle,
): Teil => ({ form: "box", groesse, pos, rolle });

const zyl = (
  rTop: number,
  rBottom: number,
  hoehe: number,
  pos: [number, number, number],
  rolle: Rolle,
): Teil => ({ form: "zylinder", rTop, rBottom, hoehe, pos, rolle });

const kugel = (radius: number, pos: [number, number, number], rolle: Rolle): Teil => ({
  form: "kugel",
  radius,
  pos,
  rolle,
});

/**
 * Mischt eine #rrggbb-Farbe Richtung Weiss (faktor>0) oder Schwarz (faktor<0).
 * `faktor` ist der Mischanteil in [-1,1]. Unbekannte Formate bleiben unverändert.
 */
export function mischen(hex: string, faktor: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m?.[1]) return hex;
  const n = Number.parseInt(m[1], 16);
  const ziel = faktor >= 0 ? 255 : 0;
  const t = Math.min(1, Math.abs(faktor));
  const kanal = (c: number) =>
    Math.round(c + (ziel - c) * t)
      .toString(16)
      .padStart(2, "0");
  return `#${kanal((n >> 16) & 0xff)}${kanal((n >> 8) & 0xff)}${kanal(n & 0xff)}`;
}

/** Leitet die konkrete Bauteilfarbe aus der Ampel-/Basisfarbe ab. */
export function rolleFarbe(rolle: Rolle, farbe: string): string {
  switch (rolle) {
    case "koerper":
      return farbe;
    case "hell":
      return mischen(farbe, 0.22);
    case "dunkel":
      return mischen(farbe, -0.32);
    case "glas":
      return mischen(farbe, 0.4);
  }
}

// --- Bauteil-Bausätze je funktionsTyp -------------------------------------
// Alle Masse als Bruchteile von w/d/h, damit jede Katalog-Grösse passt und die
// Teile die bbox nie verlassen (durch passtInBbox im Test abgesichert).

type Bauer = (w: number, d: number, h: number) => Teil[];

const wc: Bauer = (w, d, h) => [
  box([w, h * 0.5, d * 0.8], [0, -h / 2 + h * 0.25, d * 0.05], "koerper"),
  box([w * 0.95, h * 0.08, d * 0.8], [0, -h / 2 + h * 0.54, d * 0.05], "hell"),
  box([w * 0.9, h * 0.42, d * 0.25], [0, h / 2 - h * 0.21, -d / 2 + d * 0.125], "koerper"),
];

const lavabo: Bauer = (w, d, h) => {
  const r = Math.min(w, d);
  return [
    zyl(r * 0.16, r * 0.2, h * 0.65, [0, -h / 2 + h * 0.325, 0], "koerper"),
    box([w, h * 0.28, d], [0, h / 2 - h * 0.14, 0], "hell"),
    box([w * 0.7, h * 0.06, d * 0.7], [0, h / 2 - h * 0.05, 0], "dunkel"),
  ];
};

const dusche: Bauer = (w, d, h) => [
  box([w, h * 0.05, d], [0, -h / 2 + h * 0.025, 0], "koerper"),
  box([w * 0.04, h * 0.9, d * 0.98], [w / 2 - w * 0.02, 0, 0], "glas"),
  box([w * 0.98, h * 0.9, d * 0.04], [0, 0, d / 2 - d * 0.02], "glas"),
];

const badewanne: Bauer = (w, d, h) => [
  box([w, h * 0.9, d], [0, -h / 2 + h * 0.45, 0], "koerper"),
  box([w, h * 0.12, d], [0, h / 2 - h * 0.06, 0], "hell"),
  box([w * 0.82, h * 0.05, d * 0.78], [0, h / 2 - h * 0.13, 0], "dunkel"),
];

const spiegel: Bauer = (w, d, h) => [
  box([w, h, d * 0.5], [0, 0, -d * 0.25], "dunkel"),
  box([w * 0.92, h * 0.92, d * 0.4], [0, 0, d * 0.05], "hell"),
];

const schrank: Bauer = (w, d, h) => [
  box([w, h, d], [0, 0, 0], "koerper"),
  box([w * 0.015, h * 0.92, d * 0.02], [0, 0, d / 2 - d * 0.01], "dunkel"),
  box([w * 0.03, h * 0.12, d * 0.04], [-w * 0.12, h * 0.25, d / 2 - d * 0.02], "dunkel"),
  box([w * 0.03, h * 0.12, d * 0.04], [w * 0.12, h * 0.25, d / 2 - d * 0.02], "dunkel"),
];

const handtuchstange: Bauer = (w, d, h) => [
  box([w * 0.96, h * 0.12, d * 0.25], [0, 0, d / 2 - d * 0.15], "hell"),
  box([w * 0.04, h * 0.2, d * 0.4], [-w * 0.44, 0, d / 2 - d * 0.25], "dunkel"),
  box([w * 0.04, h * 0.2, d * 0.4], [w * 0.44, 0, d / 2 - d * 0.25], "dunkel"),
];

const handtuchheizung: Bauer = (w, d, h) => [
  box([w, h, d * 0.5], [0, 0, -d * 0.15], "koerper"),
  ...Array.from({ length: 5 }, (_, i) =>
    box([w * 0.9, h * 0.05, d * 0.6], [0, -h * 0.4 + i * (h * 0.8) * 0.25, d * 0.05], "hell"),
  ),
];

// Waschtisch-Unterschrank / generisches Badmöbel.
const badmoebel: Bauer = (w, d, h) => [
  box([w, h * 0.82, d], [0, -h / 2 + h * 0.41, 0], "koerper"),
  box([w, h * 0.08, d], [0, h / 2 - h * 0.04, 0], "dunkel"),
  box([w * 0.012, h * 0.7, d * 0.02], [-w * 0.2, -h * 0.05, d / 2 - d * 0.01], "dunkel"),
  box([w * 0.012, h * 0.7, d * 0.02], [w * 0.2, -h * 0.05, d / 2 - d * 0.01], "dunkel"),
];

// Flache Matte (Teppich/Badteppich): sehr niedrig, mit dezenter Musterfläche.
const matte: Bauer = (w, d, h) => [
  box([w, h * 0.6, d], [0, -h / 2 + h * 0.3, 0], "koerper"),
  box([w * 0.82, h * 0.55, d * 0.82], [0, h / 2 - h * 0.275, 0], "hell"),
];

const sofa: Bauer = (w, d, h) => [
  box([w, h * 0.4, d], [0, -h / 2 + h * 0.2, 0], "koerper"),
  box([w * 0.78, h * 0.18, d * 0.8], [0, -h / 2 + h * 0.49, d * 0.06], "hell"),
  box([w, h * 0.55, d * 0.22], [0, h / 2 - h * 0.275, -d / 2 + d * 0.11], "koerper"),
  box([w * 0.12, h * 0.6, d], [-w / 2 + w * 0.06, -h / 2 + h * 0.3, 0], "koerper"),
  box([w * 0.12, h * 0.6, d], [w / 2 - w * 0.06, -h / 2 + h * 0.3, 0], "koerper"),
];

// Tisch mit Platte + 4 Beinen (Ess-/Couch-/Beistelltisch teilen die Form).
const tisch: Bauer = (w, d, h) => {
  const bx = w / 2 - w * 0.06;
  const bz = d / 2 - d * 0.06;
  const bein = (x: number, z: number): Teil =>
    box([w * 0.06, h * 0.9, d * 0.06], [x, -h / 2 + h * 0.45, z], "dunkel");
  return [
    box([w, h * 0.09, d], [0, h / 2 - h * 0.045, 0], "koerper"),
    bein(-bx, -bz),
    bein(bx, -bz),
    bein(-bx, bz),
    bein(bx, bz),
  ];
};

const regal: Bauer = (w, d, h) => [
  box([w * 0.05, h, d], [-w / 2 + w * 0.025, 0, 0], "koerper"),
  box([w * 0.05, h, d], [w / 2 - w * 0.025, 0, 0], "koerper"),
  box([w, h, d * 0.05], [0, 0, -d / 2 + d * 0.025], "dunkel"),
  ...Array.from({ length: 4 }, (_, i) =>
    box([w * 0.9, h * 0.04, d * 0.9], [0, -h / 2 + h * 0.03 + i * (h * 0.94) * (1 / 3), 0], "hell"),
  ),
];

const sideboard: Bauer = (w, d, h) => {
  const fx = w / 2 - w * 0.05;
  const fz = d / 2 - d * 0.1;
  const fuss = (x: number, z: number): Teil =>
    box([w * 0.05, h * 0.15, d * 0.1], [x, -h / 2 + h * 0.075, z], "dunkel");
  return [
    box([w, h * 0.85, d], [0, -h / 2 + h * 0.15 + h * 0.425, 0], "koerper"),
    box([w * 0.012, h * 0.7, d * 0.02], [-w / 6, h * 0.1, d / 2 - d * 0.01], "dunkel"),
    box([w * 0.012, h * 0.7, d * 0.02], [w / 6, h * 0.1, d / 2 - d * 0.01], "dunkel"),
    fuss(-fx, -fz),
    fuss(fx, -fz),
    fuss(-fx, fz),
    fuss(fx, fz),
  ];
};

const stehleuchte: Bauer = (w, d, h) => {
  const r = Math.min(w, d);
  return [
    zyl(r * 0.35, r * 0.4, h * 0.02, [0, -h / 2 + h * 0.01, 0], "dunkel"),
    zyl(r * 0.05, r * 0.05, h * 0.7, [0, -h / 2 + h * 0.35, 0], "dunkel"),
    zyl(r * 0.45, r * 0.28, h * 0.2, [0, h / 2 - h * 0.1, 0], "hell"),
  ];
};

const pflanze: Bauer = (w, d, h) => {
  const r = Math.min(w, d);
  const rL = Math.min(r * 0.45, h * 0.28);
  return [
    zyl(r * 0.32, r * 0.24, h * 0.32, [0, -h / 2 + h * 0.16, 0], "dunkel"),
    kugel(rL, [0, h / 2 - rL, 0], "koerper"),
    kugel(rL * 0.6, [0, h / 2 - rL, 0], "hell"),
  ];
};

const wandbild: Bauer = (w, d, h) => [
  box([w, h, d], [0, 0, 0], "koerper"),
  box([w * 0.86, h * 0.86, d * 0.6], [0, 0, d * 0.2], "hell"),
];

const wandleuchte: Bauer = (w, d, h) => [
  box([w * 0.5, h * 0.5, d * 0.5], [0, 0, -d * 0.25], "koerper"),
  box([w, h * 0.3, d * 0.5], [0, -h * 0.1, d * 0.1], "hell"),
];

const tvmoebel: Bauer = (w, d, h) => [
  box([w, h * 0.42, d], [0, -h / 2 + h * 0.21, 0], "koerper"),
  box([w * 0.8, h * 0.5, d * 0.08], [0, -h / 2 + h * 0.67, -d / 2 + d * 0.12], "dunkel"),
  box([w * 0.1, h * 0.06, d * 0.15], [0, -h / 2 + h * 0.45, -d / 2 + d * 0.12], "dunkel"),
];

const unterschrank: Bauer = (w, d, h) => [
  box([w, h * 0.86, d], [0, -h / 2 + h * 0.49, 0], "koerper"),
  box([w, h * 0.08, d], [0, h / 2 - h * 0.04, 0], "dunkel"),
  box([w * 0.94, h * 0.06, d * 0.9], [0, -h / 2 + h * 0.03, 0], "dunkel"),
  box([w * 0.5, h * 0.03, d * 0.03], [0, h / 2 - h * 0.12, d / 2 - d * 0.015], "hell"),
  box([w * 0.012, h * 0.7, d * 0.02], [0, -h * 0.05, d / 2 - d * 0.01], "dunkel"),
];

const hochschrank: Bauer = (w, d, h) => [
  box([w, h * 0.94, d], [0, -h / 2 + h * 0.53, 0], "koerper"),
  box([w * 0.94, h * 0.06, d * 0.9], [0, -h / 2 + h * 0.03, 0], "dunkel"),
  box([w * 0.98, h * 0.012, d * 0.02], [0, h * 0.05, d / 2 - d * 0.01], "dunkel"),
  box([w * 0.5, h * 0.03, d * 0.03], [0, h * 0.12, d / 2 - d * 0.015], "hell"),
  box([w * 0.5, h * 0.03, d * 0.03], [0, -h * 0.02, d / 2 - d * 0.015], "hell"),
];

const haengeschrank: Bauer = (w, d, h) => [
  box([w, h, d], [0, 0, 0], "koerper"),
  box([w * 0.012, h * 0.92, d * 0.02], [0, 0, d / 2 - d * 0.01], "dunkel"),
  box([w * 0.5, h * 0.03, d * 0.03], [0, -h / 2 + h * 0.12, d / 2 - d * 0.015], "hell"),
];

const spuele: Bauer = (w, d, h) => [
  box([w, h, d], [0, 0, 0], "koerper"),
  box([w * 0.72, h * 0.12, d * 0.72], [0, h / 2 - h * 0.06, 0], "dunkel"),
];

const kochfeld: Bauer = (w, d, h) => {
  const r = Math.min(w, d) * 0.16;
  const platte = (x: number, z: number): Teil =>
    zyl(r, r, h * 0.03, [x, h / 2 - h * 0.09, z], "dunkel");
  return [
    box([w, h * 0.9, d], [0, -h / 2 + h * 0.45, 0], "koerper"),
    box([w * 0.96, h * 0.1, d * 0.96], [0, h / 2 - h * 0.05, 0], "dunkel"),
    platte(-w * 0.22, -d * 0.22),
    platte(w * 0.22, -d * 0.22),
    platte(-w * 0.22, d * 0.22),
    platte(w * 0.22, d * 0.22),
  ];
};

const kuehlschrank: Bauer = (w, d, h) => [
  box([w, h, d], [0, 0, 0], "koerper"),
  box([w * 0.98, h * 0.015, d * 0.02], [0, h * 0.18, d / 2 - d * 0.01], "dunkel"),
  box([w * 0.04, h * 0.5, d * 0.03], [w / 2 - w * 0.08, -h * 0.1, d / 2 - d * 0.015], "hell"),
  box([w * 0.04, h * 0.2, d * 0.03], [w / 2 - w * 0.08, h * 0.32, d / 2 - d * 0.015], "hell"),
];

const geschirrspueler: Bauer = (w, d, h) => [
  box([w, h, d], [0, 0, 0], "koerper"),
  box([w, h * 0.12, d * 0.06], [0, h / 2 - h * 0.06, d / 2 - d * 0.03], "dunkel"),
  box([w * 0.9, h * 0.8, d * 0.03], [0, -h * 0.05, d / 2 - d * 0.015], "hell"),
];

const dunstabzug: Bauer = (w, d, h) => [
  box([w, h, d], [0, 0, 0], "koerper"),
  box([w * 0.7, h * 0.2, d * 0.5], [0, -h / 2 + h * 0.1, d / 2 - d * 0.25], "dunkel"),
];

const eckschrank: Bauer = (w, d, h) => [
  box([w, h * 0.86, d], [0, -h / 2 + h * 0.43, 0], "koerper"),
  box([w, h * 0.08, d], [0, h / 2 - h * 0.04, 0], "dunkel"),
  box([w * 0.012, h * 0.7, d * 0.02], [0, -h * 0.05, d / 2 - d * 0.01], "dunkel"),
];

const fuellstueck: Bauer = (w, d, h) => [
  box([w, h, d], [0, 0, 0], "koerper"),
  box([w * 0.3, h, d * 0.05], [0, 0, d / 2 - d * 0.025], "dunkel"),
];

const deko: Bauer = (w, d, h) => {
  const r = Math.min(Math.min(w, d) * 0.45, h * 0.45);
  return [
    box([w * 0.7, h * 0.3, d * 0.7], [0, -h / 2 + h * 0.15, 0], "dunkel"),
    kugel(r, [0, h / 2 - r, 0], "hell"),
  ];
};

/** funktionsTyp → Bauteil-Bausatz. Fehlt ein Typ, greift der Box-Fallback. */
const BAUSAETZE: Record<string, Bauer> = {
  // Bad
  wc,
  lavabo,
  dusche,
  badewanne,
  spiegel,
  schrank,
  handtuchstange,
  handtuchheizung,
  badmoebel,
  badteppich: matte,
  // Wohnen
  sofa,
  esstisch: tisch,
  couchtisch: tisch,
  beistelltisch: tisch,
  regal,
  sideboard,
  stehleuchte,
  teppich: matte,
  pflanze,
  wandbild,
  wandleuchte,
  tvmoebel,
  deko,
  // Küche
  unterschrank,
  hochschrank,
  haengeschrank,
  spuele,
  kochfeld,
  kuehlschrank,
  geschirrspueler,
  dunstabzug,
  eckschrank,
  fuellstueck,
};

/**
 * Liefert die Primitiv-Bauteile für einen funktionsTyp. Unbekannte Typen fallen
 * auf die bisherige einfache Box (volle bbox, Hauptkörperfarbe) zurück – damit
 * bleibt das Verhalten für nicht abgedeckte Items unverändert.
 */
export function bauteile(funktionsTyp: string, w: number, d: number, h: number): Teil[] {
  const bauer = BAUSAETZE[funktionsTyp];
  return bauer ? bauer(w, d, h) : [box([w, h, d], [0, 0, 0], "koerper")];
}

/**
 * Prüft, ob alle Bauteile vollständig innerhalb der bbox w×d×h liegen
 * (Ursprung = Mitte). Reine Geometrie-Invariante – im Test genutzt, um die
 * bbox-Treue jedes Bausatzes abzusichern.
 */
export function passtInBbox(teile: Teil[], w: number, d: number, h: number, eps = 1e-9): boolean {
  const drin = (mitte: number, halb: number, grenze: number) =>
    mitte - halb >= -grenze - eps && mitte + halb <= grenze + eps;
  return teile.every((t) => {
    if (t.form === "box") {
      const [gx, gy, gz] = t.groesse;
      return (
        drin(t.pos[0], gx / 2, w / 2) &&
        drin(t.pos[1], gy / 2, h / 2) &&
        drin(t.pos[2], gz / 2, d / 2)
      );
    }
    if (t.form === "zylinder") {
      const r = Math.max(t.rTop, t.rBottom);
      return (
        drin(t.pos[0], r, w / 2) && drin(t.pos[1], t.hoehe / 2, h / 2) && drin(t.pos[2], r, d / 2)
      );
    }
    return (
      drin(t.pos[0], t.radius, w / 2) &&
      drin(t.pos[1], t.radius, h / 2) &&
      drin(t.pos[2], t.radius, d / 2)
    );
  });
}

/** Rendert ein einzelnes Bauteil als Mesh (lokale Koordinaten der Gruppe). */
function TeilMesh({ teil, farbe }: { teil: Teil; farbe: string }) {
  const farbwert = rolleFarbe(teil.rolle, farbe);
  const glas = teil.rolle === "glas";
  const material = (
    <meshStandardMaterial color={farbwert} transparent={glas} opacity={glas ? 0.28 : 1} />
  );
  if (teil.form === "box") {
    return (
      <mesh position={teil.pos}>
        <boxGeometry args={teil.groesse} />
        {material}
      </mesh>
    );
  }
  if (teil.form === "zylinder") {
    return (
      <mesh position={teil.pos}>
        <cylinderGeometry args={[teil.rTop, teil.rBottom, teil.hoehe, 20]} />
        {material}
      </mesh>
    );
  }
  return (
    <mesh position={teil.pos}>
      <sphereGeometry args={[teil.radius, 16, 12]} />
      {material}
    </mesh>
  );
}

/**
 * Provisorisches Möbelstück aus Primitiven. Erwartet, dass die umschliessende
 * Gruppe (in `Viewer3D`) Pose und Auswahl-/Klick-Handling trägt; hier entsteht
 * ausschliesslich die Innengeometrie innerhalb der bbox w×d×h.
 */
export function Moebel3D({
  funktionsTyp,
  w,
  d,
  h,
  farbe,
}: {
  funktionsTyp: string;
  w: number;
  d: number;
  h: number;
  farbe: string;
}) {
  const teile = bauteile(funktionsTyp, w, d, h);
  return (
    <>
      {teile.map((teil, i) => (
        <TeilMesh key={i} teil={teil} farbe={farbe} />
      ))}
    </>
  );
}
