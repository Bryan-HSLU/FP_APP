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
 *
 * Varianten: Ein funktionsTyp kann mehrere 3D-Bausätze tragen (z.B. mehrere
 * WCs). Das Katalog-Item wählt per Feld `modell3d` eine registrierte Variante;
 * die Auflösung Variante→Bausatz macht {@link bausatzSchluessel}. Anleitung
 * «Neue Variante hinzufügen in 3 Schritten» steht dort im Docstring.
 */

import { RoundedBox } from "@react-three/drei";
import { Vector2 } from "three";

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
  urinal: "#EDEDE6",
  bidet: "#EDEDE6",
  // Holz-Möbel – warmes gedämpftes Holz (CI-Orange-nah, entsättigt)
  esstisch: "#B9906B",
  couchtisch: "#B9906B",
  beistelltisch: "#B9906B",
  regal: "#B9906B",
  sideboard: "#B9906B",
  schrank: "#B9906B",
  kleiderschrank: "#B9906B",
  badmoebel: "#B9906B",
  tvmoebel: "#B9906B",
  unterschrank: "#B9906B",
  hochschrank: "#B9906B",
  haengeschrank: "#B9906B",
  eckschrank: "#B9906B",
  fuellstueck: "#B9906B",
  bett: "#B9906B",
  einzelbett: "#B9906B",
  doppelbett: "#B9906B",
  kinderbett: "#B9906B",
  schreibtisch: "#B9906B",
  stuhl: "#B9906B",
  buerostuhl: "#B9906B",
  esstischstuhl: "#B9906B",
  hocker: "#B9906B",
  nachttisch: "#B9906B",
  kommode: "#B9906B",
  // Polster – Salbei
  sofa: "#9BA494",
  sessel: "#9BA494",
  // Geräte – Edelstahl
  kuehlschrank: "#B9BEBE",
  geschirrspueler: "#B9BEBE",
  kochfeld: "#B9BEBE",
  dunstabzug: "#B9BEBE",
  backofen: "#B9BEBE",
  mikrowelle: "#B9BEBE",
  waschmaschine: "#B9BEBE",
  tumbler: "#B9BEBE",
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

/**
 * Rolle eines Bauteils – steuert Farbableitung UND Materialwirkung
 * (metalness/roughness/opacity), nie aber die Ampel. `chrom` ist neu für
 * Armaturen/Griffe (poliertes Metall). Die Basisfarbe kommt weiter aus
 * `rolleFarbe`/Ampel; die Rolle legt nur die Oberflächen-Physik fest.
 */
export type Rolle = "koerper" | "hell" | "dunkel" | "glas" | "chrom";

/**
 * Ein Primitiv im lokalen Box-Koordinatensystem (Meter, Ursprung = Mitte).
 *
 * Grundformen `box|zylinder|kugel` sind unverändert. Für höhere Volumetrie /
 * gerundete Keramik kamen additiv hinzu:
 * - `rundbox`  – Box mit gerundeten Kanten (drei `RoundedBox`), `radius` in Metern.
 * - `lathe`    – Rotationskörper aus einem 2D-Profil (Keramik-Rundungen). Das
 *                Profil ist eine Liste `[radius, y]`-Punkte; `y` ist relativ zu
 *                `pos` (Rotationsachse = Y). Bounding = max-Radius × (yMax−yMin).
 * - `torus`    – Ring (Ablauf, Rosette, gebogener Auslauf). `achse` = die Achse,
 *                zu der die Ring-Ebene senkrecht steht (`y` = flach liegend).
 * Alle neuen Formen werden von {@link passtInBbox}/{@link clampTeil} erfasst.
 */
export type Teil =
  | { form: "box"; groesse: [number, number, number]; pos: [number, number, number]; rolle: Rolle }
  | {
      form: "rundbox";
      groesse: [number, number, number];
      pos: [number, number, number];
      radius: number;
      rolle: Rolle;
    }
  | {
      form: "zylinder";
      rTop: number;
      rBottom: number;
      hoehe: number;
      pos: [number, number, number];
      rolle: Rolle;
    }
  | { form: "kugel"; radius: number; pos: [number, number, number]; rolle: Rolle }
  | {
      form: "lathe";
      profil: [number, number][];
      segmente: number;
      pos: [number, number, number];
      rolle: Rolle;
    }
  | {
      form: "torus";
      radius: number;
      roehre: number;
      achse: "x" | "y" | "z";
      pos: [number, number, number];
      rolle: Rolle;
    };

// Kurz-Konstruktoren, damit die Bauteil-Listen kompakt lesbar bleiben.
const box = (
  groesse: [number, number, number],
  pos: [number, number, number],
  rolle: Rolle,
): Teil => ({ form: "box", groesse, pos, rolle });

const rbox = (
  groesse: [number, number, number],
  pos: [number, number, number],
  radius: number,
  rolle: Rolle,
): Teil => ({ form: "rundbox", groesse, pos, radius, rolle });

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

/** Rotationskörper: Profil = `[radius, y]`-Punkte (y relativ zu `pos`, Achse Y). */
const drehteil = (
  profil: [number, number][],
  pos: [number, number, number],
  rolle: Rolle,
  segmente = 24,
): Teil => ({ form: "lathe", profil, pos, rolle, segmente });

/** Ring/Torus. `achse` = Achse senkrecht zur Ring-Ebene (`y` = flach liegend). */
const ring = (
  radius: number,
  roehre: number,
  achse: "x" | "y" | "z",
  pos: [number, number, number],
  rolle: Rolle,
): Teil => ({ form: "torus", radius, roehre, achse, pos, rolle });

/** Halb-Ausdehnungen [x,y,z] eines Torus – abhängig von der Ring-Achse. */
function torusHalb(
  radius: number,
  roehre: number,
  achse: "x" | "y" | "z",
): [number, number, number] {
  const gross = radius + roehre;
  if (achse === "y") return [gross, roehre, gross];
  if (achse === "x") return [roehre, gross, gross];
  return [gross, gross, roehre];
}

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
    case "chrom":
      // Poliertes Metall: heller neutraler Ton; der Chrom-Look entsteht v.a.
      // über metalness/roughness im Material (siehe teilMaterial). Bleibt aus
      // der Ampel-/Basisfarbe abgeleitet, damit der Status weiter dominiert.
      return mischen(farbe, 0.52);
  }
}

// --- Bauteil-Bausätze je funktionsTyp -------------------------------------
// Alle Masse als Bruchteile von w/d/h, damit jede Katalog-Grösse passt und die
// Teile die bbox nie verlassen (durch passtInBbox im Test abgesichert).

type Bauer = (w: number, d: number, h: number) => Teil[];

// ═══════════════════════════════════════════════════════════════════
// BAD
// ═══════════════════════════════════════════════════════════════════

// WC (bodenstehend): gerundeter Keramikkörper (rundbox), Sitzbrille + Deckel,
// Spülkasten mit gerundeten Kanten, Chrom-Drücker, Fussübergang zum Boden.
const wc: Bauer = (w, d, h) => {
  const rr = Math.min(w, d) * 0.12; // Rundungsradius der Keramik
  return [
    // Standfuss/Sockel zum Boden (verjüngter Übergang)
    rbox([w * 0.44, h * 0.5, d * 0.42], [0, -h / 2 + h * 0.25, d * 0.05], rr, "koerper"),
    // Keramik-Schüssel (gerundeter Hauptkörper)
    rbox([w * 0.82, h * 0.28, d * 0.66], [0, -h / 2 + h * 0.53, d * 0.09], rr, "koerper"),
    // Sitzbrille (heller Ring)
    rbox([w * 0.82, h * 0.05, d * 0.62], [0, -h / 2 + h * 0.68, d * 0.1], rr * 0.5, "hell"),
    // Sitzdeckel (leicht abgesetzt, dunkler)
    rbox([w * 0.8, h * 0.045, d * 0.6], [0, -h / 2 + h * 0.72, d * 0.1], rr * 0.5, "dunkel"),
    // Spülkasten (gerundete Kanten)
    rbox([w * 0.8, h * 0.4, d * 0.24], [0, h / 2 - h * 0.24, -d / 2 + d * 0.14], rr, "koerper"),
    // Spülkasten-Deckel
    rbox(
      [w * 0.84, h * 0.05, d * 0.28],
      [0, h / 2 - h * 0.03, -d / 2 + d * 0.15],
      rr * 0.4,
      "hell",
    ),
    // Drücker (Chrom)
    rbox(
      [w * 0.16, h * 0.03, d * 0.07],
      [0, h / 2 - h * 0.02, -d / 2 + d * 0.15],
      w * 0.02,
      "chrom",
    ),
  ];
};

// Lavabo (Standsäule): geschwungene Keramik-Säule (Rotationskörper), gerundeter
// Waschtisch mit runder Beckenschale (Rotationskörper) + sichtbarer Vertiefung,
// Chrom-Armatur mit Rosette, Auslauf und gebogenem Bogen (Torus), Chrom-Ablauf.
const lavabo: Bauer = (w, d, h) => {
  const r0 = Math.min(w, d);
  const rr = r0 * 0.1;
  return [
    // Keramik-Säule (Rotationskörper: breiter Fuss, schlanke Taille, Flare oben)
    drehteil(
      [
        [r0 * 0.2, -h * 0.39],
        [r0 * 0.15, -h * 0.26],
        [r0 * 0.11, -h * 0.05],
        [r0 * 0.14, h * 0.24],
        [r0 * 0.2, h * 0.39],
      ],
      [0, -h * 0.11, d * 0.02],
      "koerper",
    ),
    // Waschtisch-/Beckenkörper (gerundet, breit)
    rbox([w * 0.96, h * 0.16, d * 0.9], [0, h / 2 - h * 0.14, 0], rr, "hell"),
    // Beckenschale-Vertiefung (Rotationskörper, dunkle Innenmulde)
    drehteil(
      [
        [0, -h * 0.13],
        [r0 * 0.18, -h * 0.11],
        [r0 * 0.32, -h * 0.04],
        [r0 * 0.36, -h * 0.005],
      ],
      [0, h / 2 - h * 0.055, 0],
      "dunkel",
    ),
    // Ablauf (Chrom-Ring)
    ring(r0 * 0.05, r0 * 0.014, "y", [0, h / 2 - h * 0.17, 0], "chrom"),
    // Armatur-Rosette (Chrom-Ring auf der Platte, hinten)
    ring(r0 * 0.07, r0 * 0.02, "y", [0, h / 2 - h * 0.05, -d * 0.33], "chrom"),
    // Armatur-Körper (Chrom, vertikal)
    zyl(w * 0.03, w * 0.035, h * 0.14, [0, h / 2 - h * 0.11, -d * 0.33], "chrom"),
    // Gebogener Auslauf (Chrom-Torus, achse x = Bogen in der y/z-Ebene)
    ring(d * 0.11, w * 0.028, "x", [0, h / 2 - h * 0.04 - d * 0.11, -d * 0.22], "chrom"),
    // Einhebel-Mischer (Chrom)
    rbox(
      [w * 0.12, h * 0.03, d * 0.05],
      [w * 0.08, h / 2 - h * 0.03, -d * 0.31],
      w * 0.015,
      "chrom",
    ),
  ];
};

// Dusche: Duschtasse mit gerundetem Rand, 2 echte Glaswände (transparent),
// Chrom-Eckpfosten + Türgriff, Chrom-Brausestange mit Thermostat, Regen-
// Duschkopf (flacher Chrom-Teller mit Ring) und angedeutete Handbrause.
const dusche: Bauer = (w, d, h) => {
  const r0 = Math.min(w, d);
  const rr = r0 * 0.08;
  return [
    // Duschtasse (gerundeter Rand)
    rbox([w * 0.98, h * 0.07, d * 0.98], [0, -h / 2 + h * 0.035, 0], rr, "koerper"),
    // Tasse-Innenfläche (leicht vertieft, hell)
    rbox([w * 0.86, h * 0.03, d * 0.86], [0, -h / 2 + h * 0.06, 0], rr * 0.6, "hell"),
    // Ablauf (Chrom-Ring)
    ring(r0 * 0.06, r0 * 0.018, "y", [0, -h / 2 + h * 0.07, 0], "chrom"),
    // Glaswand rechts (+x) – echt transparent
    box([w * 0.03, h * 0.86, d * 0.94], [w / 2 - w * 0.015, h * 0.02, 0], "glas"),
    // Glaswand vorne (+z) – echt transparent
    box([w * 0.94, h * 0.86, d * 0.03], [0, h * 0.02, d / 2 - d * 0.015], "glas"),
    // Eckpfosten (Chrom) vorne-rechts – verbindet die Glaswände über Eck
    zyl(w * 0.022, w * 0.022, h * 0.9, [w / 2 - w * 0.022, h * 0.02, d / 2 - d * 0.022], "chrom"),
    // Türgriff (Chrom, vertikale Stange an der Frontscheibe)
    zyl(w * 0.012, w * 0.012, h * 0.3, [w * 0.18, h * 0.06, d / 2 - d * 0.045], "chrom"),
    // Vertikale Brausestange (Chrom) an der Rückwand
    zyl(w * 0.018, w * 0.018, h * 0.5, [-w * 0.36, h * 0.12, -d / 2 + d * 0.04], "chrom"),
    // Thermostat/Armatur (Chrom, gerundet) unten an der Rückwand
    rbox(
      [w * 0.18, h * 0.06, d * 0.05],
      [-w * 0.36, -h * 0.08, -d / 2 + d * 0.05],
      w * 0.02,
      "chrom",
    ),
    // Handbrause an der Stange (Chrom)
    zyl(w * 0.03, w * 0.02, h * 0.11, [-w * 0.31, h * 0.06, -d / 2 + d * 0.05], "chrom"),
    // Auslegerarm zum Regenkopf (Chrom, von der Rückwand nach vorne)
    box([w * 0.04, h * 0.025, d * 0.28], [-w * 0.14, h / 2 - h * 0.06, -d / 2 + d * 0.18], "chrom"),
    // Regen-Duschkopf (flacher Chrom-Teller)
    zyl(r0 * 0.19, r0 * 0.19, h * 0.02, [-w * 0.14, h / 2 - h * 0.09, -d * 0.14], "chrom"),
    // Regenkopf-Rand (Chrom-Ring als Fassung)
    ring(r0 * 0.19, r0 * 0.016, "y", [-w * 0.14, h / 2 - h * 0.1, -d * 0.14], "chrom"),
  ];
};

// Badewanne: gerundete Wanne (rundbox) mit Rand, dunkler Innenvertiefung,
// Chrom-Ablauf, Chrom-Armatur mit gebogenem Auslauf (Torus) und 4 Chrom-Füssen.
const badewanne: Bauer = (w, d, h) => {
  const rc = Math.min(w, d);
  const rr = rc * 0.16;
  return [
    // Wannenkörper (gerundet)
    rbox([w * 0.98, h * 0.86, d * 0.96], [0, -h / 2 + h * 0.46, 0], rr, "koerper"),
    // Oberer Rand (gerundet, hell)
    rbox([w, h * 0.14, d], [0, h / 2 - h * 0.07, 0], rr, "hell"),
    // Innenvertiefung (dunkle Mulde)
    rbox([w * 0.84, h * 0.6, d * 0.78], [0, h / 2 - h * 0.42, 0], rr * 0.7, "dunkel"),
    // Ablauf (Chrom-Ring) an einem Ende
    ring(rc * 0.05, rc * 0.015, "y", [w * 0.36, h / 2 - h * 0.14, 0], "chrom"),
    // Armatur-Sockel (Chrom) am -x-Ende hinten
    rbox(
      [w * 0.1, h * 0.06, d * 0.14],
      [-w * 0.4, h / 2 - h * 0.05, -d * 0.28],
      rc * 0.02,
      "chrom",
    ),
    // Armatur-Körper (Chrom, vertikal)
    zyl(
      w * 0.022,
      w * 0.026,
      h * 0.16,
      [-w * 0.4, h / 2 - h * 0.05 + h * 0.08, -d * 0.28],
      "chrom",
    ),
    // Gebogener Auslauf (Chrom-Torus, Bogen in der y/z-Ebene)
    ring(
      d * 0.1,
      w * 0.02,
      "x",
      [-w * 0.4, h / 2 - h * 0.05 + h * 0.14 - d * 0.1, -d * 0.16],
      "chrom",
    ),
    // 4 Chrom-Füsse
    zyl(w * 0.025, w * 0.032, h * 0.1, [-w * 0.42, -h / 2 + h * 0.05, -d * 0.4], "chrom"),
    zyl(w * 0.025, w * 0.032, h * 0.1, [w * 0.42, -h / 2 + h * 0.05, -d * 0.4], "chrom"),
    zyl(w * 0.025, w * 0.032, h * 0.1, [-w * 0.42, -h / 2 + h * 0.05, d * 0.4], "chrom"),
    zyl(w * 0.025, w * 0.032, h * 0.1, [w * 0.42, -h / 2 + h * 0.05, d * 0.4], "chrom"),
  ];
};

// Spiegel (wandhängend): gerundeter Rahmen (rundbox), echte Glas-/Spiegelfläche,
// schmale Ablage unten. Rückseite an der Wand (-z).
const spiegel: Bauer = (w, d, h) => {
  const rr = Math.min(w, h) * 0.05;
  return [
    // Rahmen (gerundet), an der Wand
    rbox([w, h, d * 0.5], [0, 0, -d * 0.24], rr, "dunkel"),
    // Spiegelfläche (echtes Glas), leicht vor dem Rahmen
    box([w * 0.9, h * 0.9, d * 0.12], [0, h * 0.03, d * 0.02], "glas"),
    // schmale Ablage unten (gerundet, hell)
    rbox([w * 0.86, h * 0.05, d * 0.6], [0, -h / 2 + h * 0.025, d * 0.05], rr * 0.4, "hell"),
  ];
};

// Badmöbel (Waschtisch-Unterschrank): gerundeter Korpus, 2 Schubladen mit Fugen,
// Chrom-Griffe, zurückgesetzter Sockel, helle Abdeckplatte.
const badmoebel: Bauer = (w, d, h) => {
  const rr = Math.min(w, d) * 0.06;
  return [
    // Korpus (gerundete Kanten)
    rbox([w, h * 0.82, d], [0, -h / 2 + h * 0.45, 0], rr, "koerper"),
    // Abdeckplatte (Waschtischplatte, hell)
    rbox([w, h * 0.08, d], [0, h / 2 - h * 0.04, 0], rr * 0.6, "hell"),
    // Sockel zurückgesetzt (dunkel)
    box([w * 0.9, h * 0.06, d * 0.86], [0, -h / 2 + h * 0.03, 0], "dunkel"),
    // Fuge zwischen den 2 Schubladen
    box([w * 0.94, h * 0.012, d * 0.02], [0, -h * 0.06, d / 2 - d * 0.01], "dunkel"),
    // Fuge oberer Schubladenabschluss
    box([w * 0.94, h * 0.012, d * 0.02], [0, h * 0.2, d / 2 - d * 0.01], "dunkel"),
    // Chrom-Griff obere Schublade
    box([w * 0.34, h * 0.02, d * 0.03], [0, h * 0.07, d / 2 - d * 0.015], "chrom"),
    // Chrom-Griff untere Schublade
    box([w * 0.34, h * 0.02, d * 0.03], [0, -h * 0.2, d / 2 - d * 0.015], "chrom"),
  ];
};

// Handtuchstange: 2 Chrom-Wandhalter + Chrom-Stange + weich hängendes Tuch.
// Cylinder-Achse ist Y, daher horizontale Stange/Halter als schlanke Boxen.
const handtuchstange: Bauer = (w, d, h) => [
  // Wandhalter links (Chrom, ragt nach vorne)
  box([w * 0.04, h * 0.06, d * 0.7], [-w * 0.42, h * 0.28, d * 0.05], "chrom"),
  // Wandhalter rechts
  box([w * 0.04, h * 0.06, d * 0.7], [w * 0.42, h * 0.28, d * 0.05], "chrom"),
  // Chrom-Stange (horizontal), vorne an den Haltern
  box([w * 0.9, h * 0.04, d * 0.06], [0, h * 0.28, d / 2 - d * 0.12], "chrom"),
  // Hängendes Tuch (weich, koerper) – hängt über die Stange nach unten
  box([w * 0.7, h * 0.66, d * 0.05], [0, -h * 0.02, d / 2 - d * 0.1], "koerper"),
  // Tuch-Faltkante / Highlight oben
  box([w * 0.7, h * 0.05, d * 0.06], [0, h * 0.28, d / 2 - d * 0.09], "hell"),
];

// Handtuchheizung: dünne Wandplatte + 2 vertikale Chrom-Schienen + Chrom-Sprossen.
const handtuchheizung: Bauer = (w, d, h) => {
  const sprossen = 8;
  const teile: Teil[] = [
    // Wandplatte (dünn)
    box([w * 0.9, h * 0.98, d * 0.4], [0, 0, -d * 0.28], "koerper"),
    // Vertikale Chrom-Schiene links
    zyl(w * 0.03, w * 0.03, h * 0.96, [-w * 0.4, 0, d * 0.02], "chrom"),
    // Vertikale Chrom-Schiene rechts
    zyl(w * 0.03, w * 0.03, h * 0.96, [w * 0.4, 0, d * 0.02], "chrom"),
  ];
  for (let i = 0; i < sprossen; i++) {
    const y = -h * 0.42 + (i * (h * 0.84)) / (sprossen - 1);
    // Horizontale Sprosse (Chrom)
    teile.push(box([w * 0.74, h * 0.03, d * 0.12], [0, y, d * 0.04], "chrom"));
  }
  return teile;
};

// Urinal (wandmontiert): gerundeter Keramikkörper (rundbox), auslaufende Rundung
// und dunkle Innenmulde (Rotationskörper), Chrom-Zulauf + Chrom-Drücker.
const urinal: Bauer = (w, d, h) => {
  const rc = Math.min(w, d);
  const rr = rc * 0.18;
  return [
    // Keramikkörper (gerundet), an der Wand
    rbox([w * 0.86, h * 0.7, d * 0.72], [0, -h / 2 + h * 0.4, -d * 0.06], rr, "koerper"),
    // Auslaufende untere Rundung (Rotationskörper)
    drehteil(
      [
        [0, -h * 0.18],
        [rc * 0.28, -h * 0.1],
        [rc * 0.34, 0],
      ],
      [0, -h / 2 + h * 0.2, -d * 0.02],
      "koerper",
    ),
    // Innenschale (dunkle Mulde, Rotationskörper)
    drehteil(
      [
        [0, -h * 0.02],
        [rc * 0.22, h * 0.04],
        [rc * 0.28, h * 0.16],
      ],
      [0, h * 0.04, d * 0.04],
      "dunkel",
    ),
    // Zulauf oben (Chrom, vertikal)
    zyl(w * 0.03, w * 0.03, h * 0.12, [0, h / 2 - h * 0.1, -d / 2 + d * 0.12], "chrom"),
    // Chrom-Drücker
    rbox(
      [w * 0.14, h * 0.05, d * 0.06],
      [0, h / 2 - h * 0.04, -d / 2 + d * 0.16],
      rc * 0.02,
      "chrom",
    ),
  ];
};

// Bidet: gerundete Keramikschale (rundbox) ähnlich WC mit Standfuss, heller
// Beckenrand, dunkle Innenmulde (Rotationskörper), Chrom-Armatur + Bogen-Auslauf.
const bidet: Bauer = (w, d, h) => {
  const rc = Math.min(w, d);
  const rr = rc * 0.14;
  return [
    // Standfuss
    rbox([w * 0.42, h * 0.56, d * 0.42], [0, -h / 2 + h * 0.28, d * 0.02], rr, "koerper"),
    // Keramikschale (gerundeter Körper)
    rbox([w * 0.84, h * 0.34, d * 0.78], [0, -h / 2 + h * 0.66, d * 0.04], rr, "koerper"),
    // Beckenrand (hell)
    rbox([w * 0.82, h * 0.06, d * 0.72], [0, -h / 2 + h * 0.82, d * 0.05], rr * 0.5, "hell"),
    // Innenmulde (Rotationskörper, dunkel)
    drehteil(
      [
        [0, -h * 0.1],
        [rc * 0.2, -h * 0.06],
        [rc * 0.3, -h * 0.005],
      ],
      [0, -h / 2 + h * 0.84, d * 0.05],
      "dunkel",
    ),
    // Ablauf (Chrom-Ring)
    ring(rc * 0.04, rc * 0.012, "y", [0, -h / 2 + h * 0.8, d * 0.05], "chrom"),
    // Armatur-Körper hinten (Chrom)
    zyl(w * 0.025, w * 0.03, h * 0.14, [0, -h / 2 + h * 0.86, -d * 0.32], "chrom"),
    // Gebogener Auslauf (Chrom-Torus)
    ring(d * 0.08, w * 0.02, "x", [0, -h / 2 + h * 0.9, -d * 0.24], "chrom"),
  ];
};

// Schrank (allgemein): Korpus, Mitteltrenner, 2 Griffe, Sockel
const schrank: Bauer = (w, d, h) => [
  box([w, h, d], [0, 0, 0], "koerper"),
  // Vertikaler Mitteltrenner
  box([w * 0.014, h * 0.96, d * 0.02], [0, 0, d / 2 - d * 0.01], "dunkel"),
  // Griff links
  box([w * 0.03, h * 0.1, d * 0.04], [-w * 0.16, h * 0.2, d / 2 - d * 0.02], "hell"),
  // Griff rechts
  box([w * 0.03, h * 0.1, d * 0.04], [w * 0.16, h * 0.2, d / 2 - d * 0.02], "hell"),
  // Sockel zurückgesetzt
  box([w * 0.92, h * 0.05, d * 0.7], [0, -h / 2 + h * 0.025, 0], "dunkel"),
];

// Flache Matte (Teppich/Badteppich): sehr niedrig, weich gerundet, mit dezentem
// umlaufendem Rand und ruhigem Innenfeld (Musterandeutung).
const matte: Bauer = (w, d, h) => {
  const rr = Math.min(w, d) * 0.1;
  return [
    // Grundfläche (weich, gerundet)
    rbox([w, h * 0.7, d], [0, -h / 2 + h * 0.35, 0], rr, "koerper"),
    // Dezenter Rand (etwas erhöht, umlaufend)
    rbox([w * 0.9, h * 0.55, d * 0.9], [0, -h / 2 + h * 0.45, 0], rr * 0.7, "hell"),
    // Innenfeld (Musterandeutung)
    rbox([w * 0.74, h * 0.42, d * 0.74], [0, -h / 2 + h * 0.6, 0], rr * 0.5, "koerper"),
  ];
};

// ═══════════════════════════════════════════════════════════════════
// WOHNEN / SCHLAFEN
// ═══════════════════════════════════════════════════════════════════

// Sofa: weich gerundeter Korpus + Rückenlehne + 2 Armlehnen + Sitz-/Rücken-
// kissen + 2 Zierkissen (Akzent) + 4 schlanke Chrom-Füsse.
const sofa: Bauer = (w, d, h) => {
  const rr = Math.min(w, d, h) * 0.09;
  const armB = w * 0.11;
  const innen = w - 2 * armB;
  const kissB = innen * 0.47;
  const kissX = innen * 0.24;
  const fuss = (x: number, z: number): Teil =>
    zyl(w * 0.018, w * 0.024, h * 0.1, [x, -h / 2 + h * 0.05, z], "chrom");
  return [
    // Sitz-Korpus (weich gerundet)
    rbox([w, h * 0.32, d], [0, -h / 2 + h * 0.24, 0], rr, "koerper"),
    // Rückenlehne (gerundet, an der Rückwand -z)
    rbox([w, h * 0.5, d * 0.24], [0, -h / 2 + h * 0.65, -d / 2 + d * 0.12], rr, "koerper"),
    // Linke Armlehne (weich)
    rbox(
      [armB, h * 0.52, d * 0.9],
      [-w / 2 + armB / 2, -h / 2 + h * 0.35, d * 0.02],
      rr,
      "koerper",
    ),
    // Rechte Armlehne
    rbox([armB, h * 0.52, d * 0.9], [w / 2 - armB / 2, -h / 2 + h * 0.35, d * 0.02], rr, "koerper"),
    // Sitzkissen links/rechts (weich, hell)
    rbox([kissB, h * 0.16, d * 0.66], [-kissX, -h / 2 + h * 0.48, d * 0.06], rr, "hell"),
    rbox([kissB, h * 0.16, d * 0.66], [kissX, -h / 2 + h * 0.48, d * 0.06], rr, "hell"),
    // Rückenkissen links/rechts (weich)
    rbox([kissB, h * 0.3, d * 0.18], [-kissX, -h / 2 + h * 0.62, -d / 2 + d * 0.2], rr, "hell"),
    rbox([kissB, h * 0.3, d * 0.18], [kissX, -h / 2 + h * 0.62, -d / 2 + d * 0.2], rr, "hell"),
    // Zierkissen (Akzent dunkel)
    rbox([w * 0.15, h * 0.22, d * 0.1], [-kissX, -h / 2 + h * 0.55, d * 0.18], rr, "dunkel"),
    rbox([w * 0.15, h * 0.22, d * 0.1], [kissX, -h / 2 + h * 0.55, d * 0.18], rr, "dunkel"),
    // 4 Chrom-Füsse
    fuss(-w * 0.42, -d * 0.4),
    fuss(w * 0.42, -d * 0.4),
    fuss(-w * 0.42, d * 0.4),
    fuss(w * 0.42, d * 0.4),
  ];
};

// Sessel: weich gerundeter Korpus + Rückenlehne + 2 Armlehnen + Sitz-/Rücken-
// kissen + 4 schlanke Chrom-Füsse.
const sessel: Bauer = (w, d, h) => {
  const rr = Math.min(w, d, h) * 0.1;
  const armB = w * 0.15;
  const fuss = (x: number, z: number): Teil =>
    zyl(w * 0.03, w * 0.04, h * 0.12, [x, -h / 2 + h * 0.06, z], "chrom");
  return [
    // Sitz-Korpus (weich gerundet)
    rbox([w, h * 0.34, d], [0, -h / 2 + h * 0.29, 0], rr, "koerper"),
    // Rückenlehne (gerundet)
    rbox([w, h * 0.5, d * 0.22], [0, -h / 2 + h * 0.63, -d / 2 + d * 0.11], rr, "koerper"),
    // Linke Armlehne
    rbox([armB, h * 0.48, d * 0.9], [-w / 2 + armB / 2, -h / 2 + h * 0.4, d * 0.02], rr, "koerper"),
    // Rechte Armlehne
    rbox([armB, h * 0.48, d * 0.9], [w / 2 - armB / 2, -h / 2 + h * 0.4, d * 0.02], rr, "koerper"),
    // Sitzkissen (weich, hell)
    rbox([w - 2 * armB, h * 0.16, d * 0.74], [0, -h / 2 + h * 0.52, d * 0.05], rr, "hell"),
    // Rückenkissen (weich)
    rbox([w - 2 * armB, h * 0.32, d * 0.16], [0, -h / 2 + h * 0.66, -d / 2 + d * 0.2], rr, "hell"),
    // 4 Chrom-Füsse
    fuss(-w * 0.36, -d * 0.36),
    fuss(w * 0.36, -d * 0.36),
    fuss(-w * 0.36, d * 0.36),
    fuss(w * 0.36, d * 0.36),
  ];
};

// Tisch (Ess-/Couch-/Beistelltisch): gerundete Platte + umlaufende Zarge +
// 4 gerundete Beine.
const tisch: Bauer = (w, d, h) => {
  const rr = Math.min(w * 0.04, d * 0.04, h * 0.06);
  const bx = w / 2 - w * 0.08;
  const bz = d / 2 - d * 0.08;
  const bein = (x: number, z: number): Teil =>
    rbox([w * 0.05, h * 0.86, d * 0.05], [x, -h / 2 + h * 0.43, z], rr * 0.6, "dunkel");
  return [
    // Tischplatte (gerundet)
    rbox([w, h * 0.1, d], [0, h / 2 - h * 0.05, 0], rr, "koerper"),
    // Zarge in Längsrichtung (vorne + hinten)
    box([w * 0.86, h * 0.08, d * 0.05], [0, h / 2 - h * 0.16, d / 2 - d * 0.12], "dunkel"),
    box([w * 0.86, h * 0.08, d * 0.05], [0, h / 2 - h * 0.16, -d / 2 + d * 0.12], "dunkel"),
    // Zarge in Querrichtung (links + rechts)
    box([w * 0.05, h * 0.08, d * 0.76], [w / 2 - w * 0.12, h / 2 - h * 0.16, 0], "dunkel"),
    box([w * 0.05, h * 0.08, d * 0.76], [-w / 2 + w * 0.12, h / 2 - h * 0.16, 0], "dunkel"),
    bein(-bx, -bz),
    bein(bx, -bz),
    bein(-bx, bz),
    bein(bx, bz),
  ];
};

// Regal (Wandregal/Ablage): schlanke gerundete Wangen + dünne Rückwand + mehrere
// Böden, jeder mit zwei dezenten Konsolen-Haltern darunter.
const regal: Bauer = (w, d, h) => {
  const boeden = 4;
  const rr = Math.min(w, d) * 0.04;
  const teile: Teil[] = [
    // Dünne linke Wange (gerundet)
    rbox([w * 0.04, h, d], [-w / 2 + w * 0.02, 0, 0], rr, "koerper"),
    // Dünne rechte Wange (gerundet)
    rbox([w * 0.04, h, d], [w / 2 - w * 0.02, 0, 0], rr, "koerper"),
    // Rückwand (dünn, dezent)
    box([w, h, d * 0.04], [0, 0, -d / 2 + d * 0.02], "dunkel"),
  ];
  for (let i = 0; i < boeden; i++) {
    const y = -h / 2 + h * 0.04 + (i * (h * 0.92)) / (boeden - 1);
    // Boden (gerundet, hell)
    teile.push(rbox([w * 0.94, h * 0.04, d * 0.94], [0, y, 0], rr * 0.5, "hell"));
    // Dezente Halter (kleine Konsolen unter dem Boden)
    teile.push(box([w * 0.03, h * 0.05, d * 0.5], [-w * 0.4, y - h * 0.03, 0], "dunkel"));
    teile.push(box([w * 0.03, h * 0.05, d * 0.5], [w * 0.4, y - h * 0.03, 0], "dunkel"));
  }
  return teile;
};

// Sideboard: gerundeter Korpus + überstehende Deckplatte + 3 Fronten (Fugen) +
// schlanke Chrom-Griffe + 4 Chrom-Füsse.
const sideboard: Bauer = (w, d, h) => {
  const rr = Math.min(w, d) * 0.04;
  const fx = w / 2 - w * 0.06;
  const fz = d / 2 - d * 0.12;
  const fuss = (x: number, z: number): Teil =>
    zyl(w * 0.02, w * 0.028, h * 0.16, [x, -h / 2 + h * 0.08, z], "chrom");
  return [
    // Korpus (gerundet)
    rbox([w, h * 0.68, d], [0, -h / 2 + h * 0.5, 0], rr, "koerper"),
    // Deckplatte (hell, leicht überstehend)
    rbox([w, h * 0.08, d], [0, -h / 2 + h * 0.88, 0], rr * 0.6, "hell"),
    // Schattenfugen zwischen 3 Fronten
    box([w * 0.01, h * 0.56, d * 0.02], [-w / 6, -h * 0.06, d / 2 - d * 0.01], "dunkel"),
    box([w * 0.01, h * 0.56, d * 0.02], [w / 6, -h * 0.06, d / 2 - d * 0.01], "dunkel"),
    // Chrom-Griffe je Front (schlank, vertikal)
    box([w * 0.02, h * 0.22, d * 0.03], [-w / 6 - w * 0.03, -h * 0.06, d / 2 - d * 0.015], "chrom"),
    box([w * 0.02, h * 0.22, d * 0.03], [w * 0.03, -h * 0.06, d / 2 - d * 0.015], "chrom"),
    box([w * 0.02, h * 0.22, d * 0.03], [w / 6 + w * 0.03, -h * 0.06, d / 2 - d * 0.015], "chrom"),
    fuss(-fx, -fz),
    fuss(fx, -fz),
    fuss(-fx, fz),
    fuss(fx, fz),
  ];
};

// Stehleuchte: gerundeter Chrom-Fussteller (Rotationskörper) + schlanker Chrom-
// Stab + konischer Schirm mit leuchtender Innenfläche + Glas-Diffusor unten.
const stehleuchte: Bauer = (w, d, h) => {
  const r = Math.min(w, d);
  return [
    // Fussteller (Rotationskörper, chrom, flach)
    drehteil(
      [
        [r * 0.4, -h * 0.48],
        [r * 0.42, -h * 0.46],
        [r * 0.12, -h * 0.44],
        [r * 0.05, -h * 0.42],
      ],
      [0, 0, 0],
      "chrom",
    ),
    // Stab (chrom, schlank)
    zyl(r * 0.03, r * 0.035, h * 0.66, [0, -h / 2 + h * 0.44, 0], "chrom"),
    // Schirm aussen (konisch)
    zyl(r * 0.46, r * 0.3, h * 0.2, [0, h / 2 - h * 0.1, 0], "koerper"),
    // Schirm-Innenfläche (leuchtet hell)
    zyl(r * 0.4, r * 0.24, h * 0.17, [0, h / 2 - h * 0.09, 0], "hell"),
    // Leucht-Diffusor unten (Glas)
    zyl(r * 0.24, r * 0.24, h * 0.02, [0, h / 2 - h * 0.19, 0], "glas"),
  ];
};

// Pflanze: konischer Topf (Rotationskörper) + Erde + Stamm + volumetrisches
// Blattwerk aus mehreren versetzten Laub-Kugeln.
const pflanze: Bauer = (w, d, h) => {
  const r = Math.min(w, d);
  const rL = Math.min(r * 0.4, h * 0.26);
  const yT = h / 2 - rL * 1.15;
  return [
    // Topf (Rotationskörper: konisch, unten schmaler)
    drehteil(
      [
        [r * 0.22, -h * 0.42],
        [r * 0.3, -h * 0.34],
        [r * 0.32, -h * 0.18],
        [r * 0.34, -h * 0.14],
      ],
      [0, 0, 0],
      "dunkel",
    ),
    // Erde
    zyl(r * 0.3, r * 0.3, h * 0.05, [0, -h / 2 + h * 0.34, 0], "dunkel"),
    // Stamm
    zyl(r * 0.05, r * 0.06, h * 0.2, [0, -h / 2 + h * 0.44, 0], "dunkel"),
    // Blattwerk – mehrere versetzte Kugeln (volumetrisch)
    kugel(rL, [0, yT, 0], "koerper"),
    kugel(rL * 0.7, [r * 0.22, yT - rL * 0.5, r * 0.16], "hell"),
    kugel(rL * 0.66, [-r * 0.22, yT - rL * 0.4, -r * 0.14], "koerper"),
    kugel(rL * 0.6, [r * 0.16, yT - rL * 0.9, -r * 0.2], "hell"),
    kugel(rL * 0.58, [-r * 0.18, yT - rL * 1.0, r * 0.2], "koerper"),
    kugel(rL * 0.45, [0, yT + rL * 0.35, 0], "hell"),
  ];
};

// Wandbild: gerundeter Rahmen (an der Wand -z) + heller Passepartout +
// zurückgesetzte Bildfläche.
const wandbild: Bauer = (w, d, h) => {
  const rr = Math.min(w, h) * 0.03;
  return [
    // Rahmen (gerundet, Rückseite an der Wand)
    rbox([w, h, d * 0.6], [0, 0, -d * 0.2], rr, "dunkel"),
    // Passepartout (heller Rand)
    rbox([w * 0.88, h * 0.88, d * 0.4], [0, 0, d * 0.05], rr * 0.6, "hell"),
    // Bildfläche (leicht vorstehend)
    box([w * 0.74, h * 0.74, d * 0.34], [0, 0, d * 0.12], "koerper"),
  ];
};

// Wandleuchte: gerundete Wandplatte + Arm + Schirm (hell, leuchtend) + Glas-
// Diffusor unten. Rückseite an der Wand (-z).
const wandleuchte: Bauer = (w, d, h) => {
  const rc = Math.min(w, d);
  const rr = rc * 0.08;
  return [
    // Wandplatte (gerundet)
    rbox([w * 0.5, h * 0.5, d * 0.3], [0, 0, -d * 0.34], rr, "dunkel"),
    // Arm nach vorne
    box([w * 0.1, h * 0.1, d * 0.5], [0, h * 0.05, -d * 0.05], "dunkel"),
    // Schirm (zylindrisch, hell/leuchtend)
    zyl(rc * 0.3, rc * 0.2, h * 0.4, [0, -h * 0.06, d * 0.12], "hell"),
    // Diffusor unten (Glas, leuchtet)
    zyl(rc * 0.22, rc * 0.26, h * 0.05, [0, -h * 0.26, d * 0.12], "glas"),
  ];
};

// TV-Möbel: gerundetes Lowboard + zurückgesetzter Sockel + Klappen-Fugen +
// Chrom-Griffleisten + schlanker TV mit Glas-Screen auf Standfuss.
const tvmoebel: Bauer = (w, d, h) => {
  const rr = Math.min(w, d) * 0.03;
  return [
    // Lowboard-Korpus (gerundet)
    rbox([w, h * 0.4, d], [0, -h / 2 + h * 0.24, 0], rr, "koerper"),
    // Sockel zurückgesetzt
    box([w * 0.9, h * 0.06, d * 0.8], [0, -h / 2 + h * 0.03, 0], "dunkel"),
    // 2 Klappen-Fugen
    box(
      [w * 0.012, h * 0.34, d * 0.02],
      [-w * 0.25, -h / 2 + h * 0.24, d / 2 - d * 0.01],
      "dunkel",
    ),
    box([w * 0.012, h * 0.34, d * 0.02], [w * 0.25, -h / 2 + h * 0.24, d / 2 - d * 0.01], "dunkel"),
    // Chrom-Griffleisten (horizontal)
    box([w * 0.2, h * 0.02, d * 0.03], [-w * 0.13, -h / 2 + h * 0.36, d / 2 - d * 0.015], "chrom"),
    box([w * 0.2, h * 0.02, d * 0.03], [w * 0.13, -h / 2 + h * 0.36, d / 2 - d * 0.015], "chrom"),
    // TV-Standfuss (Teller + Säule)
    box([w * 0.18, h * 0.03, d * 0.14], [0, -h / 2 + h * 0.46, 0], "dunkel"),
    zyl(w * 0.02, w * 0.02, h * 0.1, [0, -h / 2 + h * 0.5, -d * 0.05], "chrom"),
    // TV-Rahmen (schlank, dunkel)
    rbox(
      [w * 0.86, h * 0.5, d * 0.05],
      [0, -h / 2 + h * 0.74, -d / 2 + d * 0.12],
      rr * 0.5,
      "dunkel",
    ),
    // TV-Bildschirm (Glas)
    box([w * 0.8, h * 0.44, d * 0.02], [0, -h / 2 + h * 0.74, -d / 2 + d * 0.16], "glas"),
  ];
};

// Deko: bauchiges Gefäss/Vase (Rotationskörper) + Chrom-Öffnungsring + dunkle
// Innenöffnung + zwei Zweig-Andeutungen (kleine Kugeln).
const deko: Bauer = (w, d, h) => {
  const r = Math.min(w, d) * 0.5;
  return [
    // Vasen-/Gefäss-Körper (Rotationskörper, bauchig)
    drehteil(
      [
        [r * 0.34, -h * 0.48],
        [r * 0.5, -h * 0.34],
        [r * 0.6, -h * 0.1],
        [r * 0.42, h * 0.18],
        [r * 0.34, h * 0.36],
        [r * 0.4, h * 0.46],
      ],
      [0, 0, 0],
      "koerper",
    ),
    // Öffnungsrand (Chrom-Ring)
    ring(r * 0.36, r * 0.05, "y", [0, h * 0.46, 0], "chrom"),
    // Innenöffnung (dunkel)
    zyl(r * 0.3, r * 0.3, h * 0.06, [0, h * 0.44, 0], "dunkel"),
    // Zweig-Andeutungen (kleine Kugeln)
    kugel(r * 0.13, [r * 0.16, h * 0.38, 0], "hell"),
    kugel(r * 0.11, [-r * 0.14, h * 0.42, r * 0.1], "hell"),
  ];
};

// Bett (allgemein): gerundeter Bettrahmen + weiche Matratze + gepolstertes
// Kopfteil + dicke Bettdecke mit Umschlag + 2 weiche Kissen + Fussende.
const bett: Bauer = (w, d, h) => {
  const rr = Math.min(w, d, h) * 0.04;
  return [
    // Bettrahmen/Kasten (gerundet)
    rbox([w, h * 0.36, d], [0, -h / 2 + h * 0.22, 0], rr, "koerper"),
    // Matratze (weich, hell)
    rbox([w * 0.95, h * 0.2, d * 0.95], [0, -h / 2 + h * 0.5, 0], rr, "hell"),
    // Kopfteil (gepolstert, gerundet)
    rbox([w, h * 0.5, d * 0.12], [0, -h / 2 + h * 0.62, -d / 2 + d * 0.06], rr, "koerper"),
    // Bettdecke (weich, dick)
    rbox([w * 0.9, h * 0.12, d * 0.66], [0, -h / 2 + h * 0.63, d * 0.1], rr, "hell"),
    // Umschlag-Kante der Decke (Akzent)
    rbox([w * 0.9, h * 0.06, d * 0.1], [0, -h / 2 + h * 0.66, -d * 0.2], rr * 0.5, "dunkel"),
    // 2 Kissen (weich)
    rbox([w * 0.4, h * 0.12, d * 0.2], [-w * 0.24, -h / 2 + h * 0.66, -d * 0.28], rr, "hell"),
    rbox([w * 0.4, h * 0.12, d * 0.2], [w * 0.24, -h / 2 + h * 0.66, -d * 0.28], rr, "hell"),
    // Fussende (gerundet)
    rbox([w, h * 0.24, d * 0.08], [0, -h / 2 + h * 0.16, d / 2 - d * 0.04], rr, "dunkel"),
  ];
};

// Einzelbett = gleiche Form wie Bett, Alias
const einzelbett: Bauer = bett;

// Doppelbett: gerundeter Rahmen + durchgehende Matratze + breites gepolstertes
// Kopfteil + 2 getrennte Bettdecken + 2 Kissen + Fussende.
const doppelbett: Bauer = (w, d, h) => {
  const rr = Math.min(w, d, h) * 0.04;
  return [
    // Bettrahmen/Kasten (gerundet)
    rbox([w, h * 0.36, d], [0, -h / 2 + h * 0.22, 0], rr, "koerper"),
    // Matratze (durchgehend, weich)
    rbox([w * 0.96, h * 0.2, d * 0.95], [0, -h / 2 + h * 0.5, 0], rr, "hell"),
    // Kopfteil (breit, gepolstert)
    rbox([w, h * 0.52, d * 0.12], [0, -h / 2 + h * 0.63, -d / 2 + d * 0.06], rr, "koerper"),
    // 2 Bettdecken (getrennt, weich)
    rbox([w * 0.46, h * 0.12, d * 0.64], [-w * 0.25, -h / 2 + h * 0.63, d * 0.11], rr, "hell"),
    rbox([w * 0.46, h * 0.12, d * 0.64], [w * 0.25, -h / 2 + h * 0.63, d * 0.11], rr, "hell"),
    // 2 Kissen (weich)
    rbox([w * 0.42, h * 0.12, d * 0.2], [-w * 0.25, -h / 2 + h * 0.66, -d * 0.28], rr, "hell"),
    rbox([w * 0.42, h * 0.12, d * 0.2], [w * 0.25, -h / 2 + h * 0.66, -d * 0.28], rr, "hell"),
    // Fussende (gerundet)
    rbox([w, h * 0.24, d * 0.08], [0, -h / 2 + h * 0.16, d / 2 - d * 0.04], rr, "dunkel"),
  ];
};

// Kinderbett: gerundeter Bettkasten + weiche Matratze + gerundetes Kopf-/Fuss-
// teil + runde Gitterstäbe an beiden Längsseiten + Kissen & Decke.
const kinderbett: Bauer = (w, d, h) => {
  const rr = Math.min(w, d, h) * 0.04;
  const stab = (x: number, z: number): Teil =>
    zyl(w * 0.02, w * 0.02, h * 0.42, [x, -h / 2 + h * 0.55, z], "koerper");
  const staebe = (z: number): Teil[] =>
    Array.from({ length: 5 }, (_, i) => stab(-w * 0.4 + (i * w * 0.8) / 4, z));
  return [
    // Bettkasten (gerundet)
    rbox([w, h * 0.32, d], [0, -h / 2 + h * 0.2, 0], rr, "koerper"),
    // Matratze (weich)
    rbox([w * 0.92, h * 0.16, d * 0.92], [0, -h / 2 + h * 0.42, 0], rr, "hell"),
    // Kopfteil (höher, gerundet)
    rbox([w, h * 0.6, d * 0.08], [0, -h / 2 + h * 0.62, -d / 2 + d * 0.04], rr, "koerper"),
    // Fussteil (gerundet)
    rbox([w, h * 0.5, d * 0.08], [0, -h / 2 + h * 0.55, d / 2 - d * 0.04], rr, "koerper"),
    // Gitterstäbe an beiden Längsseiten
    ...staebe(-d / 2 + d * 0.05),
    ...staebe(d / 2 - d * 0.05),
    // Kissen (weich)
    rbox([w * 0.34, h * 0.1, d * 0.18], [0, -h / 2 + h * 0.54, -d * 0.28], rr, "hell"),
    // Decke (weich)
    rbox([w * 0.8, h * 0.1, d * 0.5], [0, -h / 2 + h * 0.52, d * 0.14], rr, "hell"),
  ];
};

// Kleiderschrank: gerundeter Korpus + zurückgesetzter Sockel + Deckleiste +
// 3 Türen (Fugen) + vertikale Chrom-Griffe je Tür.
const kleiderschrank: Bauer = (w, d, h) => {
  const rr = Math.min(w, d) * 0.03;
  return [
    // Korpus (gerundet)
    rbox([w, h * 0.9, d], [0, -h / 2 + h * 0.5, 0], rr, "koerper"),
    // Sockel zurückgesetzt
    box([w * 0.94, h * 0.06, d * 0.8], [0, -h / 2 + h * 0.03, 0], "dunkel"),
    // Kranz/Deckleiste oben (gerundet)
    rbox([w, h * 0.05, d], [0, h / 2 - h * 0.025, 0], rr * 0.5, "hell"),
    // Türfugen (3 Türen)
    box([w * 0.012, h * 0.82, d * 0.02], [-w / 6, h * 0.02, d / 2 - d * 0.01], "dunkel"),
    box([w * 0.012, h * 0.82, d * 0.02], [w / 6, h * 0.02, d / 2 - d * 0.01], "dunkel"),
    // Vertikale Chrom-Griffe je Tür
    box([w * 0.02, h * 0.3, d * 0.03], [-w / 6 - w * 0.03, h * 0.02, d / 2 - d * 0.015], "chrom"),
    box([w * 0.02, h * 0.3, d * 0.03], [-w * 0.03, h * 0.02, d / 2 - d * 0.015], "chrom"),
    box([w * 0.02, h * 0.3, d * 0.03], [w / 6 + w * 0.03, h * 0.02, d / 2 - d * 0.015], "chrom"),
  ];
};

// Nachttisch: gerundeter Korpus + überstehende Deckplatte + 2 Schubladen-Fugen
// + Chrom-Griffe + 4 schlanke Chrom-Füsse.
const nachttisch: Bauer = (w, d, h) => {
  const rr = Math.min(w, d) * 0.05;
  const fuss = (x: number, z: number): Teil =>
    zyl(w * 0.03, w * 0.04, h * 0.14, [x, -h / 2 + h * 0.07, z], "chrom");
  return [
    // Korpus (gerundet)
    rbox([w, h * 0.62, d], [0, -h / 2 + h * 0.45, 0], rr, "koerper"),
    // Deckplatte (hell)
    rbox([w, h * 0.06, d], [0, -h / 2 + h * 0.73, 0], rr * 0.6, "hell"),
    // 2 Schubladen-Fugen
    box([w * 0.9, h * 0.012, d * 0.02], [0, -h / 2 + h * 0.34, d / 2 - d * 0.01], "dunkel"),
    box([w * 0.9, h * 0.012, d * 0.02], [0, -h / 2 + h * 0.56, d / 2 - d * 0.01], "dunkel"),
    // Griffe (chrom)
    box([w * 0.26, h * 0.03, d * 0.03], [0, -h / 2 + h * 0.45, d / 2 - d * 0.015], "chrom"),
    box([w * 0.26, h * 0.03, d * 0.03], [0, -h / 2 + h * 0.62, d / 2 - d * 0.015], "chrom"),
    // 4 Chrom-Füsse
    fuss(-w * 0.4, -d * 0.36),
    fuss(w * 0.4, -d * 0.36),
    fuss(-w * 0.4, d * 0.36),
    fuss(w * 0.4, d * 0.36),
  ];
};

// Kommode: gerundeter Korpus + überstehende Deckplatte + 4 leicht erhabene
// Schubladen-Fronten mit Chrom-Griffen + 4 schlanke Chrom-Füsse.
const kommode: Bauer = (w, d, h) => {
  const rr = Math.min(w, d) * 0.04;
  const fuss = (x: number, z: number): Teil =>
    zyl(w * 0.025, w * 0.035, h * 0.1, [x, -h / 2 + h * 0.05, z], "chrom");
  const schub = (yc: number): Teil[] => [
    // Schubladen-Front (leicht erhaben, gerundet)
    rbox([w * 0.92, h * 0.18, d * 0.04], [0, -h / 2 + h * yc, d / 2 - d * 0.02], rr * 0.5, "hell"),
    // Griff (chrom)
    box([w * 0.2, h * 0.025, d * 0.03], [0, -h / 2 + h * yc, d / 2 - d * 0.03], "chrom"),
  ];
  return [
    // Korpus (gerundet)
    rbox([w, h * 0.82, d], [0, -h / 2 + h * 0.51, 0], rr, "koerper"),
    // Deckplatte (hell)
    rbox([w, h * 0.06, d], [0, -h / 2 + h * 0.89, 0], rr * 0.6, "hell"),
    // 4 Schubladen
    ...schub(0.22),
    ...schub(0.41),
    ...schub(0.6),
    ...schub(0.79),
    // 4 Chrom-Füsse
    fuss(-w * 0.42, -d * 0.36),
    fuss(w * 0.42, -d * 0.36),
    fuss(-w * 0.42, d * 0.36),
    fuss(w * 0.42, d * 0.36),
  ];
};

// Stuhl (Ess-/Beistellstuhl): gerundete Sitzfläche + weiches Polster +
// gepolsterte gerundete Rückenlehne + 4 schlanke Chrom-Beine.
const stuhl: Bauer = (w, d, h) => {
  const rr = Math.min(w, d, h) * 0.05;
  const bx = w / 2 - w * 0.1;
  const bz = d / 2 - d * 0.1;
  const bein = (x: number, z: number, hF: number): Teil =>
    zyl(w * 0.028, w * 0.032, h * hF, [x, -h / 2 + h * (hF / 2), z], "chrom");
  return [
    // Sitzfläche (gerundet)
    rbox([w, h * 0.08, d * 0.92], [0, -h / 2 + h * 0.5, 0], rr, "koerper"),
    // Sitzpolster (weich, hell)
    rbox([w * 0.88, h * 0.06, d * 0.8], [0, -h / 2 + h * 0.55, d * 0.02], rr * 0.7, "hell"),
    // Rückenlehne (gepolstert, gerundet)
    rbox([w * 0.9, h * 0.4, d * 0.08], [0, -h / 2 + h * 0.78, -d / 2 + d * 0.08], rr, "koerper"),
    // Rücken-Polster (weich)
    rbox(
      [w * 0.78, h * 0.32, d * 0.05],
      [0, -h / 2 + h * 0.78, -d / 2 + d * 0.12],
      rr * 0.7,
      "hell",
    ),
    // 4 Chrom-Beine (vorne kürzer, hinten hoch bis zur Lehne)
    bein(-bx, bz, 0.5),
    bein(bx, bz, 0.5),
    bein(-bx, -bz, 0.98),
    bein(bx, -bz, 0.98),
  ];
};

// Bürostuhl: Chrom-Sternfuss (5 Arme) + 5 Rollen + Chrom-Gaskolben + gerundeter
// gepolsterter Sitz + gepolsterte Rückenlehne + Kopfstütze + Armlehnen.
const buerostuhl: Bauer = (w, d, h) => {
  const r = Math.min(w, d);
  const arme = Array.from({ length: 5 }, (_, i) => {
    const a = (i / 5) * Math.PI * 2;
    return box(
      [r * 0.07, h * 0.04, r * 0.44],
      [Math.cos(a) * r * 0.22, -h / 2 + h * 0.05, Math.sin(a) * r * 0.22],
      "chrom",
    );
  });
  const rollen = Array.from({ length: 5 }, (_, i) => {
    const a = (i / 5) * Math.PI * 2;
    return zyl(
      r * 0.05,
      r * 0.05,
      r * 0.05,
      [Math.cos(a) * r * 0.42, -h / 2 + h * 0.03, Math.sin(a) * r * 0.42],
      "dunkel",
    );
  });
  return [
    ...arme,
    ...rollen,
    // Gaskolben (chrom)
    zyl(r * 0.045, r * 0.05, h * 0.24, [0, -h / 2 + h * 0.2, 0], "chrom"),
    // Sitzmechanik
    box([w * 0.42, h * 0.05, d * 0.42], [0, -h / 2 + h * 0.34, 0], "dunkel"),
    // Sitzfläche (gerundet)
    rbox([w * 0.9, h * 0.1, d * 0.9], [0, -h / 2 + h * 0.4, 0], r * 0.06, "koerper"),
    // Sitzpolster (weich)
    rbox([w * 0.78, h * 0.06, d * 0.78], [0, -h / 2 + h * 0.46, 0], r * 0.05, "hell"),
    // Rückenlehne (gerundet, gepolstert)
    rbox(
      [w * 0.8, h * 0.44, d * 0.08],
      [0, -h / 2 + h * 0.72, -d / 2 + d * 0.12],
      r * 0.06,
      "koerper",
    ),
    // Rücken-Polster
    rbox(
      [w * 0.68, h * 0.36, d * 0.05],
      [0, -h / 2 + h * 0.72, -d / 2 + d * 0.16],
      r * 0.05,
      "hell",
    ),
    // Kopfstütze
    rbox(
      [w * 0.4, h * 0.12, d * 0.06],
      [0, -h / 2 + h * 0.94, -d / 2 + d * 0.14],
      r * 0.04,
      "koerper",
    ),
    // Armlehnen (Chrom-Träger + Polster-Auflage)
    box([w * 0.05, h * 0.14, d * 0.4], [-w * 0.44, -h / 2 + h * 0.46, d * 0.02], "chrom"),
    box([w * 0.05, h * 0.14, d * 0.4], [w * 0.44, -h / 2 + h * 0.46, d * 0.02], "chrom"),
    rbox(
      [w * 0.1, h * 0.04, d * 0.36],
      [-w * 0.44, -h / 2 + h * 0.55, d * 0.02],
      r * 0.02,
      "dunkel",
    ),
    rbox(
      [w * 0.1, h * 0.04, d * 0.36],
      [w * 0.44, -h / 2 + h * 0.55, d * 0.02],
      r * 0.02,
      "dunkel",
    ),
  ];
};

// Schreibtisch: gerundete Platte + rechter Schubladen-Container mit Chrom-
// Griffen + schlankes Chrom-Beinpaar links mit Traverse + Kabelkanal.
const schreibtisch: Bauer = (w, d, h) => {
  const rr = Math.min(w * 0.03, d * 0.03, h * 0.05);
  return [
    // Tischplatte (gerundet)
    rbox([w, h * 0.08, d], [0, h / 2 - h * 0.04, 0], rr, "koerper"),
    // Platten-Unterseite (hell)
    box([w * 0.96, h * 0.02, d * 0.94], [0, h / 2 - h * 0.09, 0], "hell"),
    // Rechter Schubladen-Container (gerundet)
    rbox([w * 0.2, h * 0.8, d * 0.9], [w / 2 - w * 0.12, -h / 2 + h * 0.4, 0], rr, "koerper"),
    // 2 Schubladen-Fugen im Container
    box([w * 0.18, h * 0.012, d * 0.02], [w / 2 - w * 0.12, -h * 0.02, d / 2 - d * 0.01], "dunkel"),
    box([w * 0.18, h * 0.012, d * 0.02], [w / 2 - w * 0.12, h * 0.16, d / 2 - d * 0.01], "dunkel"),
    // Chrom-Griffe am Container
    box([w * 0.1, h * 0.025, d * 0.03], [w / 2 - w * 0.12, -h * 0.06, d / 2 - d * 0.015], "chrom"),
    box([w * 0.1, h * 0.025, d * 0.03], [w / 2 - w * 0.12, h * 0.1, d / 2 - d * 0.015], "chrom"),
    // Linkes Beinpaar (chrom, schlank)
    zyl(
      w * 0.02,
      w * 0.024,
      h * 0.86,
      [-w / 2 + w * 0.08, -h / 2 + h * 0.43, -d / 2 + d * 0.1],
      "chrom",
    ),
    zyl(
      w * 0.02,
      w * 0.024,
      h * 0.86,
      [-w / 2 + w * 0.08, -h / 2 + h * 0.43, d / 2 - d * 0.1],
      "chrom",
    ),
    // Quertraverse links (chrom)
    box([w * 0.03, h * 0.04, d * 0.7], [-w / 2 + w * 0.08, -h / 2 + h * 0.08, 0], "chrom"),
    // Kabelkanal hinten
    box([w * 0.5, h * 0.05, d * 0.05], [0, h / 2 - h * 0.12, -d / 2 + d * 0.04], "dunkel"),
  ];
};

// Hocker: gerundete Sitzfläche + weiches Polster + 4 schlanke Chrom-Beine +
// Chrom-Querstreben.
const hocker: Bauer = (w, d, h) => {
  const rr = Math.min(w, d, h) * 0.08;
  const bx = w / 2 - w * 0.12;
  const bz = d / 2 - d * 0.12;
  const bein = (x: number, z: number): Teil =>
    zyl(w * 0.03, w * 0.04, h * 0.82, [x, -h / 2 + h * 0.41, z], "chrom");
  return [
    // Sitzfläche (gerundet)
    rbox([w, h * 0.14, d], [0, h / 2 - h * 0.07, 0], rr, "koerper"),
    // Sitzpolster (weich, hell)
    rbox([w * 0.84, h * 0.1, d * 0.84], [0, h / 2 - h * 0.05, 0], rr * 0.7, "hell"),
    bein(-bx, -bz),
    bein(bx, -bz),
    bein(-bx, bz),
    bein(bx, bz),
    // Chrom-Querstreben zwischen den Beinen
    box([w * 0.66, h * 0.03, d * 0.03], [0, -h / 2 + h * 0.28, -bz], "chrom"),
    box([w * 0.03, h * 0.03, d * 0.66], [-bx, -h / 2 + h * 0.28, 0], "chrom"),
  ];
};

// ═══════════════════════════════════════════════════════════════════
// KÜCHE
// ═══════════════════════════════════════════════════════════════════

// Unterschrank: gerundeter Korpus + Arbeitsplatte mit gerundeter Vorderkante +
// zurückgesetzter Sockel + 2 leicht erhabene Türfronten (Fugen) + vertikale
// Chrom-Griffe. Arbeitsplatten-Oberkante liegt bündig an der bbox-Oberkante,
// damit die Küchenzeile durchgehend wirkt.
const unterschrank: Bauer = (w, d, h) => {
  const rr = Math.min(w, d) * 0.04;
  return [
    // Korpus (gerundete Kanten)
    rbox([w, h * 0.84, d], [0, -h / 2 + h * 0.48, 0], rr, "koerper"),
    // Arbeitsplatte (leicht überstehend, gerundete Vorderkante)
    rbox([w, h * 0.08, d * 1.02], [0, h / 2 - h * 0.04, d * 0.01], rr * 0.7, "dunkel"),
    // Zurückgesetzter Sockel (Fussleiste)
    box([w * 0.92, h * 0.08, d * 0.86], [0, -h / 2 + h * 0.04, -d * 0.02], "dunkel"),
    // Türfuge (senkrecht, mittig)
    box([w * 0.012, h * 0.7, d * 0.02], [0, -h * 0.06, d / 2 - d * 0.008], "dunkel"),
    // Linke Türfront (leicht erhaben, gerundet)
    rbox([w * 0.46, h * 0.7, d * 0.04], [-w * 0.245, -h * 0.06, d / 2 - d * 0.02], rr * 0.5, "hell"),
    // Rechte Türfront
    rbox([w * 0.46, h * 0.7, d * 0.04], [w * 0.245, -h * 0.06, d / 2 - d * 0.02], rr * 0.5, "hell"),
    // Vertikaler Chrom-Griff links (an der Innenkante)
    zyl(w * 0.014, w * 0.014, h * 0.3, [-w * 0.03, -h * 0.06, d / 2 - d * 0.03], "chrom"),
    // Vertikaler Chrom-Griff rechts
    zyl(w * 0.014, w * 0.014, h * 0.3, [w * 0.03, -h * 0.06, d / 2 - d * 0.03], "chrom"),
  ];
};

// Hochschrank (schlank): gerundeter Korpus, Türfuge, 2 vertikale Chrom-Griffe,
// zurückgesetzter Sockel, obere Abschlussleiste.
const hochschrank: Bauer = (w, d, h) => {
  const rr = Math.min(w, d) * 0.05;
  return [
    // Korpus (gerundet)
    rbox([w, h * 0.94, d], [0, -h / 2 + h * 0.53, 0], rr, "koerper"),
    // Sockel zurückgesetzt
    box([w * 0.92, h * 0.06, d * 0.7], [0, -h / 2 + h * 0.03, 0], "dunkel"),
    // Abschlussleiste oben (gerundet)
    rbox([w, h * 0.04, d], [0, h / 2 - h * 0.02, 0], rr * 0.5, "dunkel"),
    // Türfuge (horizontal, Zweiteilung)
    box([w * 0.9, h * 0.014, d * 0.02], [0, h * 0.12, d / 2 - d * 0.01], "dunkel"),
    // Chrom-Griff oben (vertikal)
    box([w * 0.06, h * 0.28, d * 0.03], [w * 0.3, h * 0.26, d / 2 - d * 0.015], "chrom"),
    // Chrom-Griff unten (vertikal)
    box([w * 0.06, h * 0.28, d * 0.03], [w * 0.3, -h * 0.04, d / 2 - d * 0.015], "chrom"),
  ];
};

// Hängeschrank (Wandschrank): gerundeter Korpus + 2 leicht erhabene Türfronten
// mit Mittelfuge + vertikale Chrom-Griffe + sichtbarer Unterboden + obere
// Abschlussleiste. Rückseite an der Wand (-z).
const haengeschrank: Bauer = (w, d, h) => {
  const rr = Math.min(w, d) * 0.05;
  return [
    // Korpus (gerundet)
    rbox([w, h * 0.94, d], [0, h * 0.01, 0], rr, "koerper"),
    // Obere Abschlussleiste (gerundet)
    rbox([w, h * 0.05, d], [0, h / 2 - h * 0.025, 0], rr * 0.5, "hell"),
    // Türfuge (senkrecht, mittig)
    box([w * 0.012, h * 0.82, d * 0.02], [0, h * 0.01, d / 2 - d * 0.008], "dunkel"),
    // Linke Türfront (leicht erhaben, gerundet)
    rbox([w * 0.46, h * 0.82, d * 0.05], [-w * 0.245, h * 0.01, d / 2 - d * 0.025], rr * 0.5, "hell"),
    // Rechte Türfront
    rbox([w * 0.46, h * 0.82, d * 0.05], [w * 0.245, h * 0.01, d / 2 - d * 0.025], rr * 0.5, "hell"),
    // Vertikaler Chrom-Griff links (untere Innenkante)
    zyl(w * 0.014, w * 0.014, h * 0.32, [-w * 0.03, -h * 0.1, d / 2 - d * 0.04], "chrom"),
    // Vertikaler Chrom-Griff rechts
    zyl(w * 0.014, w * 0.014, h * 0.32, [w * 0.03, -h * 0.1, d / 2 - d * 0.04], "chrom"),
    // Sichtbarer Unterboden (dunkel)
    box([w * 0.96, h * 0.04, d * 0.96], [0, -h / 2 + h * 0.02, 0], "dunkel"),
  ];
};

// Spüle: gerundeter Unterbau + Arbeitsplatte (gerundete Vorderkante) +
// vertieftes Edelstahl-Spülbecken (hell) mit dunkler Bodenmulde + Chrom-Ablauf +
// Chrom-Armatur mit gebogenem Auslauf (Torus). Platte bündig zur bbox-Oberkante.
const spuele: Bauer = (w, d, h) => {
  const rr = Math.min(w, d) * 0.04;
  const r0 = Math.min(w, d);
  return [
    // Unterbau-Korpus (gerundet)
    rbox([w, h * 0.84, d], [0, -h / 2 + h * 0.44, 0], rr, "koerper"),
    // Zurückgesetzter Sockel
    box([w * 0.92, h * 0.08, d * 0.86], [0, -h / 2 + h * 0.04, -d * 0.02], "dunkel"),
    // Türfront (leicht erhaben, gerundet)
    rbox([w * 0.94, h * 0.66, d * 0.04], [0, -h / 2 + h * 0.46, d / 2 - d * 0.02], rr * 0.5, "hell"),
    // Waagrechter Chrom-Griff an der Front
    zyl(w * 0.012, w * 0.012, w * 0.3, [0, -h / 2 + h * 0.72, d / 2 - d * 0.03], "chrom"),
    // Arbeitsplatte (gerundete Vorderkante, leicht überstehend)
    rbox([w, h * 0.08, d * 1.02], [0, h / 2 - h * 0.04, d * 0.01], rr * 0.7, "dunkel"),
    // Edelstahl-Beckenrand (hell, vertieft in der Platte)
    rbox([w * 0.62, h * 0.06, d * 0.78], [-w * 0.1, h / 2 - h * 0.05, 0], rr * 0.4, "hell"),
    // Beckenmulde (dunkel, vertieft – gibt der Armatur Raum darüber)
    box([w * 0.52, h * 0.2, d * 0.64], [-w * 0.1, h / 2 - h * 0.16, 0], "dunkel"),
    // Ablauf (Chrom-Ring am Beckenboden)
    ring(r0 * 0.05, r0 * 0.014, "y", [-w * 0.1, h / 2 - h * 0.24, 0], "chrom"),
    // Armatur-Körper (Chrom, vertikal) – im Beckenraum, Oberkante bündig zur Platte
    zyl(w * 0.022, w * 0.026, h * 0.18, [-w * 0.1, h / 2 - h * 0.09, -d * 0.28], "chrom"),
    // Gebogener Auslauf (Chrom-Torus) – arkt auf Plattenhöhe über das Becken
    ring(d * 0.12, w * 0.02, "x", [-w * 0.1, h / 2 - d * 0.12, -d * 0.16], "chrom"),
    // Einhebel-Mischer (Chrom, seitlich am Armatur-Körper)
    rbox([w * 0.09, h * 0.03, d * 0.05], [-w * 0.02, h / 2 - h * 0.05, -d * 0.28], w * 0.012, "chrom"),
  ];
};

// Kochfeld: Platte + 4 Kochzonen + Regler
const kochfeld: Bauer = (w, d, h) => {
  const r = Math.min(w, d) * 0.16;
  const platte = (x: number, z: number): Teil =>
    zyl(r, r, h * 0.04, [x, h / 2 - h * 0.07, z], "dunkel");
  return [
    // Unterbau
    box([w, h * 0.88, d], [0, -h / 2 + h * 0.44, 0], "koerper"),
    // Deckfläche
    box([w * 0.96, h * 0.1, d * 0.96], [0, h / 2 - h * 0.05, 0], "dunkel"),
    // 4 Kochzonen
    platte(-w * 0.22, -d * 0.2),
    platte(w * 0.22, -d * 0.2),
    platte(-w * 0.22, d * 0.2),
    platte(w * 0.22, d * 0.2),
    // Regler (4 Zylinder an der Frontkante)
    zyl(w * 0.04, w * 0.04, h * 0.05, [-w * 0.3, h / 2 - h * 0.03, d / 2 - d * 0.06], "hell"),
    zyl(w * 0.04, w * 0.04, h * 0.05, [-w * 0.1, h / 2 - h * 0.03, d / 2 - d * 0.06], "hell"),
    zyl(w * 0.04, w * 0.04, h * 0.05, [w * 0.1, h / 2 - h * 0.03, d / 2 - d * 0.06], "hell"),
    zyl(w * 0.04, w * 0.04, h * 0.05, [w * 0.3, h / 2 - h * 0.03, d / 2 - d * 0.06], "hell"),
  ];
};

// Kühlschrank: Korpus + 2-türig + Griffe + Lüftungsschlitze oben
const kuehlschrank: Bauer = (w, d, h) => [
  // Korpus
  box([w, h, d], [0, 0, 0], "koerper"),
  // Türtrenner
  box([w * 0.96, h * 0.016, d * 0.02], [0, h * 0.18, d / 2 - d * 0.01], "dunkel"),
  // Griff Oberteil
  box([w * 0.04, h * 0.22, d * 0.04], [w / 2 - w * 0.08, h * 0.3, d / 2 - d * 0.02], "hell"),
  // Griff Unterteil
  box([w * 0.04, h * 0.18, d * 0.04], [w / 2 - w * 0.08, -h * 0.1, d / 2 - d * 0.02], "hell"),
  // Lüftungsschlitze oben (3 Linien)
  box([w * 0.78, h * 0.012, d * 0.02], [0, h / 2 - h * 0.04, d / 2 - d * 0.01], "dunkel"),
  box([w * 0.78, h * 0.012, d * 0.02], [0, h / 2 - h * 0.07, d / 2 - d * 0.01], "dunkel"),
  box([w * 0.78, h * 0.012, d * 0.02], [0, h / 2 - h * 0.1, d / 2 - d * 0.01], "dunkel"),
];

// Geschirrspüler: Korpus + Bedienfeld + Tür + Griff
const geschirrspueler: Bauer = (w, d, h) => [
  // Korpus
  box([w, h, d], [0, 0, 0], "koerper"),
  // Bedienfeld oben
  box([w, h * 0.1, d * 0.05], [0, h / 2 - h * 0.05, d / 2 - d * 0.025], "dunkel"),
  // Status-LEDs (kleine helle Punkte)
  box([w * 0.18, h * 0.04, d * 0.03], [w * 0.2, h / 2 - h * 0.05, d / 2 - d * 0.015], "glas"),
  // Tür
  box([w * 0.92, h * 0.82, d * 0.03], [0, -h * 0.06, d / 2 - d * 0.015], "hell"),
  // Griff
  box([w * 0.68, h * 0.04, d * 0.04], [0, h / 2 - h * 0.14, d / 2 - d * 0.02], "dunkel"),
];

// Backofen: Korpus + Tür + Glasfenster + Griff + Regler
const backofen: Bauer = (w, d, h) => [
  // Korpus
  box([w, h, d], [0, 0, 0], "koerper"),
  // Türrahmen
  box([w * 0.9, h * 0.72, d * 0.04], [0, -h / 2 + h * 0.43, d / 2 - d * 0.02], "dunkel"),
  // Glasfenster
  box([w * 0.76, h * 0.48, d * 0.03], [0, -h / 2 + h * 0.4, d / 2 - d * 0.015], "glas"),
  // Griff
  box([w * 0.62, h * 0.04, d * 0.04], [0, h / 2 - h * 0.16, d / 2 - d * 0.02], "hell"),
  // Bedienfeld oben
  box([w, h * 0.14, d * 0.04], [0, h / 2 - h * 0.07, d / 2 - d * 0.02], "dunkel"),
  // Regler (3 Zylinder)
  zyl(w * 0.04, w * 0.04, h * 0.04, [-w * 0.28, h / 2 - h * 0.07, d / 2 - d * 0.02], "hell"),
  zyl(w * 0.04, w * 0.04, h * 0.04, [0, h / 2 - h * 0.07, d / 2 - d * 0.02], "hell"),
  zyl(w * 0.04, w * 0.04, h * 0.04, [w * 0.28, h / 2 - h * 0.07, d / 2 - d * 0.02], "hell"),
];

// Mikrowelle: Flaches Gehäuse + Tür + Fenster + Bedienfeld
const mikrowelle: Bauer = (w, d, h) => [
  // Gehäuse
  box([w, h, d], [0, 0, 0], "koerper"),
  // Tür (2/3 der Breite links)
  box([w * 0.62, h * 0.82, d * 0.04], [-w * 0.14, 0, d / 2 - d * 0.02], "dunkel"),
  // Türfenster
  box([w * 0.52, h * 0.62, d * 0.03], [-w * 0.14, 0, d / 2 - d * 0.015], "glas"),
  // Türgriff
  box([w * 0.04, h * 0.58, d * 0.04], [w * 0.18, 0, d / 2 - d * 0.02], "dunkel"),
  // Bedienfeld rechts
  box([w * 0.3, h * 0.82, d * 0.03], [w * 0.34, 0, d / 2 - d * 0.015], "dunkel"),
  // Display (leuchtet)
  box([w * 0.2, h * 0.22, d * 0.02], [w * 0.28, h * 0.2, d / 2 - d * 0.01], "glas"),
];

// Dunstabzug: Gehäuse + Auslass + Lüfteröffnung
const dunstabzug: Bauer = (w, d, h) => [
  // Hauptgehäuse
  box([w, h * 0.82, d], [0, h / 2 - h * 0.41, 0], "koerper"),
  // Frontblende mit Lüfteröffnungen
  box([w * 0.82, h * 0.2, d * 0.5], [0, -h / 2 + h * 0.25, d / 2 - d * 0.26], "dunkel"),
  // Lüftungsschlitze (3 Linien)
  box([w * 0.72, h * 0.03, d * 0.42], [0, -h / 2 + h * 0.2, d / 2 - d * 0.23], "hell"),
  box([w * 0.72, h * 0.03, d * 0.42], [0, -h / 2 + h * 0.27, d / 2 - d * 0.23], "hell"),
  // Bedienfeld
  box([w * 0.64, h * 0.1, d * 0.44], [0, -h / 2 + h * 0.14, d / 2 - d * 0.24], "hell"),
  // Unterkante (Lichtstreifen)
  box([w * 0.88, h * 0.04, d * 0.08], [0, -h / 2 + h * 0.04, d / 2 - d * 0.05], "glas"),
];

// Waschmaschine: Korpus + Rundes Bullauge + Bedienfeld
const waschmaschine: Bauer = (w, d, h) => {
  const r = Math.min(w, d) * 0.32;
  return [
    // Korpus
    box([w, h, d], [0, 0, 0], "koerper"),
    // Türrahmen (rund simuliert durch 2 Boxen im Kreuz)
    zyl(r, r, d * 0.06, [0, -h * 0.06, d / 2 - d * 0.03], "dunkel"),
    // Bullauge Glas
    zyl(r * 0.82, r * 0.82, d * 0.04, [0, -h * 0.06, d / 2 - d * 0.01], "glas"),
    // Türgriff
    box([w * 0.04, h * 0.04, d * 0.06], [r * 0.88, -h * 0.06, d / 2 - d * 0.03], "hell"),
    // Bedienfeld oben
    box([w * 0.92, h * 0.18, d * 0.04], [0, h / 2 - h * 0.09, d / 2 - d * 0.02], "dunkel"),
    // Display
    box([w * 0.32, h * 0.1, d * 0.03], [-w * 0.22, h / 2 - h * 0.09, d / 2 - d * 0.015], "glas"),
    // Regler
    zyl(w * 0.06, w * 0.06, d * 0.04, [w * 0.2, h / 2 - h * 0.09, d / 2 - d * 0.02], "hell"),
    // Sockel zurückgesetzt
    box([w * 0.88, h * 0.05, d * 0.6], [0, -h / 2 + h * 0.025, 0], "dunkel"),
  ];
};

// Tumbler / Wäschetrockner: Gleiche Form wie Waschmaschine
const tumbler: Bauer = (w, d, h) => {
  const r = Math.min(w, d) * 0.32;
  return [
    box([w, h, d], [0, 0, 0], "koerper"),
    zyl(r, r, d * 0.06, [0, -h * 0.05, d / 2 - d * 0.03], "dunkel"),
    zyl(r * 0.8, r * 0.8, d * 0.04, [0, -h * 0.05, d / 2 - d * 0.01], "glas"),
    // Lüftungsöffnungen rechts
    box([w * 0.12, h * 0.5, d * 0.03], [w / 2 - w * 0.1, -h * 0.05, d / 2 - d * 0.015], "dunkel"),
    box([w * 0.08, h * 0.4, d * 0.02], [w / 2 - w * 0.1, -h * 0.05, d / 2 - d * 0.01], "hell"),
    box([w * 0.88, h * 0.18, d * 0.04], [0, h / 2 - h * 0.09, d / 2 - d * 0.02], "dunkel"),
    zyl(w * 0.06, w * 0.06, d * 0.04, [w * 0.2, h / 2 - h * 0.09, d / 2 - d * 0.02], "hell"),
    box([w * 0.88, h * 0.05, d * 0.6], [0, -h / 2 + h * 0.025, 0], "dunkel"),
  ];
};

// Eckschrank: Korpus + 1 Tür + Griff + Sockel
const eckschrank: Bauer = (w, d, h) => [
  box([w, h * 0.86, d], [0, -h / 2 + h * 0.43, 0], "koerper"),
  box([w, h * 0.08, d], [0, h / 2 - h * 0.04, 0], "dunkel"),
  box([w * 0.92, h * 0.06, d * 0.7], [0, -h / 2 + h * 0.03, 0], "dunkel"),
  box([w * 0.3, h * 0.03, d * 0.04], [w * 0.1, h * 0.04, d / 2 - d * 0.02], "hell"),
];

// Füllstück: Dünnes Verbindungsstück zwischen Küchenschränken
const fuellstueck: Bauer = (w, d, h) => [
  box([w, h, d], [0, 0, 0], "koerper"),
  box([w * 0.3, h, d * 0.05], [0, 0, d / 2 - d * 0.025], "dunkel"),
];

// ═══════════════════════════════════════════════════════════════════
// VARIANTEN – mehrere 3D-Bausätze je funktionsTyp
// ───────────────────────────────────────────────────────────────────
// Ein funktionsTyp (z.B. wc) kann optisch verschiedene Möbel meinen. Das
// Katalog-Item wählt per Feld `modell3d` (Schema) eine registrierte Variante;
// fehlt sie, greift der Standard-Bausatz des funktionsTyp (siehe
// bausatzSchluessel + bauteile). Konvention wie bei den Basis-Bausätzen:
// gleiche Bauer-Signatur, alle Masse als Bruchteile von w/d/h, bbox-treu.
// Wandseite = Rückwand bei -z (wie in den Basis-Bausätzen).

// WC wandhängend: schwebender Keramikkörper OHNE Spülkasten/Säule, Luft darunter.
const wcWandhaengend: Bauer = (w, d, h) => [
  // Vorwand-/Wandanschluss-Platte (Andeutung), dünn an der Rückwand
  box([w * 0.62, h * 0.92, d * 0.08], [0, h * 0.04, -d / 2 + d * 0.04], "dunkel"),
  // Schwebender Keramikkörper – untere Kante deutlich über dem Boden (Luft)
  box([w * 0.86, h * 0.42, d * 0.72], [0, h * 0.06, d * 0.06], "koerper"),
  // Sitzfläche (heller Ring)
  box([w * 0.84, h * 0.06, d * 0.68], [0, h * 0.3, d * 0.06], "hell"),
  // Sitzdeckel
  box([w * 0.82, h * 0.04, d * 0.66], [0, h * 0.37, d * 0.06], "dunkel"),
  // Spülknopf an der Wandplatte
  box([w * 0.12, h * 0.05, d * 0.03], [0, h * 0.4, -d / 2 + d * 0.06], "hell"),
];

// Lavabo Aufsatz: flacher Zylinder (Aufsatzbecken) auf Waschtischplatte mit
// Unterbau-Box – KEINE Säule.
const lavaboAufsatz: Bauer = (w, d, h) => {
  const r = Math.min(w, d);
  return [
    // Unterbau (Waschtisch-Möbel), reicht bis zur unteren bbox-Kante
    box([w * 0.96, h * 0.72, d * 0.9], [0, -h / 2 + h * 0.36, 0], "koerper"),
    // Waschtischplatte
    box([w, h * 0.16, d], [0, h * 0.02, 0], "hell"),
    // Aufsatzbecken (flacher Zylinder) auf der Platte
    zyl(r * 0.34, r * 0.34, h * 0.34, [0, h / 2 - h * 0.17, 0], "koerper"),
    // Beckenvertiefung (dunkler Innenraum)
    zyl(r * 0.26, r * 0.26, h * 0.14, [0, h / 2 - h * 0.09, 0], "dunkel"),
    // Armatur hinten an der Wandseite
    box([w * 0.06, h * 0.3, d * 0.06], [0, h / 2 - h * 0.15, -d * 0.34], "dunkel"),
  ];
};

// Lavabo Doppel: zwei Becken-Vertiefungen nebeneinander auf durchgehender Platte.
const lavaboDoppel: Bauer = (w, d, h) => [
  // Unterbau, reicht bis Plattenunterkante
  box([w * 0.98, h * 0.7, d * 0.9], [0, -h / 2 + h * 0.35, 0], "koerper"),
  // Durchgehende Platte
  box([w, h * 0.3, d], [0, h / 2 - h * 0.15, 0], "hell"),
  // Linke Beckenvertiefung
  box([w * 0.4, h * 0.12, d * 0.66], [-w * 0.24, h / 2 - h * 0.06, 0], "dunkel"),
  // Rechte Beckenvertiefung
  box([w * 0.4, h * 0.12, d * 0.66], [w * 0.24, h / 2 - h * 0.06, 0], "dunkel"),
  // Armatur links
  box([w * 0.05, h * 0.16, d * 0.05], [-w * 0.24, h / 2 - h * 0.08, -d * 0.34], "dunkel"),
  // Armatur rechts
  box([w * 0.05, h * 0.16, d * 0.05], [w * 0.24, h / 2 - h * 0.08, -d * 0.34], "dunkel"),
];

// Sofa L-Form: gerundete Haupt-Sitzbank + Longchair-Ecke + gerundete Lehnen +
// weiche Sitz-/Rückenkissen + Zierkissen + 4 Chrom-Füsse.
const sofaL: Bauer = (w, d, h) => {
  const rr = Math.min(w, d, h) * 0.08;
  const fuss = (x: number, z: number): Teil =>
    zyl(w * 0.016, w * 0.022, h * 0.1, [x, -h / 2 + h * 0.05, z], "chrom");
  return [
    // Haupt-Sitzkorpus (hintere Tiefe, volle Breite, gerundet)
    rbox([w, h * 0.32, d * 0.62], [0, -h / 2 + h * 0.24, -d / 2 + d * 0.31], rr, "koerper"),
    // Longchair-Ecke (zweite Sitzbox, gerundet)
    rbox([w * 0.46, h * 0.32, d], [w / 2 - w * 0.23, -h / 2 + h * 0.24, 0], rr, "koerper"),
    // Rückenlehne (hinten, gerundet)
    rbox([w, h * 0.5, d * 0.16], [0, -h / 2 + h * 0.62, -d / 2 + d * 0.08], rr, "koerper"),
    // Seitenlehne links (gerundet)
    rbox(
      [w * 0.1, h * 0.5, d * 0.62],
      [-w / 2 + w * 0.05, -h / 2 + h * 0.35, -d / 2 + d * 0.31],
      rr,
      "koerper",
    ),
    // Sitzkissen Hauptteil (weich)
    rbox(
      [w * 0.58, h * 0.15, d * 0.5],
      [-w * 0.16, -h / 2 + h * 0.47, -d / 2 + d * 0.3],
      rr,
      "hell",
    ),
    // Sitzkissen Longchair (weich)
    rbox(
      [w * 0.4, h * 0.15, d * 0.84],
      [w / 2 - w * 0.22, -h / 2 + h * 0.47, d * 0.02],
      rr,
      "hell",
    ),
    // Rückenkissen (weich)
    rbox(
      [w * 0.5, h * 0.28, d * 0.16],
      [-w * 0.18, -h / 2 + h * 0.6, -d / 2 + d * 0.22],
      rr,
      "hell",
    ),
    // Zierkissen (Akzent)
    rbox([w * 0.14, h * 0.2, d * 0.1], [-w * 0.3, -h / 2 + h * 0.55, -d * 0.02], rr, "dunkel"),
    // 4 Chrom-Füsse
    fuss(-w * 0.44, -d * 0.42),
    fuss(w * 0.44, -d * 0.42),
    fuss(-w * 0.44, d * 0.42),
    fuss(w * 0.44, d * 0.42),
  ];
};

// Dusche Eck: Viertelkreis angenähert – zwei Glaswände über Eck (vorne + rechts)
// mit Eckpfosten, dazu eine gerundete Eck-Wanne.
const duscheEck: Bauer = (w, d, h) => {
  const r = Math.min(w, d);
  return [
    // Wannenboden (flach)
    box([w * 0.98, h * 0.04, d * 0.98], [0, -h / 2 + h * 0.02, 0], "koerper"),
    // Gerundete Ecke vorne-rechts (flacher Zylinder – Viertelkreis-Andeutung)
    zyl(r * 0.5, r * 0.5, h * 0.05, [w / 2 - r * 0.5, -h / 2 + h * 0.025, d / 2 - r * 0.5], "hell"),
    // Wannenrand
    box([w, h * 0.07, d], [0, -h / 2 + h * 0.055, 0], "hell"),
    // Glaswand rechts (+x)
    box([w * 0.04, h * 0.86, d * 0.96], [w / 2 - w * 0.02, h * 0.02, 0], "glas"),
    // Glaswand vorne (+z)
    box([w * 0.96, h * 0.86, d * 0.04], [0, h * 0.02, d / 2 - d * 0.02], "glas"),
    // Eckpfosten vorne-rechts (verbindet die zwei Glaswände über Eck)
    box([w * 0.05, h * 0.9, d * 0.05], [w / 2 - w * 0.025, 0, d / 2 - d * 0.025], "dunkel"),
    // Armatur-Stange an der Rückwand-Ecke
    zyl(w * 0.02, w * 0.02, h * 0.4, [-w * 0.4, h * 0.1, -d * 0.42], "dunkel"),
    // Duschkopf
    zyl(w * 0.07, w * 0.07, h * 0.03, [-w * 0.4, h / 2 - h * 0.08, -d * 0.42], "dunkel"),
  ];
};

/** funktionsTyp → Bauteil-Bausatz. Fehlt ein Typ, greift der Box-Fallback. */
const BAUSAETZE: Record<string, Bauer> = {
  // ── Bad ───────────────────────────────────────────────────────────
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
  urinal,
  bidet,
  // ── Wohnen ────────────────────────────────────────────────────────
  sofa,
  sessel,
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
  // ── Schlafen ──────────────────────────────────────────────────────
  bett,
  einzelbett,
  doppelbett,
  kinderbett,
  kleiderschrank,
  nachttisch,
  kommode,
  // ── Büro / Arbeiten ───────────────────────────────────────────────
  schreibtisch,
  stuhl,
  esstischstuhl: stuhl,
  buerostuhl,
  hocker,
  // ── Küche ─────────────────────────────────────────────────────────
  unterschrank,
  hochschrank,
  haengeschrank,
  spuele,
  kochfeld,
  kuehlschrank,
  geschirrspueler,
  backofen,
  mikrowelle,
  dunstabzug,
  waschmaschine,
  tumbler,
  eckschrank,
  fuellstueck,
  // ── Varianten (per modell3d im Katalog-Item wählbar) ──────────────
  "wc-wandhaengend": wcWandhaengend,
  "lavabo-aufsatz": lavaboAufsatz,
  "lavabo-doppel": lavaboDoppel,
  "sofa-l": sofaL,
  "dusche-eck": duscheEck,
};

/**
 * Wählt den Bausatz-Schlüssel für ein Katalog-Item: die Variante `modell3d`,
 * sofern sie registriert ist – sonst der funktionsTyp (Standard-Bausatz).
 * Dadurch bleibt {@link bauteile} schlicht (ein Lookup + Box-Fallback): der
 * gesamte Variantenentscheid steckt hier.
 *
 * ── Neue Variante hinzufügen in 3 Schritten ──────────────────────────
 * 1. Bauer schreiben (parametrisch auf w/d/h, bbox-treu wie die Basis-Bausätze).
 * 2. Oben in BAUSAETZE unter einem `kebab-case`-Schlüssel registrieren.
 * 3. Im Katalog-Item das Feld `modell3d` auf genau diesen Schlüssel setzen.
 * Später kommen echte Assets über gltfRef – modell3d bleibt der Primitiv-Weg.
 */
export function bausatzSchluessel(funktionsTyp: string, modell3d?: string): string {
  return modell3d && modell3d in BAUSAETZE ? modell3d : funktionsTyp;
}

/**
 * Zwängt ein Bauteil garantiert in die bbox w×d×h (Ursprung = Mitte).
 * Sicherheitsnetz für die Norm-Ampel-Invariante: hält JEDE Komposition –
 * egal wie detailliert oder bei welchem Seitenverhältnis – innerhalb des
 * Footprints. Bei realen Katalog-Massen ein No-Op; greift nur, wenn ein
 * Detail (z.B. eine Armatur) sonst überstehen würde.
 */
export function clampTeil(t: Teil, w: number, d: number, h: number): Teil {
  const fit = (c: number, halb: number, limit: number): [number, number] => {
    const lo = Math.max(c - halb, -limit);
    const hi = Math.min(c + halb, limit);
    return hi <= lo ? [Math.max(-limit, Math.min(limit, c)), 0] : [(lo + hi) / 2, (hi - lo) / 2];
  };
  const klemm = (c: number, spiel: number) => Math.max(-spiel, Math.min(spiel, c));
  if (t.form === "box" || t.form === "rundbox") {
    const [cx, hx] = fit(t.pos[0], t.groesse[0] / 2, w / 2);
    const [cy, hy] = fit(t.pos[1], t.groesse[1] / 2, h / 2);
    const [cz, hz] = fit(t.pos[2], t.groesse[2] / 2, d / 2);
    const groesse: [number, number, number] = [hx * 2, hy * 2, hz * 2];
    if (t.form === "rundbox") {
      // Rundungsradius darf nie eine halbe Kantenlänge überschreiten.
      const radius = Math.max(0, Math.min(t.radius, hx, hy, hz));
      return { ...t, groesse, radius, pos: [cx, cy, cz] };
    }
    return { ...t, groesse, pos: [cx, cy, cz] };
  }
  if (t.form === "torus") {
    const [hex, hey, hez] = torusHalb(t.radius, t.roehre, t.achse);
    const skala = Math.min(1, w / 2 / hex, h / 2 / hey, d / 2 / hez);
    const radius = t.radius * skala;
    const roehre = t.roehre * skala;
    const [nx, ny, nz] = torusHalb(radius, roehre, t.achse);
    return {
      ...t,
      radius,
      roehre,
      pos: [klemm(t.pos[0], w / 2 - nx), klemm(t.pos[1], h / 2 - ny), klemm(t.pos[2], d / 2 - nz)],
    };
  }
  if (t.form === "lathe") {
    const rMax = Math.max(0, ...t.profil.map((p) => p[0]));
    const skalaR = rMax > 0 ? Math.min(1, w / 2 / rMax, d / 2 / rMax) : 1;
    const ys = t.profil.map((p) => p[1]);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    const spanne = yMax - yMin;
    const skalaY = spanne > 0 ? Math.min(1, h / spanne) : 1;
    const profil = t.profil.map(([r, y]) => [r * skalaR, y * skalaY] as [number, number]);
    const rMax2 = rMax * skalaR;
    const yMin2 = yMin * skalaY;
    const yMax2 = yMax * skalaY;
    const cy = Math.max(-h / 2 - yMin2, Math.min(h / 2 - yMax2, t.pos[1]));
    return {
      ...t,
      profil,
      pos: [klemm(t.pos[0], w / 2 - rMax2), cy, klemm(t.pos[2], d / 2 - rMax2)],
    };
  }
  if (t.form === "zylinder") {
    const rMax = Math.max(t.rTop, t.rBottom);
    const r = Math.min(rMax, w / 2, d / 2);
    const skala = rMax > 0 ? r / rMax : 1;
    const [cy, hy] = fit(t.pos[1], t.hoehe / 2, h / 2);
    return {
      ...t,
      rTop: t.rTop * skala,
      rBottom: t.rBottom * skala,
      hoehe: hy * 2,
      pos: [klemm(t.pos[0], w / 2 - r), cy, klemm(t.pos[2], d / 2 - r)],
    };
  }
  const rad = Math.min(t.radius, w / 2, d / 2, h / 2);
  return {
    ...t,
    radius: rad,
    pos: [klemm(t.pos[0], w / 2 - rad), klemm(t.pos[1], h / 2 - rad), klemm(t.pos[2], d / 2 - rad)],
  };
}

/**
 * Liefert die Primitiv-Bauteile für einen Bausatz-Schlüssel (funktionsTyp ODER
 * registrierte Variante, siehe {@link bausatzSchluessel}). Unbekannte Schlüssel
 * fallen auf die bisherige einfache Box (volle bbox, Hauptkörperfarbe) zurück –
 * damit bleibt das Verhalten für nicht abgedeckte Items unverändert. Bleibt
 * bewusst schlicht: der Variantenentscheid passiert in bausatzSchluessel.
 */
export function bauteile(schluessel: string, w: number, d: number, h: number): Teil[] {
  const bauer = BAUSAETZE[schluessel];
  const roh = bauer ? bauer(w, d, h) : [box([w, h, d], [0, 0, 0], "koerper")];
  // Sicherheitsnetz: jedes Bauteil bleibt garantiert in der bbox (Norm-Ampel).
  return roh.map((t) => clampTeil(t, w, d, h));
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
    if (t.form === "box" || t.form === "rundbox") {
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
    if (t.form === "torus") {
      const [hx, hy, hz] = torusHalb(t.radius, t.roehre, t.achse);
      return drin(t.pos[0], hx, w / 2) && drin(t.pos[1], hy, h / 2) && drin(t.pos[2], hz, d / 2);
    }
    if (t.form === "lathe") {
      const rMax = Math.max(0, ...t.profil.map((p) => p[0]));
      const ys = t.profil.map((p) => p[1]);
      const yMin = Math.min(...ys);
      const yMax = Math.max(...ys);
      // Profil-y ist relativ zu pos, daher asymmetrische y-Prüfung.
      return (
        drin(t.pos[0], rMax, w / 2) &&
        drin(t.pos[2], rMax, d / 2) &&
        t.pos[1] + yMax <= h / 2 + eps &&
        t.pos[1] + yMin >= -h / 2 - eps
      );
    }
    return (
      drin(t.pos[0], t.radius, w / 2) &&
      drin(t.pos[1], t.radius, h / 2) &&
      drin(t.pos[2], t.radius, d / 2)
    );
  });
}

/**
 * Material-Eigenschaften je Rolle (echte three-Props). Ändert NIE die Basisfarbe
 * (die kommt aus `rolleFarbe`/Ampel) – nur die Oberflächen-Physik:
 * - `glas`  → transparent, sehr glatt.
 * - `chrom` → poliertes Metall (hohe metalness, niedrige roughness).
 * - Keramik/Holz (`koerper|hell|dunkel`) → matt, keine Spiegelung.
 * Die Norm-Ampel-Färbung (Viewer3D) übersteuert weiter allein die Farbe.
 */
function TeilMaterial({ rolle, farbwert }: { rolle: Rolle; farbwert: string }) {
  if (rolle === "glas") {
    return <meshStandardMaterial color={farbwert} transparent opacity={0.22} roughness={0.05} />;
  }
  if (rolle === "chrom") {
    // Ohne Environment-Map bleibt metalness bewusst moderat, damit das Metall
    // nicht schwarz kippt, aber klar glänzt (scharfes Highlight vom
    // directionalLight). Der helle Grundton (rolleFarbe) trägt den Chrom-Look.
    return <meshStandardMaterial color={farbwert} metalness={0.6} roughness={0.14} />;
  }
  const roughness = rolle === "dunkel" ? 0.62 : rolle === "hell" ? 0.5 : 0.55;
  return <meshStandardMaterial color={farbwert} metalness={0.03} roughness={roughness} />;
}

/** Rendert ein einzelnes Bauteil als Mesh (lokale Koordinaten der Gruppe). */
function TeilMesh({ teil, farbe }: { teil: Teil; farbe: string }) {
  const farbwert = rolleFarbe(teil.rolle, farbe);
  const material = <TeilMaterial rolle={teil.rolle} farbwert={farbwert} />;
  if (teil.form === "box") {
    return (
      <mesh position={teil.pos}>
        <boxGeometry args={teil.groesse} />
        {material}
      </mesh>
    );
  }
  if (teil.form === "rundbox") {
    const minHalb = Math.min(...teil.groesse) / 2;
    const radius = Math.max(0, Math.min(teil.radius, minHalb - 1e-4));
    // Degenerierter Radius (sehr flache Teile) → schlichte Box statt RoundedBox.
    if (radius < 1e-4) {
      return (
        <mesh position={teil.pos}>
          <boxGeometry args={teil.groesse} />
          {material}
        </mesh>
      );
    }
    return (
      <RoundedBox position={teil.pos} args={teil.groesse} radius={radius} smoothness={3} steps={1}>
        {material}
      </RoundedBox>
    );
  }
  if (teil.form === "zylinder") {
    return (
      <mesh position={teil.pos}>
        <cylinderGeometry args={[teil.rTop, teil.rBottom, teil.hoehe, 24]} />
        {material}
      </mesh>
    );
  }
  if (teil.form === "lathe") {
    const punkte = teil.profil.map(([r, y]) => new Vector2(Math.max(0, r), y));
    return (
      <mesh position={teil.pos}>
        <latheGeometry args={[punkte, teil.segmente]} />
        {material}
      </mesh>
    );
  }
  if (teil.form === "torus") {
    const rot: [number, number, number] =
      teil.achse === "y"
        ? [Math.PI / 2, 0, 0]
        : teil.achse === "x"
          ? [0, Math.PI / 2, 0]
          : [0, 0, 0];
    return (
      <mesh position={teil.pos} rotation={rot}>
        <torusGeometry args={[teil.radius, teil.roehre, 16, 32]} />
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
  modell3d,
  w,
  d,
  h,
  farbe,
}: {
  funktionsTyp: string;
  /** Optionale 3D-Bausatz-Variante (Katalog-Feld modell3d); wählt den Bausatz. */
  modell3d?: string;
  w: number;
  d: number;
  h: number;
  farbe: string;
}) {
  const teile = bauteile(bausatzSchluessel(funktionsTyp, modell3d), w, d, h);
  return (
    <>
      {teile.map((teil, i) => (
        <TeilMesh key={i} teil={teil} farbe={farbe} />
      ))}
    </>
  );
}
