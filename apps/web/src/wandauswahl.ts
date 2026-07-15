/** Einzelwand-Materialwahl (Welle C) – reine, DOM-freie Logik.
 *
 * Zwei Aufgaben:
 * 1. **Wand-Beschreibung** fürs Flächen-Panel: je Wand Index, Länge, Öffnungen
 *    und Anschlüsse (deutsches Pendant zu `_wandliste` in kurator.py – gleiche
 *    Datenquelle Raummodell, damit UI und Kurator-Prompt dieselbe Wandsicht haben).
 * 2. **Override-Auflösung**: manuelle Einzelwand-Werte überschreiben das
 *    Kurator-Flächenkonzept **je wandIndex** (nicht pauschal) – Einträge anderer
 *    Wände bleiben erhalten. «Alle Wände» ersetzt bewusst alle Einträge.
 *
 * Die harte Norm prüft weiterhin der Server (POST /flaechen/pruefen) – hier
 * wird nur das Konzept-Objekt gebaut, nie ein Urteil gefällt.
 */

import type { Room } from "./api";
import type { FlaechenKonzept, MaterialSlug } from "./oberflaechen";

/** Vertikaler Bereich einer Wand-Materialzone (Vertrags-Enum, kurator-vertrag). */
export type WandBereich = "voll" | "halbhoch" | "sockel";

export const BEREICH_LABEL: Record<WandBereich, string> = {
  voll: "Voll",
  halbhoch: "Halbhoch",
  sockel: "Sockel",
};

/** Kompakte Wandsicht fürs Panel: Index · Länge · Öffnungen · Anschlüsse. */
export interface WandInfo {
  index: number;
  laengeM: number;
  /** Deutsche Öffnungs-Labels (Tür/Fenster), dedupliziert & sortiert. */
  oeffnungen: string[];
  /** Anschluss-Typen an dieser Wand (wasser/abwasser/strom …), dedupliziert. */
  anschluesse: string[];
  /** Offene Seite (Grossraum, kind ≠ massiv/leicht bzw. thickness 0). */
  offen: boolean;
}

const OEFFNUNG_LABEL: Record<string, string> = { door: "Tür", window: "Fenster" };

/** Wände eines Raums als Panel-Zeilen (0-basierter Index = wandIndex im Vertrag). */
export function beschreibeWaende(room: Room): WandInfo[] {
  const oeffnungenProWand = new Map<string, string[]>();
  for (const o of room.openings) {
    const liste = oeffnungenProWand.get(o.hostWall) ?? [];
    liste.push(OEFFNUNG_LABEL[o.type] ?? o.type);
    oeffnungenProWand.set(o.hostWall, liste);
  }
  // `wall` ist im vollen Raummodell-Schema optional vorhanden, in der minimalen
  // RoomInput-Sicht nicht deklariert – daher der schmale Cast (wie `thickness`).
  const anschluesseProWand = new Map<string, string[]>();
  for (const f of room.fixpoints as unknown as { type: string; wall?: string | null }[]) {
    if (!f.wall) continue;
    const liste = anschluesseProWand.get(f.wall) ?? [];
    liste.push(f.type);
    anschluesseProWand.set(f.wall, liste);
  }
  return room.shell.walls.map((w, index) => {
    const dicke = (w as { thickness?: number }).thickness;
    return {
      index,
      laengeM: Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1]),
      oeffnungen: [...new Set(oeffnungenProWand.get(w.id) ?? [])].sort(),
      anschluesse: [...new Set(anschluesseProWand.get(w.id) ?? [])].sort(),
      offen: dicke !== undefined && dicke <= 1e-6,
    };
  });
}

/** Wand-Einträge eines Flächenkonzepts (nie undefined). */
type WandEintraege = NonNullable<FlaechenKonzept["waende"]>;

/**
 * Material (+ Bereich) für GENAU EINE Wand setzen: der Eintrag mit passendem
 * `wandIndex` wird ersetzt (bzw. ergänzt), alle anderen – auch die des
 * Kurators – bleiben unverändert. So schlägt die manuelle Einzelwand-Wahl den
 * Kurator nur dort, wo der Nutzer eingreift.
 */
export function setzeWandMaterial(
  basis: FlaechenKonzept,
  wandIndex: number,
  material: MaterialSlug,
  bereich: WandBereich = "voll",
): FlaechenKonzept {
  const andere: WandEintraege = (basis.waende ?? []).filter((w) => w.wandIndex !== wandIndex);
  const neu: WandEintraege[number] = { wandIndex, material, bereich };
  return {
    ...basis,
    waende: [...andere, neu].sort((a, b) => a.wandIndex - b.wandIndex),
  };
}

/** «Alle Wände»-Schnellwahl: ersetzt sämtliche Wand-Einträge (bisheriges Verhalten). */
export function setzeAlleWaende(
  basis: FlaechenKonzept,
  wandAnzahl: number,
  material: MaterialSlug,
  bereich: WandBereich = "voll",
): FlaechenKonzept {
  return {
    ...basis,
    waende: Array.from({ length: wandAnzahl }, (_, wandIndex) => ({
      wandIndex,
      material,
      bereich,
    })),
  };
}

/** Aktives Material/Bereich einer Wand aus dem effektiven Konzept (fürs Panel). */
export function wandEintrag(
  konzept: FlaechenKonzept | null | undefined,
  wandIndex: number,
): { material?: MaterialSlug; bereich: WandBereich } {
  const e = konzept?.waende?.find((w) => w.wandIndex === wandIndex);
  return { material: e?.material, bereich: (e?.bereich ?? "voll") as WandBereich };
}
