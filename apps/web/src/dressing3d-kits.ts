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

// ── Wohnen-Deko (sparsam, «frisch gebaut»: neu, aufgeräumt, gestaged) ─────────

// Bücherstapel: vier ordentlich gestapelte, leicht versetzte Bücher (weich
// gerundete Buchblöcke) mit angedeutetem Buchrücken – kein Alltags-Chaos.
const buecherstapel: Bauer = (w, d, h) => {
  const rr = Math.min(w, d) * 0.03;
  const lagen = 4;
  const th = h / lagen;
  const rollen: Rolle[] = ["koerper", "hell", "dunkel", "hell"];
  const teile: Teil[] = [];
  for (let i = 0; i < lagen; i++) {
    const y = -h / 2 + th * (i + 0.5);
    const shrink = 1 - i * 0.05;
    const ox = (i % 2 === 0 ? 1 : -1) * w * 0.035;
    const rolle = rollen[i] ?? "koerper";
    teile.push(rbox([w * 0.94 * shrink, th * 0.82, d * 0.94 * shrink], [ox, y, 0], rr, rolle));
    // Buchrücken (dezent dunkler, an einer Seite)
    teile.push(
      box([w * 0.02, th * 0.62, d * 0.88 * shrink], [ox - w * 0.46 * shrink, y, 0], "dunkel"),
    );
  }
  return teile;
};

// Vase schlank: dezenter Keramikkörper (Rotationskörper) mit schmalem Hals +
// Innenrand + Fussring. Bewusst leer (Showroom-Look, nichts benutzt).
const vase: Bauer = (w, d, h) => {
  const r = Math.min(w, d);
  return [
    drehteil(
      [
        [r * 0.18, -h * 0.48],
        [r * 0.42, -h * 0.3],
        [r * 0.46, -h * 0.02],
        [r * 0.3, h * 0.3],
        [r * 0.26, h * 0.44],
        [r * 0.3, h * 0.48],
      ],
      [0, 0, 0],
      "koerper",
    ),
    // Innenrand (dunkler Schatten der Öffnung)
    zyl(r * 0.24, r * 0.24, h * 0.03, [0, h * 0.46, 0], "dunkel"),
    // Fussring (hell)
    zyl(r * 0.2, r * 0.22, h * 0.04, [0, -h / 2 + h * 0.04, 0], "hell"),
  ];
};

// Kerzenständer-Paar: zwei polierte Metall-Kerzenständer (Fuss + Schaft) mit
// je einer neuen, unbenutzten Kerze – unterschiedlich hoch, dezent gruppiert.
const kerzenstaender: Bauer = (w, d, h) => {
  const r = Math.min(w, d);
  const stab = (cx: number, kerzeAnteil: number): Teil[] => {
    const fussH = h * 0.06;
    const schaftH = h * (kerzeAnteil < 0.5 ? 0.34 : 0.24);
    const kerzeH = h * kerzeAnteil;
    const fussY = -h / 2 + fussH / 2;
    const schaftY = -h / 2 + fussH + schaftH / 2;
    const kerzeY = -h / 2 + fussH + schaftH + kerzeH / 2;
    const dochtY = kerzeY + kerzeH / 2 + h * 0.01;
    return [
      zyl(r * 0.32, r * 0.42, fussH, [cx, fussY, 0], "chrom"),
      zyl(r * 0.12, r * 0.14, schaftH, [cx, schaftY, 0], "chrom"),
      zyl(r * 0.2, r * 0.22, h * 0.03, [cx, schaftY + schaftH / 2, 0], "chrom"),
      zyl(r * 0.16, r * 0.16, kerzeH, [cx, kerzeY, 0], "hell"),
      box([r * 0.03, h * 0.02, r * 0.03], [cx, dochtY, 0], "dunkel"),
    ];
  };
  return [...stab(-w * 0.24, 0.44), ...stab(w * 0.24, 0.34)];
};

// Deko-Schale mit Kugeln: flache gerundete Schale (Körper + Innenmulde) mit drei
// dekorativen Kugeln – klassisches Staging-Objekt, aufgeräumt.
const dekoschale: Bauer = (w, d, h) => {
  const rr = Math.min(w, d) * 0.09;
  const rK = Math.min(w, d) * 0.16;
  return [
    rbox([w, h * 0.5, d], [0, -h / 2 + h * 0.25, 0], rr, "koerper"),
    rbox([w * 0.78, h * 0.4, d * 0.72], [0, -h / 2 + h * 0.42, 0], rr * 0.7, "dunkel"),
    kugel(rK, [-w * 0.16, -h / 2 + h * 0.55, d * 0.02], "hell"),
    kugel(rK * 0.9, [w * 0.06, -h / 2 + h * 0.52, d * 0.1], "koerper"),
    kugel(rK * 0.82, [w * 0.2, -h / 2 + h * 0.54, -d * 0.08], "hell"),
  ];
};

// Gefaltetes Plaid: ordentlich gefaltete Decke (zwei weiche Lagen) mit
// überhängendem Zipfel – drapierter Staging-Look, NICHT zerknüllt.
const plaid: Bauer = (w, d, h) => {
  const rr = Math.min(w, d) * 0.06;
  return [
    rbox([w, h * 0.55, d], [0, -h / 2 + h * 0.275, 0], rr, "koerper"),
    rbox([w * 0.96, h * 0.5, d * 0.92], [0, -h / 2 + h * 0.72, 0], rr, "hell"),
    // überhängender Zipfel vorne (drapiert)
    rbox([w * 0.9, h * 0.5, d * 0.18], [0, -h / 2 + h * 0.25, d * 0.4], rr * 0.8, "koerper"),
    // Faltkanten (dezent)
    box([w * 0.94, h * 0.02, d * 0.02], [0, -h / 2 + h * 0.55, d / 2 - d * 0.04], "dunkel"),
    box([w * 0.9, h * 0.02, d * 0.02], [0, -h / 2 + h * 0.95, d * 0.32], "dunkel"),
  ];
};

// Zimmerpflanze mittel (Klasse B): konischer Übertopf (Rotationskörper) + Erde +
// zwei Stämme + volumetrisches Blattwerk aus versetzten Laub-Kugeln.
const zimmerpflanze: Bauer = (w, d, h) => {
  const r = Math.min(w, d);
  const rL = Math.min(r * 0.46, h * 0.2);
  const yT = h / 2 - rL * 1.1;
  return [
    // Übertopf (konisch)
    drehteil(
      [
        [r * 0.3, -h * 0.48],
        [r * 0.4, -h * 0.4],
        [r * 0.44, -h * 0.3],
        [r * 0.46, -h * 0.26],
      ],
      [0, 0, 0],
      "koerper",
    ),
    // Erde
    zyl(r * 0.4, r * 0.4, h * 0.03, [0, -h / 2 + h * 0.24, 0], "dunkel"),
    // Stämme
    zyl(r * 0.05, r * 0.06, h * 0.4, [r * 0.05, -h / 2 + h * 0.42, 0], "dunkel"),
    zyl(r * 0.04, r * 0.05, h * 0.36, [-r * 0.06, -h / 2 + h * 0.4, r * 0.03], "dunkel"),
    // Blattwerk – mehrere versetzte Kugeln
    kugel(rL, [0, yT, 0], "koerper"),
    kugel(rL * 0.7, [r * 0.16, yT - rL * 0.5, r * 0.12], "hell"),
    kugel(rL * 0.64, [-r * 0.16, yT - rL * 0.45, -r * 0.12], "koerper"),
    kugel(rL * 0.58, [r * 0.1, yT - rL * 0.95, -r * 0.14], "hell"),
    kugel(rL * 0.52, [-r * 0.1, yT - rL * 0.85, r * 0.14], "koerper"),
    kugel(rL * 0.5, [0, yT + rL * 0.4, 0], "hell"),
  ];
};

// ── Küchen-Deko (sparsam, «frisch gebaut»: neu, aufgeräumt, gestaged) ─────────

// Schneidebrett mit Messerblock: flaches Holzbrett (gerundet) + kompakter
// Messerblock mit drei angedeuteten, neuwertigen Messergriffen – kein Gebrauch.
const schneidebrett: Bauer = (w, d, h) => {
  const rr = Math.min(w, d) * 0.05;
  return [
    // Holzbrett (flach, gerundet)
    rbox([w * 0.62, h * 0.13, d * 0.94], [-w * 0.16, -h / 2 + h * 0.065, 0], rr, "koerper"),
    // Messerblock (dunkles Holz, rechts)
    rbox([w * 0.3, h * 0.62, d * 0.66], [w * 0.3, -h / 2 + h * 0.31, 0], rr * 0.6, "dunkel"),
    // Messergriffe (neuwertig, aus dem Block ragend)
    box([w * 0.05, h * 0.4, d * 0.05], [w * 0.3, h * 0.3, -d * 0.2], "chrom"),
    box([w * 0.05, h * 0.44, d * 0.05], [w * 0.3, h * 0.28, -d * 0.02], "hell"),
    box([w * 0.05, h * 0.36, d * 0.05], [w * 0.3, h * 0.28, d * 0.18], "chrom"),
  ];
};

// Kaffeemaschine kompakt: Edelstahlkorpus (gerundet) + dunkles Bedienpanel oben +
// Brühkopf mit Auslauf, darunter eine saubere, leere Tasse – Showroom-Look.
const kaffeemaschine: Bauer = (w, d, h) => {
  const rr = Math.min(w, d) * 0.06;
  return [
    // Korpus (Edelstahl)
    rbox([w * 0.9, h * 0.72, d * 0.8], [0, -h / 2 + h * 0.4, -d * 0.05], rr, "koerper"),
    // Bedienpanel oben (dunkel)
    rbox([w * 0.9, h * 0.14, d * 0.8], [0, h / 2 - h * 0.08, -d * 0.05], rr, "dunkel"),
    // Brühkopf (Chrom) vorne
    box([w * 0.32, h * 0.16, d * 0.18], [0, -h / 2 + h * 0.36, d * 0.32], "chrom"),
    // Auslauf (Chrom)
    zyl(w * 0.045, w * 0.055, h * 0.12, [0, -h / 2 + h * 0.24, d * 0.34], "chrom"),
    // Tasse (hell) unter dem Auslauf
    zyl(w * 0.15, w * 0.13, h * 0.13, [0, -h / 2 + h * 0.065, d * 0.34], "hell"),
    // Siebträgergriff (dunkel)
    box([w * 0.06, h * 0.05, d * 0.22], [w * 0.24, -h / 2 + h * 0.36, d * 0.3], "dunkel"),
    // Bedienknopf (Chrom)
    kugel(w * 0.05, [w * 0.28, h / 2 - h * 0.1, d * 0.02], "chrom"),
  ];
};

// Obstschale mit Früchten: bauchige Keramikschale (Rotationskörper) + Innenrand +
// ein paar gestapelte Früchte (Kugeln) – frisch angerichtet, aufgeräumt.
const obstschale: Bauer = (w, d, h) => {
  const r = Math.min(w, d);
  const rF = r * 0.14;
  return [
    // Schale (bauchig)
    drehteil(
      [
        [r * 0.16, -h * 0.42],
        [r * 0.4, -h * 0.2],
        [r * 0.5, h * 0.02],
        [r * 0.48, h * 0.06],
      ],
      [0, 0, 0],
      "koerper",
    ),
    // Innenrand (dunkler Schatten)
    zyl(r * 0.42, r * 0.42, h * 0.02, [0, h * 0.05, 0], "dunkel"),
    // Früchte (Kugeln, in der Schale)
    kugel(rF, [-r * 0.16, h * 0.12, r * 0.02], "hell"),
    kugel(rF * 0.95, [r * 0.08, h * 0.1, r * 0.14], "koerper"),
    kugel(rF * 0.9, [r * 0.18, h * 0.13, -r * 0.08], "dunkel"),
    kugel(rF * 0.85, [-r * 0.02, h * 0.22, -r * 0.04], "hell"),
  ];
};

// Gewürzgläser-Set: kleine Ablage/Rack (gerundet) mit vier gleichen Gläschen
// (Glas) samt farbiger Füllung und Chrom-Deckel – ordentlich aufgereiht.
const gewuerzglaeser: Bauer = (w, d, h) => {
  const rr = Math.min(w, d) * 0.08;
  const jarR = Math.min(w * 0.1, d * 0.42);
  const fuellRollen: Rolle[] = ["koerper", "hell", "dunkel", "hell"];
  const teile: Teil[] = [
    // Ablage/Rack (dunkel)
    rbox([w, h * 0.12, d], [0, -h / 2 + h * 0.06, 0], rr, "dunkel"),
  ];
  const yBoden = -h / 2 + h * 0.12;
  for (let i = 0; i < 4; i++) {
    const cx = -w * 0.34 + (i * (w * 0.68)) / 3;
    // Glaskörper
    teile.push(zyl(jarR, jarR, h * 0.58, [cx, yBoden + h * 0.29, 0], "glas"));
    // Gewürzfüllung (farbig, unten)
    teile.push(
      zyl(
        jarR * 0.86,
        jarR * 0.86,
        h * 0.28,
        [cx, yBoden + h * 0.15, 0],
        fuellRollen[i] ?? "koerper",
      ),
    );
    // Chrom-Deckel
    teile.push(zyl(jarR * 0.94, jarR, h * 0.12, [cx, yBoden + h * 0.64, 0], "chrom"));
  }
  return teile;
};

// Kräutertopf: konischer Keramiktopf (Rotationskörper) + Erde + buschiges,
// frisches Kraut aus mehreren versetzten grünen Kugeln.
const kraeutertopf: Bauer = (w, d, h) => {
  const r = Math.min(w, d);
  const rL = Math.min(r * 0.34, h * 0.17);
  const yBase = h * 0.02;
  return [
    // Topf (konisch)
    drehteil(
      [
        [r * 0.3, -h * 0.48],
        [r * 0.4, -h * 0.34],
        [r * 0.44, -h * 0.16],
        [r * 0.42, -h * 0.1],
      ],
      [0, 0, 0],
      "koerper",
    ),
    // Erde
    zyl(r * 0.38, r * 0.38, h * 0.04, [0, -h / 2 + h * 0.42, 0], "dunkel"),
    // Kraut – buschig, mehrere versetzte Kugeln
    kugel(rL, [0, yBase, 0], "koerper"),
    kugel(rL * 0.82, [r * 0.22, yBase - rL * 0.4, r * 0.14], "hell"),
    kugel(rL * 0.78, [-r * 0.2, yBase - rL * 0.35, -r * 0.12], "koerper"),
    kugel(rL * 0.72, [r * 0.14, yBase + rL * 0.5, -r * 0.14], "hell"),
    kugel(rL * 0.7, [-r * 0.14, yBase + rL * 0.55, r * 0.12], "koerper"),
    kugel(rL * 0.62, [0, yBase + rL * 0.9, 0], "hell"),
  ];
};

// Gefaltetes Geschirrtuch: zwei weiche, ordentlich gefaltete Lagen mit dezentem
// Überhang und Faltkante – frisch aufgelegt, NICHT zerknüllt.
const geschirrtuch: Bauer = (w, d, h) => {
  const rr = Math.min(w, d) * 0.05;
  return [
    // untere Lage
    rbox([w, h * 0.55, d * 0.9], [0, -h / 2 + h * 0.28, -d * 0.02], rr, "koerper"),
    // obere Lage
    rbox([w * 0.96, h * 0.5, d * 0.82], [0, -h / 2 + h * 0.72, -d * 0.02], rr, "hell"),
    // Überhang vorne (leicht drapiert)
    rbox([w * 0.9, h * 0.5, d * 0.16], [0, -h / 2 + h * 0.3, d * 0.42], rr * 0.8, "koerper"),
    // Faltkante (dezent)
    box([w * 0.92, h * 0.03, d * 0.02], [0, -h / 2 + h * 0.55, d * 0.4], "dunkel"),
  ];
};

// ── Licht (sparsam, «frisch gebaut»: echte Leuchten, kein Kabelsalat) ─────────

// Pendelleuchte: Deckenrosette (Chrom) + dünnes Kabel + kegeliger Schirm
// (Rotationskörper, stilfarbig) + warmer Diffusor in der Öffnung. Der Diffusor
// (rolle "hell") ist der einzige leuchtende Bauteil – dressing3d.tsx erkennt
// ihn daran und rendert ihn emissiv + setzt dort eine kleine Punktlichtquelle.
const pendelleuchte: Bauer = (w, d, h) => {
  const r = Math.min(w, d);
  const rosetteH = h * 0.05;
  const rosetteY = h / 2 - rosetteH / 2;
  const schirmTopY = h * 0.06;
  const kabelH = Math.max(h * 0.02, h / 2 - rosetteH - schirmTopY);
  const kabelY = schirmTopY + kabelH / 2;
  const diffusorY = -h * 0.32;
  return [
    // Deckenrosette (Chrom, sitzt an der Decke)
    zyl(r * 0.1, r * 0.1, rosetteH, [0, rosetteY, 0], "chrom"),
    // Kabel (dünn, dunkel)
    zyl(r * 0.012, r * 0.012, kabelH, [0, kabelY, 0], "dunkel"),
    // Schirm (kegelig, Rotationskörper, stilfarbig)
    drehteil(
      [
        [r * 0.05, schirmTopY],
        [r * 0.22, schirmTopY - h * 0.1],
        [r * 0.46, -h * 0.3],
        [r * 0.42, -h * 0.36],
      ],
      [0, 0, 0],
      "koerper",
    ),
    // Diffusor (warmweiss, leuchtet – sitzt in der Schirm-Öffnung)
    kugel(r * 0.17, [0, diffusorY, 0], "hell"),
  ];
};

// Tischleuchte: runder Chrom-Fuss + dünner Stab + kegeliger Schirm
// (Rotationskörper, stilfarbig) + warmer Diffusor darunter. Gleiche
// Diffusor-Konvention wie die Pendelleuchte (rolle "hell" = leuchtend).
const tischleuchte: Bauer = (w, d, h) => {
  const r = Math.min(w, d);
  const fussH = h * 0.06;
  const fussY = -h / 2 + fussH / 2;
  const stabH = h * 0.5;
  const stabY = fussY + fussH / 2 + stabH / 2;
  const diffusorY = h * 0.12;
  return [
    // Fuss (Chrom, gerundet)
    zyl(r * 0.4, r * 0.44, fussH, [0, fussY, 0], "chrom"),
    // Stab (dünn, dunkel)
    zyl(r * 0.05, r * 0.06, stabH, [0, stabY, 0], "dunkel"),
    // Schirm (kegelig, Rotationskörper, stilfarbig)
    drehteil(
      [
        [r * 0.06, h * 0.42],
        [r * 0.24, h * 0.3],
        [r * 0.42, h * 0.12],
        [r * 0.38, h * 0.08],
      ],
      [0, 0, 0],
      "koerper",
    ),
    // Diffusor (warmweiss, leuchtet – unter dem Schirm)
    kugel(r * 0.18, [0, diffusorY, 0], "hell"),
  ];
};

const DRESSING_BAUSAETZE: Record<string, Bauer> = {
  seifenspender,
  zahnputzbecher,
  handtuchstapel,
  ablagetray,
  badpflanze,
  buecherstapel,
  vase,
  kerzenstaender,
  dekoschale,
  plaid,
  zimmerpflanze,
  schneidebrett,
  kaffeemaschine,
  obstschale,
  gewuerzglaeser,
  kraeutertopf,
  geschirrtuch,
  pendelleuchte,
  tischleuchte,
};

/** funktionsTypen, deren Diffusor (rolle "hell") im Viewer emissiv leuchtet
 *  und eine kleine Punktlichtquelle bekommt (dressing3d.tsx). */
export const DRESSING_LICHT_TYPEN = new Set(["pendelleuchte", "tischleuchte"]);

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
