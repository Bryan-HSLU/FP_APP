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

// Badewanne: Wanne mit Rand, Armatur, Abfluss
const badewanne: Bauer = (w, d, h) => [
  // Aussenkörper
  box([w, h * 0.88, d], [0, -h / 2 + h * 0.44, 0], "koerper"),
  // Oberer Rand
  box([w, h * 0.1, d], [0, h / 2 - h * 0.05, 0], "hell"),
  // Innenwanne (dunkle Vertiefung)
  box([w * 0.84, h * 0.06, d * 0.8], [0, h / 2 - h * 0.12, 0], "dunkel"),
  // Füsse (4 Zylinder an den Ecken)
  zyl(w * 0.03, w * 0.03, h * 0.1, [-w * 0.42, -h / 2 + h * 0.05, -d * 0.42], "dunkel"),
  zyl(w * 0.03, w * 0.03, h * 0.1, [w * 0.42, -h / 2 + h * 0.05, -d * 0.42], "dunkel"),
  zyl(w * 0.03, w * 0.03, h * 0.1, [-w * 0.42, -h / 2 + h * 0.05, d * 0.42], "dunkel"),
  zyl(w * 0.03, w * 0.03, h * 0.1, [w * 0.42, -h / 2 + h * 0.05, d * 0.42], "dunkel"),
  // Armatur
  box([w * 0.07, h * 0.15, d * 0.06], [-w * 0.35, h / 2 - h * 0.08, -d / 2 + d * 0.08], "dunkel"),
];

// Spiegel: Rahmen + Spiegelfläche + kleine Ablage unten
const spiegel: Bauer = (w, d, h) => [
  // Rahmen
  box([w, h, d * 0.55], [0, 0, -d * 0.23], "dunkel"),
  // Spiegelfläche (hell/glas)
  box([w * 0.9, h * 0.9, d * 0.35], [0, 0, d * 0.05], "glas"),
  // Ablage unten
  box([w, h * 0.08, d * 0.5], [0, -h / 2 + h * 0.04, d * 0.05], "hell"),
];

// Badmöbel (Waschtisch-Unterschrank): 2 Schubladen, Griffe, Sockel
const badmoebel: Bauer = (w, d, h) => [
  // Korpus
  box([w, h * 0.82, d], [0, -h / 2 + h * 0.41, 0], "koerper"),
  // Oberer Abschluss
  box([w, h * 0.08, d], [0, h / 2 - h * 0.04, 0], "dunkel"),
  // Sockel zurückgesetzt
  box([w * 0.9, h * 0.06, d * 0.6], [0, -h / 2 + h * 0.03, 0], "dunkel"),
  // Trennlinie Mitte (2 Türen)
  box([w * 0.014, h * 0.68, d * 0.02], [0, -h * 0.04, d / 2 - d * 0.01], "dunkel"),
  // Griff links
  box([w * 0.012, h * 0.06, d * 0.04], [-w * 0.18, -h * 0.04, d / 2 - d * 0.02], "hell"),
  // Griff rechts
  box([w * 0.012, h * 0.06, d * 0.04], [w * 0.18, -h * 0.04, d / 2 - d * 0.02], "hell"),
];

// Handtuchstange: Stange + 2 Wandhalter + aufgehängtes Tuch
const handtuchstange: Bauer = (w, d, h) => [
  // Stange
  zyl(w * 0.025, w * 0.025, w * 0.92, [0, 0, d / 2 - d * 0.1], "hell"),
  // Linker Halter
  box([w * 0.04, h * 0.22, d * 0.38], [-w * 0.44, 0, d / 2 - d * 0.22], "dunkel"),
  // Rechter Halter
  box([w * 0.04, h * 0.22, d * 0.38], [w * 0.44, 0, d / 2 - d * 0.22], "dunkel"),
  // Tuch (hängendes Textil, leicht über Stange hinaus – bleibt in bbox)
  box([w * 0.82, h * 0.7, d * 0.04], [0, -h * 0.1, d / 2 - d * 0.08], "koerper"),
];

// Handtuchheizung: Wandplatte + Heizrohre
const handtuchheizung: Bauer = (w, d, h) => [
  // Wandplatte
  box([w, h, d * 0.45], [0, 0, -d * 0.28], "koerper"),
  // 6 horizontale Heizrohre
  ...Array.from({ length: 6 }, (_, i) =>
    zyl(w * 0.03, w * 0.03, w * 0.88, [0, -h * 0.38 + i * (h * 0.76) * 0.2, d * 0.04], "hell"),
  ),
  // Vertikale Verbindungsrohre links/rechts
  box([w * 0.04, h * 0.96, d * 0.06], [-w * 0.44, 0, d * 0.02], "dunkel"),
  box([w * 0.04, h * 0.96, d * 0.06], [w * 0.44, 0, d * 0.02], "dunkel"),
];

// Urinal: Wandmontiert, Keramik-Schale + Wasserzulauf
const urinal: Bauer = (w, d, h) => [
  // Hauptkörper kegelförmig
  box([w * 0.9, h * 0.65, d * 0.82], [0, -h / 2 + h * 0.38, 0], "koerper"),
  // Obere Schale (Vertiefung)
  box([w * 0.72, h * 0.06, d * 0.58], [0, h / 2 - h * 0.36, d * 0.08], "dunkel"),
  // Zulaufrohr oben
  box([w * 0.08, h * 0.22, d * 0.06], [0, h / 2 - h * 0.11, -d / 2 + d * 0.06], "dunkel"),
  // Spülknopf
  box([w * 0.1, h * 0.04, d * 0.04], [0, h / 2 - h * 0.12, -d / 2 + d * 0.12], "hell"),
];

// Bidet: Ähnlich WC aber schmaler, mit Armatur
const bidet: Bauer = (w, d, h) => [
  // Keramikschale
  box([w * 0.92, h * 0.46, d * 0.82], [0, -h / 2 + h * 0.23, 0], "koerper"),
  // Sitzfläche (offen in der Mitte)
  box([w * 0.9, h * 0.05, d * 0.8], [0, -h / 2 + h * 0.5, 0], "hell"),
  // Armatur vorne
  box([w * 0.08, h * 0.25, d * 0.08], [0, h / 2 - h * 0.12, -d / 2 + d * 0.1], "dunkel"),
  // Auslauf
  box([w * 0.04, h * 0.04, d * 0.22], [0, h / 2 - h * 0.05, -d / 2 + d * 0.2], "dunkel"),
];

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

// Flache Matte (Teppich/Badteppich): sehr niedrig, mit dezenter Musterfläche.
const matte: Bauer = (w, d, h) => [
  box([w, h * 0.6, d], [0, -h / 2 + h * 0.3, 0], "koerper"),
  box([w * 0.82, h * 0.55, d * 0.82], [0, h / 2 - h * 0.275, 0], "hell"),
];

// ═══════════════════════════════════════════════════════════════════
// WOHNEN / SCHLAFEN
// ═══════════════════════════════════════════════════════════════════

// Sofa: Sitz + Rückenlehne + 2 Armlehnen + 3 Kissen
const sofa: Bauer = (w, d, h) => [
  // Sitzfläche
  box([w, h * 0.38, d], [0, -h / 2 + h * 0.19, 0], "koerper"),
  // Rückenlehne
  box([w, h * 0.52, d * 0.22], [0, h / 2 - h * 0.26, -d / 2 + d * 0.11], "koerper"),
  // Linke Armlehne
  box([w * 0.12, h * 0.58, d], [-w / 2 + w * 0.06, -h / 2 + h * 0.29, 0], "koerper"),
  // Rechte Armlehne
  box([w * 0.12, h * 0.58, d], [w / 2 - w * 0.06, -h / 2 + h * 0.29, 0], "koerper"),
  // Kissen links
  box([w * 0.24, h * 0.16, d * 0.72], [-w * 0.24, -h / 2 + h * 0.48, d * 0.06], "hell"),
  // Kissen mitte
  box([w * 0.24, h * 0.16, d * 0.72], [0, -h / 2 + h * 0.48, d * 0.06], "hell"),
  // Kissen rechts
  box([w * 0.24, h * 0.16, d * 0.72], [w * 0.24, -h / 2 + h * 0.48, d * 0.06], "hell"),
  // 4 Füsse
  box([w * 0.06, h * 0.06, d * 0.06], [-w * 0.42, -h / 2 + h * 0.03, -d * 0.42], "dunkel"),
  box([w * 0.06, h * 0.06, d * 0.06], [w * 0.42, -h / 2 + h * 0.03, -d * 0.42], "dunkel"),
  box([w * 0.06, h * 0.06, d * 0.06], [-w * 0.42, -h / 2 + h * 0.03, d * 0.42], "dunkel"),
  box([w * 0.06, h * 0.06, d * 0.06], [w * 0.42, -h / 2 + h * 0.03, d * 0.42], "dunkel"),
];

// Sessel: Sitz + Rückenlehne + 2 Armlehnen + Kissen + 4 Beine
const sessel: Bauer = (w, d, h) => [
  // Sitz
  box([w, h * 0.4, d], [0, -h / 2 + h * 0.2, 0], "koerper"),
  // Rückenlehne
  box([w, h * 0.52, d * 0.2], [0, h / 2 - h * 0.26, -d / 2 + d * 0.1], "koerper"),
  // Linke Armlehne
  box([w * 0.14, h * 0.55, d], [-w / 2 + w * 0.07, -h / 2 + h * 0.275, 0], "koerper"),
  // Rechte Armlehne
  box([w * 0.14, h * 0.55, d], [w / 2 - w * 0.07, -h / 2 + h * 0.275, 0], "koerper"),
  // Sitzkissen
  box([w * 0.7, h * 0.14, d * 0.78], [0, -h / 2 + h * 0.47, d * 0.04], "hell"),
  // 4 Beine
  box([w * 0.07, h * 0.12, d * 0.07], [-w * 0.38, -h / 2 + h * 0.06, -d * 0.38], "dunkel"),
  box([w * 0.07, h * 0.12, d * 0.07], [w * 0.38, -h / 2 + h * 0.06, -d * 0.38], "dunkel"),
  box([w * 0.07, h * 0.12, d * 0.07], [-w * 0.38, -h / 2 + h * 0.06, d * 0.38], "dunkel"),
  box([w * 0.07, h * 0.12, d * 0.07], [w * 0.38, -h / 2 + h * 0.06, d * 0.38], "dunkel"),
];

// Tisch: Platte + 4 Beine (Ess-/Couch-/Beistelltisch)
const tisch: Bauer = (w, d, h) => {
  const bx = w / 2 - w * 0.06;
  const bz = d / 2 - d * 0.06;
  const bein = (x: number, z: number): Teil =>
    box([w * 0.06, h * 0.88, d * 0.06], [x, -h / 2 + h * 0.44, z], "dunkel");
  return [
    // Tischplatte
    box([w, h * 0.09, d], [0, h / 2 - h * 0.045, 0], "koerper"),
    // Unterseite der Platte leicht heller
    box([w * 0.94, h * 0.03, d * 0.94], [0, h / 2 - h * 0.1, 0], "hell"),
    bein(-bx, -bz),
    bein(bx, -bz),
    bein(-bx, bz),
    bein(bx, bz),
  ];
};

// Regal: 2 Seitenwände + Rückwand + 4 Böden
const regal: Bauer = (w, d, h) => [
  // Linke Wand
  box([w * 0.05, h, d], [-w / 2 + w * 0.025, 0, 0], "koerper"),
  // Rechte Wand
  box([w * 0.05, h, d], [w / 2 - w * 0.025, 0, 0], "koerper"),
  // Rückwand
  box([w, h, d * 0.05], [0, 0, -d / 2 + d * 0.025], "dunkel"),
  // Deckplatte
  box([w, h * 0.04, d], [0, h / 2 - h * 0.02, 0], "koerper"),
  // 4 Einlegeböden
  ...Array.from({ length: 4 }, (_, i) =>
    box([w * 0.9, h * 0.04, d * 0.9], [0, -h / 2 + h * 0.03 + i * (h * 0.94) * (1 / 3), 0], "hell"),
  ),
];

// Sideboard: Korpus + 4 Füsse + Griffe + Schattenfuge
const sideboard: Bauer = (w, d, h) => {
  const fx = w / 2 - w * 0.05;
  const fz = d / 2 - d * 0.1;
  const fuss = (x: number, z: number): Teil =>
    box([w * 0.05, h * 0.15, d * 0.1], [x, -h / 2 + h * 0.075, z], "dunkel");
  return [
    // Korpus
    box([w, h * 0.85, d], [0, -h / 2 + h * 0.15 + h * 0.425, 0], "koerper"),
    // Schattenfuge (Trennlinie)
    box([w * 0.012, h * 0.7, d * 0.02], [-w / 3, h * 0.1, d / 2 - d * 0.01], "dunkel"),
    box([w * 0.012, h * 0.7, d * 0.02], [0, h * 0.1, d / 2 - d * 0.01], "dunkel"),
    box([w * 0.012, h * 0.7, d * 0.02], [w / 3, h * 0.1, d / 2 - d * 0.01], "dunkel"),
    // Griff links
    box([w * 0.1, h * 0.04, d * 0.04], [-w * 0.24, h * 0.1, d / 2 - d * 0.02], "hell"),
    // Griff rechts
    box([w * 0.1, h * 0.04, d * 0.04], [w * 0.24, h * 0.1, d / 2 - d * 0.02], "hell"),
    fuss(-fx, -fz),
    fuss(fx, -fz),
    fuss(-fx, fz),
    fuss(fx, fz),
  ];
};

// Stehleuchte: Fussplatte + Stab + Schirm
const stehleuchte: Bauer = (w, d, h) => {
  const r = Math.min(w, d);
  return [
    // Fussplatte (flach)
    zyl(r * 0.38, r * 0.42, h * 0.025, [0, -h / 2 + h * 0.013, 0], "dunkel"),
    // Stab
    zyl(r * 0.04, r * 0.05, h * 0.72, [0, -h / 2 + h * 0.36, 0], "dunkel"),
    // Schirm aussen
    zyl(r * 0.46, r * 0.28, h * 0.18, [0, h / 2 - h * 0.09, 0], "koerper"),
    // Schirm-Innenfläche (leuchtet heller)
    zyl(r * 0.38, r * 0.22, h * 0.15, [0, h / 2 - h * 0.08, 0], "hell"),
  ];
};

// Pflanze: Topf + Erde + Kugelbüsche
const pflanze: Bauer = (w, d, h) => {
  const r = Math.min(w, d);
  const rL = Math.min(r * 0.44, h * 0.28);
  return [
    // Topf aussen
    zyl(r * 0.34, r * 0.26, h * 0.3, [0, -h / 2 + h * 0.15, 0], "dunkel"),
    // Erde
    zyl(r * 0.3, r * 0.3, h * 0.06, [0, -h / 2 + h * 0.32, 0], "dunkel"),
    // Grosser Hauptbusch
    kugel(rL, [0, h / 2 - rL, 0], "koerper"),
    // Kleiner Nebenbusch leicht versetzt
    kugel(rL * 0.62, [r * 0.14, h / 2 - rL * 1.1, r * 0.12], "hell"),
    // Zweiter Nebenbusch
    kugel(rL * 0.5, [-r * 0.12, h / 2 - rL * 1.2, -r * 0.1], "koerper"),
  ];
};

// Wandbild: Rahmen + Passepartout + Bildfläche
const wandbild: Bauer = (w, d, h) => [
  // Rahmen
  box([w, h, d * 0.5], [0, 0, -d * 0.25], "dunkel"),
  // Passepartout (heller Rand)
  box([w * 0.9, h * 0.9, d * 0.38], [0, 0, d * 0.01], "hell"),
  // Bildfläche (leicht abgestuft)
  box([w * 0.78, h * 0.78, d * 0.32], [0, 0, d * 0.08], "koerper"),
];

// Wandleuchte: Wandplatte + Arm + Schirm
const wandleuchte: Bauer = (w, d, h) => [
  // Wandplatte
  box([w * 0.52, h * 0.52, d * 0.44], [0, 0, -d * 0.28], "dunkel"),
  // Arm
  box([w * 0.12, h * 0.08, d * 0.52], [0, h * 0.1, 0], "dunkel"),
  // Schirm (zylindrisch, leuchtet nach unten)
  zyl(Math.min(w, d) * 0.38, Math.min(w, d) * 0.22, h * 0.32, [0, -h * 0.06, d * 0.15], "hell"),
];

// TV-Möbel: Unterschrank + TV-Panel + Fuss + Standfuss
const tvmoebel: Bauer = (w, d, h) => [
  // Unterschrank
  box([w, h * 0.44, d], [0, -h / 2 + h * 0.22, 0], "koerper"),
  // Schattenfuge (3 Türen)
  box([w * 0.014, h * 0.38, d * 0.02], [-w * 0.33, -h / 2 + h * 0.22, d / 2 - d * 0.01], "dunkel"),
  box([w * 0.014, h * 0.38, d * 0.02], [w * 0.33, -h / 2 + h * 0.22, d / 2 - d * 0.01], "dunkel"),
  // TV-Bildschirm
  box([w * 0.82, h * 0.48, d * 0.06], [0, -h / 2 + h * 0.7, -d / 2 + d * 0.09], "dunkel"),
  // TV-Bildschirm Fläche (heller)
  box([w * 0.76, h * 0.42, d * 0.04], [0, -h / 2 + h * 0.7, -d / 2 + d * 0.11], "glas"),
  // TV-Standfuss
  box([w * 0.1, h * 0.04, d * 0.12], [0, -h / 2 + h * 0.46, -d / 2 + d * 0.1], "dunkel"),
];

// Deko: Sockel + Kugel (generisches Deko-Objekt)
const deko: Bauer = (w, d, h) => {
  const r = Math.min(Math.min(w, d) * 0.45, h * 0.45);
  return [
    box([w * 0.7, h * 0.3, d * 0.7], [0, -h / 2 + h * 0.15, 0], "dunkel"),
    kugel(r, [0, h / 2 - r, 0], "hell"),
  ];
};

// Bett (allgemein): Bettkasten + Matratze + 2 Kissen + Kopfteil
const bett: Bauer = (w, d, h) => [
  // Bettkasten (Holz)
  box([w, h * 0.35, d], [0, -h / 2 + h * 0.175, 0], "koerper"),
  // Matratze
  box([w * 0.96, h * 0.22, d * 0.96], [0, -h / 2 + h * 0.46, 0], "hell"),
  // Kopfteil
  box([w, h * 0.48, d * 0.1], [0, h / 2 - h * 0.24, -d / 2 + d * 0.05], "koerper"),
  // Bettdecke
  box([w * 0.92, h * 0.08, d * 0.72], [0, -h / 2 + h * 0.6, d * 0.08], "hell"),
  // Kissen links
  box([w * 0.38, h * 0.1, d * 0.18], [-w * 0.24, -h / 2 + h * 0.63, -d * 0.3], "glas"),
  // Kissen rechts
  box([w * 0.38, h * 0.1, d * 0.18], [w * 0.24, -h / 2 + h * 0.63, -d * 0.3], "glas"),
  // Fussende
  box([w, h * 0.22, d * 0.07], [0, -h / 2 + h * 0.11, d / 2 - d * 0.035], "dunkel"),
];

// Einzelbett = gleiche Form wie Bett, Alias
const einzelbett: Bauer = bett;

// Doppelbett = Bett + 2 Nachttische-Lücken (visuell breiteres Kopfteil)
const doppelbett: Bauer = (w, d, h) => [
  // Bettkasten
  box([w, h * 0.35, d], [0, -h / 2 + h * 0.175, 0], "koerper"),
  // Matratze links
  box([w * 0.46, h * 0.22, d * 0.96], [-w * 0.24, -h / 2 + h * 0.46, 0], "hell"),
  // Matratze rechts
  box([w * 0.46, h * 0.22, d * 0.96], [w * 0.24, -h / 2 + h * 0.46, 0], "hell"),
  // Kopfteil
  box([w, h * 0.52, d * 0.1], [0, h / 2 - h * 0.26, -d / 2 + d * 0.05], "koerper"),
  // Bettdecke links
  box([w * 0.44, h * 0.08, d * 0.72], [-w * 0.24, -h / 2 + h * 0.6, d * 0.08], "glas"),
  // Bettdecke rechts
  box([w * 0.44, h * 0.08, d * 0.72], [w * 0.24, -h / 2 + h * 0.6, d * 0.08], "glas"),
  // Kissen links
  box([w * 0.36, h * 0.1, d * 0.16], [-w * 0.24, -h / 2 + h * 0.63, -d * 0.3], "hell"),
  // Kissen rechts
  box([w * 0.36, h * 0.1, d * 0.16], [w * 0.24, -h / 2 + h * 0.63, -d * 0.3], "hell"),
  // Fussende
  box([w, h * 0.22, d * 0.07], [0, -h / 2 + h * 0.11, d / 2 - d * 0.035], "dunkel"),
];

// Kinderbett: Wie Bett aber mit Gitterstäben als Seitenteile
const kinderbett: Bauer = (w, d, h) => [
  // Bettkasten
  box([w, h * 0.35, d], [0, -h / 2 + h * 0.175, 0], "koerper"),
  // Matratze
  box([w * 0.94, h * 0.18, d * 0.94], [0, -h / 2 + h * 0.44, 0], "hell"),
  // Kopfteil (höher, wie Gitter)
  box([w, h * 0.58, d * 0.08], [0, h / 2 - h * 0.29, -d / 2 + d * 0.04], "koerper"),
  // Fussende-Gitter
  box([w, h * 0.4, d * 0.08], [0, -h / 2 + h * 0.38, d / 2 - d * 0.04], "koerper"),
  // Gitterstäbe links (4 Stäbe als vertikale Boxen)
  ...Array.from({ length: 4 }, (_, i) =>
    box(
      [w * 0.04, h * 0.38, d * 0.07],
      [-w * 0.4 + i * w * 0.27, -h / 2 + h * 0.36, -d * 0.45],
      "dunkel",
    ),
  ),
  // Gitterstäbe rechts
  ...Array.from({ length: 4 }, (_, i) =>
    box(
      [w * 0.04, h * 0.38, d * 0.07],
      [-w * 0.4 + i * w * 0.27, -h / 2 + h * 0.36, d * 0.45],
      "dunkel",
    ),
  ),
];

// Kleiderschrank: Breiter Korpus + Schiebetüren + Griffe
const kleiderschrank: Bauer = (w, d, h) => [
  // Korpus
  box([w, h * 0.97, d], [0, -h / 2 + h * 0.485, 0], "koerper"),
  // Sockel
  box([w * 0.96, h * 0.04, d * 0.7], [0, -h / 2 + h * 0.02, 0], "dunkel"),
  // Deckplatte
  box([w * 0.98, h * 0.04, d], [0, h / 2 - h * 0.02, 0], "dunkel"),
  // Tür-Trennlinie (2 Schiebetüren)
  box([w * 0.014, h * 0.9, d * 0.02], [-w * 0.25, 0, d / 2 - d * 0.01], "dunkel"),
  box([w * 0.014, h * 0.9, d * 0.02], [w * 0.25, 0, d / 2 - d * 0.015], "hell"),
  // Griff links
  box([w * 0.04, h * 0.06, d * 0.04], [-w * 0.12, 0, d / 2 - d * 0.02], "hell"),
  // Griff rechts
  box([w * 0.04, h * 0.06, d * 0.04], [w * 0.38, 0, d / 2 - d * 0.025], "hell"),
];

// Nachttisch: Schrank + Schublade + Griff + Tischlampe-Andeutung
const nachttisch: Bauer = (w, d, h) => [
  // Korpus
  box([w, h * 0.86, d], [0, -h / 2 + h * 0.43, 0], "koerper"),
  // Deckplatte
  box([w, h * 0.07, d], [0, h / 2 - h * 0.035, 0], "dunkel"),
  // Schublade-Trennlinie
  box([w * 0.9, h * 0.015, d * 0.02], [0, -h * 0.08, d / 2 - d * 0.01], "dunkel"),
  // Griff
  box([w * 0.3, h * 0.04, d * 0.04], [0, -h * 0.08, d / 2 - d * 0.02], "hell"),
  // Sockel
  box([w * 0.88, h * 0.05, d * 0.7], [0, -h / 2 + h * 0.025, 0], "dunkel"),
];

// Kommode: 4 Schubladen, Griffe, Füsse
const kommode: Bauer = (w, d, h) => {
  const fuss = (x: number, z: number): Teil =>
    box([w * 0.06, h * 0.08, d * 0.06], [x, -h / 2 + h * 0.04, z], "dunkel");
  return [
    // Korpus
    box([w, h * 0.88, d], [0, -h / 2 + h * 0.48, 0], "koerper"),
    // Deckplatte
    box([w, h * 0.07, d], [0, h / 2 - h * 0.035, 0], "dunkel"),
    // 4 Schubladen-Trennlinien
    box([w * 0.9, h * 0.012, d * 0.02], [0, -h * 0.04, d / 2 - d * 0.01], "dunkel"),
    box([w * 0.9, h * 0.012, d * 0.02], [0, -h * 0.26, d / 2 - d * 0.01], "dunkel"),
    box([w * 0.9, h * 0.012, d * 0.02], [0, h * 0.16, d / 2 - d * 0.01], "dunkel"),
    // Griffe (4)
    box([w * 0.25, h * 0.04, d * 0.04], [0, -h * 0.04, d / 2 - d * 0.02], "hell"),
    box([w * 0.25, h * 0.04, d * 0.04], [0, -h * 0.26, d / 2 - d * 0.02], "hell"),
    box([w * 0.25, h * 0.04, d * 0.04], [0, h * 0.16, d / 2 - d * 0.02], "hell"),
    box([w * 0.25, h * 0.04, d * 0.04], [0, h * 0.36, d / 2 - d * 0.02], "hell"),
    // 4 Füsse
    fuss(-w * 0.42, -d * 0.38),
    fuss(w * 0.42, -d * 0.38),
    fuss(-w * 0.42, d * 0.38),
    fuss(w * 0.42, d * 0.38),
  ];
};

// Stuhl (Ess-/Beistellstuhl): Sitz + 4 Beine + Rückenlehne
const stuhl: Bauer = (w, d, h) => {
  const bx = w / 2 - w * 0.08;
  const bz = d / 2 - d * 0.08;
  const bein = (x: number, z: number, hFaktor: number): Teil =>
    box([w * 0.06, h * hFaktor, d * 0.06], [x, -h / 2 + h * (hFaktor / 2), z], "dunkel");
  return [
    // Sitzfläche
    box([w, h * 0.08, d * 0.9], [0, h / 2 - h * 0.55, 0], "koerper"),
    // Sitzpolster
    box([w * 0.88, h * 0.06, d * 0.78], [0, h / 2 - h * 0.5, 0], "hell"),
    // Rückenlehne
    box([w * 0.92, h * 0.42, d * 0.08], [0, h / 2 - h * 0.21, -d / 2 + d * 0.06], "koerper"),
    // Vordere Beine (kürzere Rückbeine ergibt stabile Optik – alle gleich)
    bein(-bx, bz, 0.52),
    bein(bx, bz, 0.52),
    // Hintere Beine (höher bis Rückenlehne)
    bein(-bx, -bz, 0.92),
    bein(bx, -bz, 0.92),
  ];
};

// Bürostuhl: Sitz + Rückenlehne + Gaskolben + Stern-Fuss
const buerostuhl: Bauer = (w, d, h) => {
  const r = Math.min(w, d);
  return [
    // Sternfuss (5 Arme als flache Boxen)
    ...Array.from({ length: 5 }, (_, i) => {
      const angle = (i / 5) * Math.PI * 2;
      const cx = Math.cos(angle) * r * 0.34;
      const cz = Math.sin(angle) * r * 0.34;
      return box([r * 0.08, h * 0.04, r * 0.7], [cx, -h / 2 + h * 0.03, cz], "dunkel");
    }),
    // Rollen (2 symbolisch)
    zyl(r * 0.04, r * 0.04, r * 0.06, [0, -h / 2 + h * 0.02, r * 0.3], "dunkel"),
    zyl(r * 0.04, r * 0.04, r * 0.06, [0, -h / 2 + h * 0.02, -r * 0.3], "dunkel"),
    // Gaskolben
    zyl(r * 0.05, r * 0.05, h * 0.22, [0, -h / 2 + h * 0.18, 0], "dunkel"),
    // Sitzmechanismus-Box
    box([w * 0.44, h * 0.06, d * 0.44], [0, -h / 2 + h * 0.33, 0], "dunkel"),
    // Sitzfläche
    box([w * 0.88, h * 0.1, d * 0.88], [0, -h / 2 + h * 0.4, 0], "koerper"),
    // Sitzkissen
    box([w * 0.78, h * 0.08, d * 0.78], [0, -h / 2 + h * 0.47, 0], "hell"),
    // Rückenlehne
    box([w * 0.78, h * 0.42, d * 0.1], [0, h / 2 - h * 0.26, -d / 2 + d * 0.1], "koerper"),
    // Kopfstütze
    box([w * 0.42, h * 0.12, d * 0.08], [0, h / 2 - h * 0.06, -d / 2 + d * 0.08], "dunkel"),
    // Armlehne links
    box([w * 0.06, h * 0.1, d * 0.42], [-w * 0.44, -h / 2 + h * 0.44, 0], "dunkel"),
    // Armlehne rechts
    box([w * 0.06, h * 0.1, d * 0.42], [w * 0.44, -h / 2 + h * 0.44, 0], "dunkel"),
  ];
};

// Schreibtisch: Breite Platte + 2 Tischbeine/Schränkchen + Kabelkanal
const schreibtisch: Bauer = (w, d, h) => [
  // Tischplatte
  box([w, h * 0.07, d], [0, h / 2 - h * 0.035, 0], "koerper"),
  // Platte Unterseite (hell)
  box([w * 0.96, h * 0.02, d * 0.96], [0, h / 2 - h * 0.08, 0], "hell"),
  // Linkes Tischbein (als schmaler Schrank)
  box([w * 0.18, h * 0.92, d * 0.96], [-w / 2 + w * 0.09, -h / 2 + h * 0.46, 0], "dunkel"),
  // Rechtes Tischbein
  box([w * 0.18, h * 0.92, d * 0.96], [w / 2 - w * 0.09, -h / 2 + h * 0.46, 0], "dunkel"),
  // Griff linkes Schränkchen
  box([w * 0.04, h * 0.05, d * 0.04], [-w * 0.4, -h * 0.08, d / 2 - d * 0.02], "hell"),
  // Griff rechtes Schränkchen
  box([w * 0.04, h * 0.05, d * 0.04], [w * 0.4, -h * 0.08, d / 2 - d * 0.02], "hell"),
  // Kabelkanal hinten
  box([w * 0.6, h * 0.04, d * 0.05], [0, h / 2 - h * 0.1, -d / 2 + d * 0.03], "dunkel"),
];

// Hocker: Sitzfläche + 4 Beine
const hocker: Bauer = (w, d, h) => {
  const bx = w / 2 - w * 0.1;
  const bz = d / 2 - d * 0.1;
  const bein = (x: number, z: number): Teil =>
    box([w * 0.08, h * 0.86, d * 0.08], [x, -h / 2 + h * 0.43, z], "dunkel");
  return [
    // Sitzfläche
    box([w, h * 0.1, d], [0, h / 2 - h * 0.05, 0], "koerper"),
    // Polster
    box([w * 0.82, h * 0.08, d * 0.82], [0, h / 2 - h * 0.04, 0], "hell"),
    bein(-bx, -bz),
    bein(bx, -bz),
    bein(-bx, bz),
    bein(bx, bz),
    // Querstreben zwischen den Beinen
    box([w * 0.72, h * 0.04, d * 0.04], [0, -h / 2 + h * 0.3, -bz], "dunkel"),
    box([w * 0.04, h * 0.04, d * 0.72], [-bx, -h / 2 + h * 0.3, 0], "dunkel"),
  ];
};

// ═══════════════════════════════════════════════════════════════════
// KÜCHE
// ═══════════════════════════════════════════════════════════════════

// Unterschrank: Korpus + 2 Türen + Griffe + Sockel + Arbeitsplatte
const unterschrank: Bauer = (w, d, h) => [
  // Korpus
  box([w, h * 0.86, d], [0, -h / 2 + h * 0.49, 0], "koerper"),
  // Arbeitsplatte
  box([w, h * 0.07, d], [0, h / 2 - h * 0.035, 0], "dunkel"),
  // Sockel
  box([w * 0.92, h * 0.06, d * 0.6], [0, -h / 2 + h * 0.03, 0], "dunkel"),
  // Türtrennlinie
  box([w * 0.014, h * 0.72, d * 0.02], [0, -h * 0.04, d / 2 - d * 0.01], "dunkel"),
  // Griff links
  box([w * 0.3, h * 0.03, d * 0.04], [-w * 0.24, h * 0.04, d / 2 - d * 0.02], "hell"),
  // Griff rechts
  box([w * 0.3, h * 0.03, d * 0.04], [w * 0.24, h * 0.04, d / 2 - d * 0.02], "hell"),
];

// Hochschrank: Korpus + 2 Griffe (oben/unten) + Sockel
const hochschrank: Bauer = (w, d, h) => [
  // Korpus
  box([w, h * 0.94, d], [0, -h / 2 + h * 0.53, 0], "koerper"),
  // Sockel
  box([w * 0.92, h * 0.06, d * 0.7], [0, -h / 2 + h * 0.03, 0], "dunkel"),
  // Türtrennlinie
  box([w * 0.014, h * 0.88, d * 0.02], [0, -h / 2 + h * 0.49, d / 2 - d * 0.01], "dunkel"),
  // Griff oben
  box([w * 0.42, h * 0.03, d * 0.04], [0, h * 0.1, d / 2 - d * 0.015], "hell"),
  // Griff unten
  box([w * 0.42, h * 0.03, d * 0.04], [0, -h * 0.02, d / 2 - d * 0.015], "hell"),
  // Abschlussleiste oben
  box([w, h * 0.04, d], [0, h / 2 - h * 0.02, 0], "dunkel"),
];

// Hängeschrank: Korpus + Griff + Unterboden (sichtbar bei Wandmontage)
const haengeschrank: Bauer = (w, d, h) => [
  // Korpus
  box([w, h, d], [0, 0, 0], "koerper"),
  // Türtrennlinie
  box([w * 0.014, h * 0.92, d * 0.02], [0, 0, d / 2 - d * 0.01], "dunkel"),
  // Griff
  box([w * 0.42, h * 0.03, d * 0.04], [0, -h / 2 + h * 0.14, d / 2 - d * 0.02], "hell"),
  // Unterboden sichtbar
  box([w * 0.96, h * 0.04, d * 0.96], [0, -h / 2 + h * 0.02, 0], "dunkel"),
];

// Spüle: Arbeitsplatte + 1 oder 2 Becken + Armatur + Ablage
const spuele: Bauer = (w, d, h) => [
  // Arbeitsplatte
  box([w, h * 0.1, d], [0, h / 2 - h * 0.05, 0], "koerper"),
  // Becken links
  box([w * 0.38, h * 0.14, d * 0.72], [-w * 0.2, h / 2 - h * 0.12, 0], "dunkel"),
  // Becken rechts (kleines Abtropfbecken)
  box([w * 0.24, h * 0.1, d * 0.62], [w * 0.3, h / 2 - h * 0.1, 0], "dunkel"),
  // Armaturkörper
  box([w * 0.06, h * 0.22, d * 0.06], [-w * 0.02, h / 2 - h * 0.01, -d * 0.1], "dunkel"),
  // Auslauf
  box([w * 0.03, h * 0.03, d * 0.24], [-w * 0.02, h / 2 - h * 0.01, d * 0.04], "dunkel"),
  // Unterschrank (Unterbau)
  box([w, h * 0.88, d], [0, -h / 2 + h * 0.44, 0], "koerper"),
];

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

// Sofa L-Form: Haupt-Sitzbank + Longchair-Ecke (zweite Sitzbox) + Lehnen.
const sofaL: Bauer = (w, d, h) => [
  // Haupt-Sitzfläche (hintere Tiefe, volle Breite)
  box([w, h * 0.34, d * 0.62], [0, -h / 2 + h * 0.17, -d / 2 + d * 0.31], "koerper"),
  // Longchair-Ecke (zweite Sitzbox) – ragt in die volle Tiefe, rechte Hälfte
  box([w * 0.46, h * 0.34, d], [w / 2 - w * 0.23, -h / 2 + h * 0.17, 0], "koerper"),
  // Rückenlehne (hinten, volle Breite)
  box([w, h * 0.5, d * 0.16], [0, h / 2 - h * 0.25, -d / 2 + d * 0.08], "koerper"),
  // Seitenlehne links
  box(
    [w * 0.1, h * 0.52, d * 0.62],
    [-w / 2 + w * 0.05, -h / 2 + h * 0.26, -d / 2 + d * 0.31],
    "koerper",
  ),
  // Sitzkissen Hauptteil
  box([w * 0.6, h * 0.14, d * 0.5], [-w * 0.16, -h / 2 + h * 0.41, -d / 2 + d * 0.3], "hell"),
  // Sitzkissen Longchair
  box([w * 0.4, h * 0.14, d * 0.84], [w / 2 - w * 0.22, -h / 2 + h * 0.41, d * 0.02], "hell"),
  // 4 Füsse
  box([w * 0.06, h * 0.08, d * 0.06], [-w * 0.44, -h / 2 + h * 0.04, -d * 0.42], "dunkel"),
  box([w * 0.06, h * 0.08, d * 0.06], [w * 0.44, -h / 2 + h * 0.04, -d * 0.42], "dunkel"),
  box([w * 0.06, h * 0.08, d * 0.06], [-w * 0.44, -h / 2 + h * 0.04, d * 0.42], "dunkel"),
  box([w * 0.06, h * 0.08, d * 0.06], [w * 0.44, -h / 2 + h * 0.04, d * 0.42], "dunkel"),
];

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
