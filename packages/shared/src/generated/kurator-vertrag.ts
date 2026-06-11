/* AUTOGENERIERT aus packages/shared/schemas – nicht von Hand ändern (pnpm codegen). */

export type Uuid = string;

/**
 * Vertrag 7: Schnittstelle zum KI-Kurator (ADR-0007). Erdung als Schema-Regel: Response-IDs müssen Teilmenge des katalogAuszug sein – sonst Retry/Fallback deterministische Baseline.
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
  begruendung?: string;
}
