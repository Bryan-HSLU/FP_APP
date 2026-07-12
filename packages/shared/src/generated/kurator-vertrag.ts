/* AUTOGENERIERT aus packages/shared/schemas – nicht von Hand ändern (pnpm codegen). */

export type Uuid = string;
/**
 * Geerdete Material-Slugs für Boden/Wand – EINZIGE zulässige Werte. Der Client rendert die Looks prozedural (siehe apps/web/src/oberflaechen.ts). Änderungen hier = bewusster Vertrags-Akt (TS-Union + Python lesen dieselbe Liste).
 */
export type MaterialSlug =
  | "fliesen-hell"
  | "fliesen-gruen"
  | "fliesen-anthrazit"
  | "putz-weiss"
  | "putz-warm"
  | "holz-hell"
  | "holz-dunkel"
  | "parkett-eiche"
  | "beton"
  | "naturstein";

/**
 * Vertrag 7: Schnittstelle zum KI-Kurator (ADR-0007). Erdung als Schema-Regel: Response-IDs müssen Teilmenge des katalogAuszug sein – sonst Retry/Fallback deterministische Baseline. v0.2 (additiv/minor): optionale Felder «anordnung» (weiche Anordnungs-Anweisungen je Item) und «flaechen» (Boden-/Wand-Material-Wünsche) – Kurator-Pipeline v2 (3 Calls).
 */
export interface KuratorVertrag {
  request?: KuratorRequest;
  response?: KuratorResponse;
}
export interface KuratorRequest {
  stilprofilRef: Uuid;
  raumFakten: {
    roomType: "bad" | "kueche" | "wohnen" | "schlafen" | "essen" | "flur" | "sonstig";
    flaeche_m2: number;
    zonen?: string[];
    fixpunkte?: ("wasser" | "abwasser" | "elektro" | "starkstrom" | "lueftung" | "heizung")[];
    oeffnungen?: ("door" | "window")[];
  };
  /**
   * Vorgefilterte Items (IDs + Tags + Masse + Klasse) – der Kurator wählt NUR daraus.
   *
   * @minItems 1
   */
  katalogAuszug: [
    {
      id: Uuid;
      funktionsTyp: string;
      priorityClass: "P1" | "P2" | "P3";
      masse?: {
        w: number;
        d: number;
        h: number;
      };
      achsenTags?: {
        [k: string]: number;
      };
      attributTags?: string[];
    },
    ...{
      id: Uuid;
      funktionsTyp: string;
      priorityClass: "P1" | "P2" | "P3";
      masse?: {
        w: number;
        d: number;
        h: number;
      };
      achsenTags?: {
        [k: string]: number;
      };
      attributTags?: string[];
    }[],
  ];
  budget?: number;
  normProfile: "ch" | "eu";
}
export interface KuratorResponse {
  /**
   * catalogItemIds – MUSS Teilmenge von request.katalogAuszug sein (harte Validierung).
   */
  auswahl: Uuid[];
  relationaleAbsichten: {
    itemId: Uuid;
    /**
     * Mini-Grammatik, z.B. near:lavabo:1.2.
     */
    relation: string;
    targetId?: Uuid;
    zone?: string;
  }[];
  /**
   * Weiche Anordnungs-Anweisungen je Item (Call B). Alle Felder ausser itemId optional. Der Solver behandelt sie als Präferenzen (nie als harte Regeln): wandIndex wird auf die Kandidaten dieser Wand gefiltert (Fallback auf alle, wenn dort kein normkonformer Platz frei ist), relationen ergänzen/überschreiben die relationaleAbsichten, prioritaet ordnet innerhalb P2/P3.
   */
  anordnung?: {
    itemId: Uuid;
    /**
     * 0-basierter Index in room.shell.walls.
     */
    wandIndex?: number;
    /**
     * Strings der bestehenden Relations-Grammatik (near/against-wall/corner/facing/opposite/group/pair-with).
     */
    relationen?: string[];
    /**
     * Kleinere Zahl zuerst (Reihenfolge innerhalb einer Prioritätsklasse).
     */
    prioritaet?: number;
  }[];
  /**
   * Boden-/Wand-Material-Wünsche (Call C). Nur Slugs aus $defs/materialSlug. Der Client leitet die Optik ansonsten deterministisch ab (oberflaechen.ts).
   */
  flaechen?: {
    boden?: {
      material?: MaterialSlug;
    };
    waende?: {
      wandIndex: number;
      material: MaterialSlug;
      /**
       * Vertikale Ausdehnung; hoeheM nur bei halbhoch/sockel sinnvoll.
       */
      bereich?: "voll" | "halbhoch" | "sockel";
      /**
       * Höhe der Materialzone ab Boden (m), nur bei halbhoch/sockel.
       */
      hoeheM?: number;
      akzent?: boolean;
    }[];
  };
  begruendung?: string;
}
