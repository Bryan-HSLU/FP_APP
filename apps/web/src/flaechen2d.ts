/** Flächen-Layer für den 2D-Grundriss (Welle C) – reine, DOM-freie Ableitung.
 *
 * Löst das Flächen-Konzept (Kurator ODER manuelle Overrides) über DIESELBE
 * Quelle auf wie der 3D-Viewer (`leiteOberflaechen` → `wendeVariantenAn` →
 * `loeseBodenSpez`/`loeseWandZonen`) und verdichtet es auf das, was der Plan
 * zeigen kann: eine dezente Boden-Tönung + je Wand einen Material-Farbton
 * (Akzentwand erkennbar) + eine kleine Legende mit Material-Namen.
 *
 * 2D und 3D können so nie auseinanderlaufen – es gibt nur EINE Auflösung.
 */

import {
  leiteOberflaechen,
  loeseBodenSpez,
  loeseWandZonen,
  MATERIAL_LABEL,
  wendeVariantenAn,
  type BodenSpez,
  type FlaechenKonzept,
  type OberflaechenWahl,
  type StilprofilSicht,
} from "./oberflaechen";

/** Deutsche Fallback-Labels, wenn kein Material-Slug bekannt ist (Stil-Ableitung). */
const MUSTER_LABEL: Record<string, string> = {
  fliesen: "Fliesen",
  parkett: "Parkett",
  holz: "Holz",
  stein: "Stein",
  uni: "Uni",
};

export interface WandFlaeche2D {
  /** Farbton der Materialzone (Akzentwände sind bereits abgedunkelt). */
  farbe: string;
  fugenfarbe: string;
  muster: string;
  /** Deutscher Material-Name (Slug-Label oder Muster-Fallback). */
  label: string;
  akzent: boolean;
}

export interface Flaechen2D {
  boden: { spez: BodenSpez; label: string };
  /** Index = Position in room.shell.walls (wie loeseWandZonen). */
  waende: WandFlaeche2D[];
  /** Eindeutige Material-Namen mit Swatch-Farbe (Boden zuerst) für die Legende. */
  legende: { label: string; farbe: string }[];
}

/**
 * Aufgelöste Flächen-Darstellung für den 2D-Plan.
 *
 * `flaechen` ist das EFFEKTIVE Konzept (manuelle Overrides schlagen den
 * Kurator – dieselbe Vorrangregel wie im 3D-Viewer); `null` = reine
 * Stil-/Varianten-Ableitung.
 */
export function loeseFlaechen2D(
  roomType: string,
  stilprofil: StilprofilSicht | null | undefined,
  oberflaechenWahl: OberflaechenWahl | null | undefined,
  flaechen: FlaechenKonzept | null | undefined,
  wandAnzahl: number,
): Flaechen2D {
  const spez = wendeVariantenAn(
    leiteOberflaechen(stilprofil ?? null, roomType),
    roomType,
    oberflaechenWahl,
  );
  const boden = loeseBodenSpez(spez.boden, flaechen);
  const zonen = loeseWandZonen(spez.wand, flaechen, wandAnzahl);

  const bodenSlug = flaechen?.boden?.material;
  const bodenLabel = bodenSlug ? MATERIAL_LABEL[bodenSlug] : (MUSTER_LABEL[boden.muster] ?? "Uni");

  const slugProWand = new Map<number, { slug: string; akzent: boolean }>();
  for (const w of flaechen?.waende ?? []) {
    slugProWand.set(w.wandIndex, { slug: w.material, akzent: w.akzent ?? false });
  }
  const waende: WandFlaeche2D[] = zonen.map((z, i) => {
    // Sichtbarer Look im Plan: die Materialzone, falls vorhanden, sonst die Basis
    // (Wandbänder haben keine Höhe – der Sockel-/Halbhoch-Ton steht für die Wand).
    const look = z.zone ? z.zone.look : z.basis;
    const eintrag = slugProWand.get(i);
    return {
      farbe: look.farbe,
      fugenfarbe: look.fugenfarbe,
      muster: look.muster,
      label: eintrag
        ? (MATERIAL_LABEL[eintrag.slug as keyof typeof MATERIAL_LABEL] ?? eintrag.slug)
        : (MUSTER_LABEL[look.muster] ?? "Uni"),
      akzent: eintrag?.akzent ?? false,
    };
  });

  const legende: { label: string; farbe: string }[] = [];
  const eintraege = [
    { label: `Boden: ${bodenLabel}`, farbe: boden.grundfarbe },
    ...waende.map((w) => ({
      label: `Wand: ${w.label}${w.akzent ? " (Akzent)" : ""}`,
      farbe: w.farbe,
    })),
  ];
  for (const e of eintraege) {
    if (!legende.some((l) => l.label === e.label)) legende.push(e);
  }
  return { boden: { spez: boden, label: bodenLabel }, waende, legende };
}
