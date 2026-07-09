/** Prozedurale Primitiv-Bausätze der Scene-Dressing-Deko (rein rechnend, ohne
 *  React/drei – damit sie schlank testbar sind). Gleiches Box/Zylinder/Kugel-
 *  Muster wie {@link ./moebel3d.tsx}: Ursprung = bbox-Mitte, jedes Bauteil
 *  bleibt in der bbox w×d×h (clampTeil als Sicherheitsnetz).
 *
 *  Konzept: FP_Kopf/vault/50_Umsetzung/Scene-Dressing-Konzept.md
 *  Ästhetik «frisch gebaut»: neu, aufgeräumt, nichts benutzt.
 */
import { clampTeil, type Rolle, type Teil } from "./moebel3d.tsx";

// Kurz-Konstruktoren (lokal, gleiches Muster wie moebel3d).
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

const rbox = (
  groesse: [number, number, number],
  pos: [number, number, number],
  radius: number,
  rolle: Rolle,
): Teil => ({ form: "rundbox", groesse, pos, radius, rolle });

/** Rotationskörper: Profil = `[radius, y]`-Punkte (y relativ zu `pos`, Achse Y). */
const drehteil = (
  profil: [number, number][],
  pos: [number, number, number],
  rolle: Rolle,
  segmente = 24,
): Teil => ({ form: "lathe", profil, pos, rolle, segmente });

type Bauer = (w: number, d: number, h: number) => Teil[];

// Seifenspender: bauchiger Keramikkörper (Rotationskörper) + Schulter +
// Chrom-Pumpkopf + Chrom-Auslauf. Sauber, neu (frisch gebaut).
const seifenspender: Bauer = (w, d, h) => {
  const r = Math.min(w, d);
  return [
    // Keramikkörper (Rotationskörper, bauchig)
    drehteil(
      [
        [r * 0.32, -h * 0.44],
        [r * 0.46, -h * 0.28],
        [r * 0.46, h * 0.1],
        [r * 0.34, h * 0.24],
      ],
      [0, 0, 0],
      "koerper",
    ),
    // Schulter (hell)
    zyl(r * 0.3, r * 0.36, h * 0.08, [0, h / 2 - h * 0.28, 0], "hell"),
    // Pumpkopf (Chrom)
    zyl(r * 0.14, r * 0.16, h * 0.16, [0, h / 2 - h * 0.14, 0], "chrom"),
    // Auslauf (Chrom)
    box([w * 0.12, h * 0.05, d * 0.34], [0, h / 2 - h * 0.12, d * 0.12], "chrom"),
  ];
};

// Zahnputzbecher: leicht konischer Glasbecher (Rotationskörper) + Innenrand +
// zwei neue Zahnbürsten (Stiel + Kopf).
const zahnputzbecher: Bauer = (w, d, h) => {
  const r = Math.min(w, d);
  return [
    // Glasbecher (Rotationskörper, konisch)
    drehteil(
      [
        [r * 0.4, -h * 0.46],
        [r * 0.46, -h * 0.2],
        [r * 0.48, h * 0.4],
      ],
      [0, 0, 0],
      "glas",
    ),
    // Innenrand (dunkel)
    zyl(r * 0.4, r * 0.4, h * 0.05, [0, h / 2 - h * 0.08, 0], "dunkel"),
    // Zahnbürste 1 – Stiel + Kopf
    box([w * 0.06, h * 0.5, d * 0.06], [w * 0.13, -h / 2 + h * 0.72, 0], "hell"),
    box([w * 0.09, h * 0.12, d * 0.06], [w * 0.13, h / 2 - h * 0.05, 0], "koerper"),
    // Zahnbürste 2 – Stiel
    box([w * 0.06, h * 0.5, d * 0.06], [-w * 0.13, -h / 2 + h * 0.72, d * 0.05], "dunkel"),
  ];
};

// Gefaltete Handtücher: drei ordentlich gestapelte, weich gerundete Lagen mit
// dezenten Faltkanten.
const handtuchstapel: Bauer = (w, d, h) => {
  const rr = Math.min(w, d) * 0.05;
  return [
    rbox([w * 0.98, h * 0.32, d * 0.98], [0, -h / 2 + h * 0.16, 0], rr, "koerper"),
    rbox([w * 0.92, h * 0.3, d * 0.94], [0, -h / 2 + h * 0.48, 0], rr, "hell"),
    rbox([w * 0.86, h * 0.3, d * 0.9], [0, -h / 2 + h * 0.8, 0], rr, "koerper"),
    // Faltkanten (dezent)
    box([w * 0.94, h * 0.02, d * 0.02], [0, -h / 2 + h * 0.16, d / 2 - d * 0.02], "dunkel"),
    box([w * 0.88, h * 0.02, d * 0.02], [0, -h / 2 + h * 0.48, d / 2 - d * 0.05], "dunkel"),
    box([w * 0.82, h * 0.02, d * 0.02], [0, -h / 2 + h * 0.8, d / 2 - d * 0.04], "dunkel"),
  ];
};

// Ablage-Tray mit Fläschchen: flache gerundete Schale + Rand + drei neue
// Fläschchen (Glas-Flasche mit Chrom-Pumpe, Flasche, Tiegel).
const ablagetray: Bauer = (w, d, h) => {
  const rr = Math.min(w, d) * 0.05;
  return [
    // Schale (gerundet)
    rbox([w, h * 0.12, d], [0, -h / 2 + h * 0.06, 0], rr, "koerper"),
    // Rand hinten/vorne/links/rechts
    box([w, h * 0.16, d * 0.06], [0, -h / 2 + h * 0.13, -d / 2 + d * 0.03], "hell"),
    box([w, h * 0.16, d * 0.06], [0, -h / 2 + h * 0.13, d / 2 - d * 0.03], "hell"),
    box([w * 0.06, h * 0.16, d], [-w / 2 + w * 0.03, -h / 2 + h * 0.13, 0], "hell"),
    box([w * 0.06, h * 0.16, d], [w / 2 - w * 0.03, -h / 2 + h * 0.13, 0], "hell"),
    // Fläschchen 1 (Glas, Rotationskörper)
    drehteil(
      [
        [w * 0.08, -h * 0.2],
        [w * 0.09, h * 0.1],
        [w * 0.05, h * 0.18],
      ],
      [-w * 0.24, -h / 2 + h * 0.42, 0],
      "glas",
    ),
    // Pumpkopf (Chrom) auf Fläschchen 1
    zyl(w * 0.03, w * 0.035, h * 0.1, [-w * 0.24, -h / 2 + h * 0.66, 0], "chrom"),
    // Fläschchen 2 (hell)
    zyl(w * 0.08, w * 0.08, h * 0.5, [w * 0.06, -h / 2 + h * 0.36, d * 0.12], "hell"),
    // Tiegel (dunkel, gerundet)
    rbox(
      [w * 0.16, h * 0.32, d * 0.34],
      [w * 0.28, -h / 2 + h * 0.26, -d * 0.06],
      rr * 0.5,
      "dunkel",
    ),
  ];
};

// Zimmerpflanze im Topf (Klasse B): konischer Topf (Rotationskörper) + Erde +
// Stamm + volumetrisches Blattwerk aus mehreren versetzten Laub-Kugeln.
const badpflanze: Bauer = (w, d, h) => {
  const r = Math.min(w, d);
  const rL = Math.min(r * 0.42, h * 0.3);
  const yT = h / 2 - rL * 1.15;
  return [
    // Topf (Rotationskörper, konisch)
    drehteil(
      [
        [r * 0.28, -h * 0.46],
        [r * 0.4, -h * 0.34],
        [r * 0.42, -h * 0.18],
        [r * 0.44, -h * 0.14],
      ],
      [0, 0, 0],
      "dunkel",
    ),
    // Erde
    zyl(r * 0.38, r * 0.38, h * 0.05, [0, -h / 2 + h * 0.34, 0], "dunkel"),
    // Stamm
    zyl(r * 0.05, r * 0.06, h * 0.22, [0, -h / 2 + h * 0.46, 0], "dunkel"),
    // Blattwerk – mehrere versetzte Kugeln
    kugel(rL, [0, yT, 0], "koerper"),
    kugel(rL * 0.7, [r * 0.2, yT - rL * 0.5, r * 0.14], "hell"),
    kugel(rL * 0.64, [-r * 0.2, yT - rL * 0.45, -r * 0.12], "koerper"),
    kugel(rL * 0.6, [r * 0.14, yT - rL * 0.95, -r * 0.16], "hell"),
    kugel(rL * 0.5, [0, yT + rL * 0.35, 0], "koerper"),
  ];
};

const DRESSING_BAUSAETZE: Record<string, Bauer> = {
  seifenspender,
  zahnputzbecher,
  handtuchstapel,
  ablagetray,
  badpflanze,
};

/**
 * Primitiv-Bauteile eines Deko-funktionsTyps, garantiert bbox-treu (clampTeil).
 * Unbekannte Typen fallen – wie bei moebel3d – auf die nackte Box zurück, damit
 * neue Deko-Daten nie ins Leere laufen.
 */
export function dressingBauteile(funktionsTyp: string, w: number, d: number, h: number): Teil[] {
  const bauer = DRESSING_BAUSAETZE[funktionsTyp];
  const roh = bauer ? bauer(w, d, h) : [box([w, h, d], [0, 0, 0], "koerper")];
  return roh.map((t) => clampTeil(t, w, d, h));
}

/** Registrierte Deko-Bausätze (für Tests: welche funktionsTypen sind gedeckt). */
export const DRESSING_TYPEN = Object.keys(DRESSING_BAUSAETZE);
