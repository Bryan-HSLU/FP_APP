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

type Bauer = (w: number, d: number, h: number) => Teil[];

// Seifenspender: Keramikkörper + Schulter + Pumpkopf + Auslauf.
const seifenspender: Bauer = (w, d, h) => {
  const r = Math.min(w, d);
  return [
    zyl(r * 0.42, r * 0.46, h * 0.72, [0, -h / 2 + h * 0.36, 0], "koerper"),
    zyl(r * 0.3, r * 0.42, h * 0.12, [0, -h / 2 + h * 0.78, 0], "hell"),
    box([w * 0.16, h * 0.12, d * 0.16], [0, -h / 2 + h * 0.9, 0], "dunkel"),
    box([w * 0.16, h * 0.05, d * 0.34], [0, -h / 2 + h * 0.86, d * 0.1], "dunkel"),
  ];
};

// Zahnputzbecher: Glasbecher + Innenrand + zwei neue Zahnbürsten.
const zahnputzbecher: Bauer = (w, d, h) => {
  const r = Math.min(w, d);
  return [
    zyl(r * 0.46, r * 0.4, h * 0.92, [0, -h / 2 + h * 0.46, 0], "koerper"),
    zyl(r * 0.36, r * 0.36, h * 0.08, [0, h / 2 - h * 0.06, 0], "dunkel"),
    box([w * 0.07, h * 0.5, d * 0.07], [w * 0.12, -h / 2 + h * 0.75, 0], "hell"),
    box([w * 0.07, h * 0.5, d * 0.07], [-w * 0.12, -h / 2 + h * 0.75, d * 0.05], "dunkel"),
  ];
};

// Gefaltete Handtücher: drei ordentlich gestapelte Lagen mit Faltkante.
const handtuchstapel: Bauer = (w, d, h) => [
  box([w * 0.98, h * 0.32, d * 0.98], [0, -h / 2 + h * 0.16, 0], "koerper"),
  box([w * 0.92, h * 0.3, d * 0.94], [0, -h / 2 + h * 0.48, 0], "hell"),
  box([w * 0.86, h * 0.3, d * 0.9], [0, -h / 2 + h * 0.8, 0], "koerper"),
  box([w * 0.94, h * 0.02, d * 0.02], [0, -h / 2 + h * 0.16, d / 2 - d * 0.02], "dunkel"),
  box([w * 0.88, h * 0.02, d * 0.02], [0, -h / 2 + h * 0.48, d / 2 - d * 0.05], "dunkel"),
];

// Ablage-Tray mit Fläschchen: flache Schale + Rand + drei neue Fläschchen.
const ablagetray: Bauer = (w, d, h) => [
  box([w, h * 0.1, d], [0, -h / 2 + h * 0.05, 0], "koerper"),
  box([w, h * 0.16, d * 0.06], [0, -h / 2 + h * 0.13, -d / 2 + d * 0.03], "hell"),
  box([w, h * 0.16, d * 0.06], [0, -h / 2 + h * 0.13, d / 2 - d * 0.03], "hell"),
  box([w * 0.06, h * 0.16, d], [-w / 2 + w * 0.03, -h / 2 + h * 0.13, 0], "hell"),
  box([w * 0.06, h * 0.16, d], [w / 2 - w * 0.03, -h / 2 + h * 0.13, 0], "hell"),
  zyl(w * 0.09, w * 0.09, h * 0.72, [-w * 0.24, -h / 2 + h * 0.46, 0], "dunkel"),
  zyl(w * 0.08, w * 0.08, h * 0.52, [w * 0.06, -h / 2 + h * 0.36, d * 0.12], "hell"),
  box([w * 0.16, h * 0.34, d * 0.34], [w * 0.28, -h / 2 + h * 0.27, -d * 0.06], "dunkel"),
];

// Zimmerpflanze im Topf (Klasse B): Topf + Erde + Stamm + Laub-Kugeln.
const badpflanze: Bauer = (w, d, h) => {
  const r = Math.min(w, d);
  const rLaub = Math.min(r * 0.48, h * 0.36);
  const yLaub = h / 2 - rLaub;
  return [
    zyl(r * 0.42, r * 0.3, h * 0.32, [0, -h / 2 + h * 0.16, 0], "dunkel"),
    zyl(r * 0.38, r * 0.38, h * 0.05, [0, -h / 2 + h * 0.34, 0], "dunkel"),
    zyl(w * 0.04, w * 0.05, h * 0.34, [0, -h / 2 + h * 0.5, 0], "dunkel"),
    kugel(rLaub, [0, yLaub, 0], "koerper"),
    kugel(rLaub * 0.6, [r * 0.16, yLaub - rLaub * 0.5, r * 0.12], "hell"),
    kugel(rLaub * 0.52, [-r * 0.16, yLaub - rLaub * 0.6, -r * 0.1], "koerper"),
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
