/** Layer-System v2 für den 2D-Grundriss (reine, testbare Logik – kein DOM).
 *
 *  Löst die bisherigen vier «Ebenen»-Checkboxen ab. Zwei Gruppen:
 *  - **Darstellungs-Layer**: globale Toggles (Wände, Öffnungen, Objekte,
 *    Bounding-Boxen, Platzbedarf, Beschriftung, Masse, Ampel) wie CAD-Layer.
 *  - **Objekt-Layer**: pro Möbel eine Zeile mit Auge-Toggle – einzelne Objekte
 *    ein-/ausblenden (`versteckteObjekte`).
 *
 *  Der Viewer hält `sichtbareLayer: Record<LayerId, boolean>` und
 *  `versteckteObjekte: Set<string>`; die Umschalt-Logik lebt hier.
 */

export type LayerId =
  | "waende"
  | "oeffnungen"
  | "objekte"
  | "boxen"
  | "platzbedarf"
  | "beschriftung"
  | "masse"
  | "ampel";

export interface LayerDef {
  id: LayerId;
  label: string;
  /** Emoji-Piktogramm (leichtgewichtig, ohne Asset-Abhängigkeit). */
  icon: string;
}

/** Reihenfolge & Beschriftung der Darstellungs-Layer im Panel. */
export const DARSTELLUNGS_LAYER: LayerDef[] = [
  { id: "waende", label: "Wände", icon: "🧱" },
  { id: "oeffnungen", label: "Öffnungen", icon: "🚪" },
  { id: "objekte", label: "Objekte", icon: "🛋️" },
  { id: "boxen", label: "Bounding-Boxen", icon: "⬛" },
  { id: "platzbedarf", label: "Platzbedarf", icon: "📐" },
  { id: "beschriftung", label: "Beschriftung", icon: "🏷️" },
  { id: "masse", label: "Masse", icon: "📏" },
  { id: "ampel", label: "Ampel", icon: "🚦" },
];

/** Sinnvolle Standard-Sichtbarkeit: Wände/Öffnungen/Objekte/Beschriftung/Ampel
 *  an; Bounding-Boxen, Platzbedarf und Masse aus. */
export function defaultLayers(): Record<LayerId, boolean> {
  return {
    waende: true,
    oeffnungen: true,
    objekte: true,
    boxen: false,
    platzbedarf: false,
    beschriftung: true,
    masse: false,
    ampel: true,
  };
}

/** Einen Darstellungs-Layer umschalten (unveränderlich). */
export function toggleLayer(
  state: Record<LayerId, boolean>,
  id: LayerId,
): Record<LayerId, boolean> {
  return { ...state, [id]: !state[id] };
}

/** Ein Objekt einzeln ein-/ausblenden (unveränderlich, neues Set). */
export function toggleObjekt(versteckt: Set<string>, id: string): Set<string> {
  const next = new Set(versteckt);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Ist ein Objekt sichtbar (nicht in der Versteckt-Menge)? */
export function objektSichtbar(versteckt: Set<string>, id: string): boolean {
  return !versteckt.has(id);
}
