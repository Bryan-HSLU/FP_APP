/** Stil → Oberflächen-Spezifikation für Boden & Wand (rein, deterministisch).
 *
 * Bewusst **reine Client-Ableitung, kein Schema-/API-Eingriff**: die Optik der
 * Oberflächen wird – wie schon die Möbel-Materialfarben (`MATERIAL_FARBE` in
 * `moebel3d.tsx`) – allein im Frontend aus Raumtyp + Stilprofil hergeleitet. Das
 * Raummodell trägt keine Material-/Textur-Felder; ein neuer Stil verändert also
 * nur die Darstellung, nie die Verträge.
 *
 * Herleitung (nachvollziehbar, THEME-nah): Muster kommt vom Raumtyp (+ Material-
 * achse in der Küche), die Farbe aus den Stilachsen temperatur/helligkeit/
 * materialitaet/farbigkeit. Ohne Stilprofil bleibt die heutige neutrale Optik.
 */

import type { kuratorVertrag } from "@fp/shared/generated";

/** Nur die vom Viewer benötigte Sicht aufs Stilprofil (entkoppelt von Stil.tsx). */
export interface StilprofilSicht {
  styleVector: Record<string, number>;
}

export interface BodenSpez {
  muster: "fliesen" | "parkett" | "stein" | "uni";
  grundfarbe: string;
  fugenfarbe: string;
  /** Kantenlänge einer Fliese bzw. Dielenbreite (m) – steuert die Textur-Wiederholung. */
  masse_m: number;
}

export interface WandSpez {
  muster: "uni" | "fliesen";
  farbe: string;
  /** Höhe der Fliesenzone ab Boden (m); nur bei muster="fliesen". */
  fliesenHoehe_m?: number;
}

export interface OberflaechenSpez {
  boden: BodenSpez;
  wand: WandSpez;
}

// Heutige neutrale Optik (Stand vor dem Stil-Feature) – exakt erhalten, damit
// ohne Stilprofil nichts «springt».
const DEFAULT_BODEN = "#e8e2d6";
const DEFAULT_WAND = "#d8d2c4";

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Achsenwert aus dem styleVector, auf [-1,1] geklemmt (fehlend = 0 = neutral). */
function achse(sv: Record<string, number>, id: string): number {
  return clamp(sv[id] ?? 0, -1, 1);
}

/** [-1,1] → [0,1]. */
const norm = (v: number): number => (v + 1) / 2;

/**
 * HSL → #rrggbb (h in Grad, s/l in Prozent). Rein & deterministisch, damit die
 * Farbherleitung ohne DOM testbar bleibt (Tests laufen in Node).
 */
export function hslZuHex(h: number, s: number, l: number): string {
  const sn = clamp(s, 0, 100) / 100;
  const ln = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g] = [c, x];
  else if (hp < 2) [r, g] = [x, c];
  else if (hp < 3) [g, b] = [c, x];
  else if (hp < 4) [g, b] = [x, c];
  else if (hp < 5) [r, b] = [x, c];
  else [r, b] = [c, x];
  const m = ln - c / 2;
  const kanal = (v: number): string =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${kanal(r)}${kanal(g)}${kanal(b)}`;
}

/**
 * Grundton einer Fläche aus den Stilachsen:
 * - temperatur: warm → Beige/Terracotta-Hue (~30°), kühl → Blaugrau-Hue (~210°).
 * - farbigkeit + materialitaet: Sättigung (farbig & natürlich = kräftiger,
 *   synthetisch = neutraler).
 * - helligkeit: Helligkeit des Tons (dunkel↔hell).
 * `heller` hebt Wände gegenüber dem Boden an (Wände wirken üblich heller).
 */
function flaechenTon(sv: Record<string, number>, heller: boolean): string {
  const t = achse(sv, "temperatur");
  const hell = achse(sv, "helligkeit");
  const mat = achse(sv, "materialitaet");
  const farbig = achse(sv, "farbigkeit");

  const hue = 30 + (1 - norm(t)) * 180; // warm 30° … kühl 210°
  const sat = clamp(6 + norm(farbig) * 20 + norm(mat) * 8, 4, 42);
  const basisL = heller ? 60 : 46;
  const spanne = heller ? 26 : 34;
  const light = clamp(basisL + norm(hell) * spanne, 24, 88);
  return hslZuHex(hue, sat, light);
}

/** Etwas dunklere, entsättigte Variante als Fugen-/Schattenfarbe. */
function fuge(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m?.[1]) return hex;
  const n = Number.parseInt(m[1], 16);
  const dunkel = (c: number): string =>
    Math.round(c * 0.72)
      .toString(16)
      .padStart(2, "0");
  return `#${dunkel((n >> 16) & 0xff)}${dunkel((n >> 8) & 0xff)}${dunkel(n & 0xff)}`;
}

/**
 * Leitet Boden- und Wandoberfläche aus Stilprofil + Raumtyp ab.
 *
 * - `stilprofil == null` → heutige neutrale Defaults (kein «Spring»-Effekt).
 * - bad → Fliesenboden (0.3 m) + Wandfliesen bis 1.2 m.
 * - wohnen/schlafen/essen → Parkett (Dielen ~0.15 m breit) + Uni-Wand.
 * - kueche → Steinboden bei natürlicher Materialität, sonst Fliesen; Uni-Wand.
 * - sonst (flur/…) → schlichter Uni-Boden + Uni-Wand.
 */
// ── Wählbare Oberflächen-Varianten (3D-Viewer, Bryan-Wunsch «Flächen als
//    wählbare Objekte») ─────────────────────────────────────────────────────
// Rein visuelle Overrides der stilabgeleiteten Spez: der Nutzer klickt Boden
// bzw. Wand im 3D an und wählt eine vordefinierte Variante. KEIN Schema-/API-
// Eingriff – die Wahl lebt nur im Frontend-State und überschreibt lokal die
// `OberflaechenSpez`. Deterministisch & testbar (keine DOM-Abhängigkeit).

export interface BodenVariante {
  id: string;
  label: string;
  spez: BodenSpez;
}

export interface WandVariante {
  id: string;
  label: string;
  spez: WandSpez;
}

export interface OberflaechenVarianten {
  boden: BodenVariante[];
  wand: WandVariante[];
}

const B = (id: string, label: string, spez: BodenSpez): BodenVariante => ({ id, label, spez });
const W = (id: string, label: string, spez: WandSpez): WandVariante => ({ id, label, spez });

// Gemeinsamer Bausatz – je Raumtyp wird eine passende Teilmenge angeboten.
// `satisfies` statt Record-Annotation: so bleiben die Keys exakt und der Zugriff
// liefert `BodenVariante` (nicht `| undefined`) trotz noUncheckedIndexedAccess.
const BODEN = {
  fliesenHell: B("fliesen-hell", "Fliesen hell", {
    muster: "fliesen",
    grundfarbe: "#e8e2d6",
    fugenfarbe: fuge("#e8e2d6"),
    masse_m: 0.3,
  }),
  fliesenDunkel: B("fliesen-dunkel", "Fliesen dunkel", {
    muster: "fliesen",
    grundfarbe: "#5a554d",
    fugenfarbe: "#3a352f",
    masse_m: 0.3,
  }),
  parkettHell: B("parkett-hell", "Parkett hell", {
    muster: "parkett",
    grundfarbe: "#d9c3a0",
    fugenfarbe: fuge("#d9c3a0"),
    masse_m: 0.15,
  }),
  parkettWarm: B("parkett-warm", "Parkett warm", {
    muster: "parkett",
    grundfarbe: "#a9784f",
    fugenfarbe: fuge("#a9784f"),
    masse_m: 0.15,
  }),
  stein: B("stein", "Stein", {
    muster: "stein",
    grundfarbe: "#b7b2a7",
    fugenfarbe: fuge("#b7b2a7"),
    masse_m: 0.6,
  }),
} satisfies Record<string, BodenVariante>;

const WAND = {
  uniWeiss: W("uni-weiss", "Uni weiss", { muster: "uni", farbe: "#eceae4" }),
  uniWarm: W("uni-warm", "Uni warm", { muster: "uni", farbe: "#d8cfbf" }),
  uniSalbei: W("uni-salbei", "Uni salbei", { muster: "uni", farbe: "#c2c9ba" }),
  fliesenHell: W("wandfliesen-hell", "Wandfliesen hell", {
    muster: "fliesen",
    farbe: "#dfe3e6",
    fliesenHoehe_m: 1.2,
  }),
  fliesenDunkel: W("wandfliesen-dunkel", "Wandfliesen dunkel", {
    muster: "fliesen",
    farbe: "#8b9095",
    fliesenHoehe_m: 1.2,
  }),
} satisfies Record<string, WandVariante>;

/** Angebotene Boden-/Wandvarianten je Raumtyp (3-4 pro Fläche, POC-Auswahl). */
export function variantenFuer(roomType: string): OberflaechenVarianten {
  const rt = roomType.toLowerCase();
  if (rt === "bad") {
    return {
      boden: [BODEN.fliesenHell, BODEN.fliesenDunkel, BODEN.stein],
      wand: [WAND.fliesenHell, WAND.fliesenDunkel, WAND.uniWeiss],
    };
  }
  if (rt === "wohnen" || rt === "schlafen" || rt === "essen") {
    return {
      boden: [BODEN.parkettHell, BODEN.parkettWarm, BODEN.fliesenHell],
      wand: [WAND.uniWeiss, WAND.uniWarm, WAND.uniSalbei],
    };
  }
  if (rt === "kueche") {
    return {
      boden: [BODEN.fliesenHell, BODEN.stein, BODEN.parkettWarm],
      wand: [WAND.uniWeiss, WAND.uniWarm, WAND.fliesenHell],
    };
  }
  return {
    boden: [BODEN.parkettHell, BODEN.fliesenHell, BODEN.stein],
    wand: [WAND.uniWeiss, WAND.uniWarm, WAND.uniSalbei],
  };
}

/** Getroffene Variantenwahl (Variant-IDs; `null` = stilabgeleitete Default-Spez). */
export interface OberflaechenWahl {
  boden: string | null;
  wand: string | null;
}

/**
 * Wendet die Nutzerwahl auf die stilabgeleitete Basis-Spez an: eine gewählte
 * Boden-/Wandvariante überschreibt die Basis, sonst bleibt sie unverändert.
 * Rein & deterministisch – die Wahl bleibt so beim «Variante würfeln» erhalten.
 */
export function wendeVariantenAn(
  basis: OberflaechenSpez,
  roomType: string,
  wahl: OberflaechenWahl | null | undefined,
): OberflaechenSpez {
  if (!wahl) return basis;
  const satz = variantenFuer(roomType);
  const b = wahl.boden ? satz.boden.find((v) => v.id === wahl.boden) : undefined;
  const w = wahl.wand ? satz.wand.find((v) => v.id === wahl.wand) : undefined;
  return { boden: b?.spez ?? basis.boden, wand: w?.spez ?? basis.wand };
}

// ── Flächen-Konzept des Kurators (Pipeline v2, Call C) ──────────────────────
// Der Kurator liefert optional ein `flaechen`-Objekt (pro Wand Material +
// Bereich, plus Boden-Material). Es ist die *fachliche* Vorgabe und schlägt die
// stilabgeleitete Optik. Fehlt es (Baseline/alte Pläne) → exakt das bisherige
// Verhalten (Fallback bleibt). Reine, DOM-freie Ableitung – testbar in Node.

export type MaterialSlug = kuratorVertrag.MaterialSlug;
/** Voll aufgelöstes Flächen-Konzept (nie undefined) für die Resolver unten. */
export type FlaechenKonzept = NonNullable<kuratorVertrag.KuratorResponse["flaechen"]>;
/** Ein Wand-Eintrag im Flächen-Konzept (wandIndex/material/bereich/hoeheM/akzent). */
type WandEintrag = NonNullable<FlaechenKonzept["waende"]>[number];

/**
 * Einheitlicher, texturfähiger Flächen-Look – gemeinsame Sprache für Boden UND
 * Wandzonen (die Textur-Generatoren in `raum3d.tsx` lesen nur diesen Typ). `holz`
 * ist die Wand-Variante der Boden-«parkett»-Lamellen; `uni` = flache Farbe.
 */
export interface FlaechenLook {
  muster: "fliesen" | "parkett" | "holz" | "stein" | "uni";
  farbe: string;
  fugenfarbe: string;
  /** Kachel-/Lamellenmass (m) – steuert die Textur-Wiederholung je Segment. */
  masse_m: number;
}

/** Untere Materialzone [0, hoeheM] + Basis-Look darüber/dahinter (= Fallback). */
export interface WandZonen {
  /** Look der (oberen) Restfläche – bei «voll» durch die Zone verdeckt. */
  basis: FlaechenLook;
  /** Optionale Materialzone ab Boden; `null` = die Basis füllt die ganze Wand. */
  zone: { look: FlaechenLook; hoeheM: number } | null;
}

// Default-Bandhöhen je Bereich (m), wenn der Kurator kein hoeheM mitgibt.
const HOEHE_HALBHOCH = 1.2;
const HOEHE_SOCKEL = 0.1;
// «voll» = Materialzone über die ganze Wand; ein grosszügiger Wert deckt jede
// realistische Raumhöhe (clipZone kürzt auf die echte Höhe).
const HOEHE_VOLL = 100;

/** Hex-Farbe kanalweise mit `faktor` skalieren (0.85 = leicht abdunkeln). */
function skaliere(hex: string, faktor: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m?.[1]) return hex;
  const n = Number.parseInt(m[1], 16);
  const k = (c: number): string =>
    clamp(Math.round(c * faktor), 0, 255)
      .toString(16)
      .padStart(2, "0");
  return `#${k((n >> 16) & 0xff)}${k((n >> 8) & 0xff)}${k(n & 0xff)}`;
}

// Geerdete Looks je Material-Slug (Farben/Muster wie die bestehenden Canvas-
// Looks). Boden nutzt daraus die BodenSpez (holz → parkett-Lamellen), Wände den
// FlaechenLook direkt (holz bleibt holz).
const MATERIAL_LOOK: Record<MaterialSlug, FlaechenLook> = {
  "fliesen-hell": { muster: "fliesen", farbe: "#e8e2d6", fugenfarbe: "#c9c9c2", masse_m: 0.3 },
  "fliesen-gruen": { muster: "fliesen", farbe: "#b6c2a6", fugenfarbe: "#93a184", masse_m: 0.3 },
  "fliesen-anthrazit": { muster: "fliesen", farbe: "#3f4448", fugenfarbe: "#2b2f32", masse_m: 0.3 },
  "putz-weiss": { muster: "uni", farbe: "#eceae4", fugenfarbe: fuge("#eceae4"), masse_m: 0.3 },
  "putz-warm": { muster: "uni", farbe: "#d8cfbf", fugenfarbe: fuge("#d8cfbf"), masse_m: 0.3 },
  "holz-hell": { muster: "holz", farbe: "#d9c3a0", fugenfarbe: fuge("#d9c3a0"), masse_m: 0.15 },
  "holz-dunkel": { muster: "holz", farbe: "#6f4f34", fugenfarbe: fuge("#6f4f34"), masse_m: 0.15 },
  "parkett-eiche": { muster: "holz", farbe: "#b08d5b", fugenfarbe: fuge("#b08d5b"), masse_m: 0.15 },
  beton: { muster: "stein", farbe: "#9a9a95", fugenfarbe: "#89897f", masse_m: 0.8 },
  naturstein: { muster: "stein", farbe: "#b7a98f", fugenfarbe: fuge("#b7a98f"), masse_m: 0.6 },
};

/** Look eines Material-Slugs (Kopie, damit Aufrufer sie gefahrlos abwandeln). */
export function materialLook(slug: MaterialSlug): FlaechenLook {
  return { ...MATERIAL_LOOK[slug] };
}

/** Akzent-Variante: dezent dunkler/kräftiger (Boden bleibt unberührt, nur Wände). */
export function akzentLook(look: FlaechenLook): FlaechenLook {
  return {
    ...look,
    farbe: skaliere(look.farbe, 0.85),
    fugenfarbe: skaliere(look.fugenfarbe, 0.85),
  };
}

/** BodenSpez aus einem Material-Slug (holz-Lamellen → parkett-Muster des Bodens). */
export function bodenSpezAusSlug(slug: MaterialSlug): BodenSpez {
  const l = materialLook(slug);
  const muster: BodenSpez["muster"] = l.muster === "holz" ? "parkett" : l.muster;
  return { muster, grundfarbe: l.farbe, fugenfarbe: l.fugenfarbe, masse_m: l.masse_m };
}

/**
 * WandSpez → Zonen. Die heutige Bad-Logik «Fliesensockel unten, Uni oben» wird
 * so 1:1 zu {basis: uni(farbe), zone: fliesen bis fliesenHoehe} – die Optik der
 * Stil-/Varianten-Ableitung bleibt unverändert.
 */
export function wandSpezZuZonen(spez: WandSpez): WandZonen {
  const basis: FlaechenLook = {
    muster: "uni",
    farbe: spez.farbe,
    fugenfarbe: fuge(spez.farbe),
    masse_m: 0.3,
  };
  if (spez.muster === "fliesen") {
    return {
      basis,
      zone: {
        look: { muster: "fliesen", farbe: spez.farbe, fugenfarbe: "#c9c9c2", masse_m: 0.3 },
        hoeheM: spez.fliesenHoehe_m ?? HOEHE_HALBHOCH,
      },
    };
  }
  return { basis, zone: null };
}

/** Boden-Look: Kurator-Material schlägt die stilabgeleitete BodenSpez, sonst Fallback. */
export function loeseBodenSpez(
  fallback: BodenSpez,
  flaechen: FlaechenKonzept | null | undefined,
): BodenSpez {
  const slug = flaechen?.boden?.material;
  return slug ? bodenSpezAusSlug(slug) : fallback;
}

/**
 * Zonen je Wand (Index = Position in room.shell.walls). Ein `waende`-Eintrag mit
 * passendem `wandIndex` bestimmt Material + Bereich; ohne Eintrag gilt der
 * Fallback-Look (Stil-/Varianten-Ableitung). Der Bereich über der Materialzone
 * bleibt der Fallback-Basis-Look («darüber Putz-/Fallback-Look»).
 */
export function loeseWandZonen(
  fallback: WandSpez,
  flaechen: FlaechenKonzept | null | undefined,
  wandAnzahl: number,
): WandZonen[] {
  const fallbackZonen = wandSpezZuZonen(fallback);
  const proWand = new Map<number, WandEintrag>();
  for (const w of flaechen?.waende ?? []) proWand.set(w.wandIndex, w);
  return Array.from({ length: wandAnzahl }, (_, i) => {
    const eintrag = proWand.get(i);
    if (!eintrag) return fallbackZonen;
    const roh = materialLook(eintrag.material);
    const look = eintrag.akzent ? akzentLook(roh) : roh;
    const bereich = eintrag.bereich ?? "voll";
    const hoeheM =
      bereich === "voll"
        ? HOEHE_VOLL
        : (eintrag.hoeheM ?? (bereich === "sockel" ? HOEHE_SOCKEL : HOEHE_HALBHOCH));
    return { basis: fallbackZonen.basis, zone: { look, hoeheM } };
  });
}

export function leiteOberflaechen(
  stilprofil: StilprofilSicht | null | undefined,
  roomType: string,
): OberflaechenSpez {
  if (!stilprofil) {
    return {
      boden: {
        muster: "uni",
        grundfarbe: DEFAULT_BODEN,
        fugenfarbe: fuge(DEFAULT_BODEN),
        masse_m: 0.3,
      },
      wand: { muster: "uni", farbe: DEFAULT_WAND },
    };
  }
  const sv = stilprofil.styleVector ?? {};
  const bodenTon = flaechenTon(sv, false);
  const wandTon = flaechenTon(sv, true);
  const rt = roomType.toLowerCase();

  if (rt === "bad") {
    return {
      boden: { muster: "fliesen", grundfarbe: bodenTon, fugenfarbe: fuge(bodenTon), masse_m: 0.3 },
      // Wandfliesen etwas heller/kühler als der Grundton – klassischer Bad-Sockel.
      wand: {
        muster: "fliesen",
        farbe: hslZuHex(30 + (1 - norm(achse(sv, "temperatur"))) * 180, 10, 82),
        fliesenHoehe_m: 1.2,
      },
    };
  }
  if (rt === "wohnen" || rt === "schlafen" || rt === "essen") {
    return {
      boden: { muster: "parkett", grundfarbe: bodenTon, fugenfarbe: fuge(bodenTon), masse_m: 0.15 },
      wand: { muster: "uni", farbe: wandTon },
    };
  }
  if (rt === "kueche") {
    const natuerlich = achse(sv, "materialitaet") > 0.2;
    return {
      boden: natuerlich
        ? { muster: "stein", grundfarbe: bodenTon, fugenfarbe: fuge(bodenTon), masse_m: 0.6 }
        : { muster: "fliesen", grundfarbe: bodenTon, fugenfarbe: fuge(bodenTon), masse_m: 0.3 },
      wand: { muster: "uni", farbe: wandTon },
    };
  }
  return {
    boden: { muster: "uni", grundfarbe: bodenTon, fugenfarbe: fuge(bodenTon), masse_m: 0.3 },
    wand: { muster: "uni", farbe: wandTon },
  };
}
