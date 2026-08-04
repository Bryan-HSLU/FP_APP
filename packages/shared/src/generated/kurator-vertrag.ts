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
  | "naturstein"
  | "tapete-hell"
  | "taefer-holz";

/**
 * Vertrag 7: Schnittstelle zum KI-Kurator (ADR-0007). Erdung als Schema-Regel: Response-IDs müssen Teilmenge des katalogAuszug sein – sonst Retry/Fallback deterministische Baseline. v0.2 (additiv/minor): optionale Felder «anordnung» (weiche Anordnungs-Anweisungen je Item) und «flaechen» (Boden-/Wand-Material-Wünsche) – Kurator-Pipeline v2 (3 Calls). v0.4 (additiv/minor): optionales Feld «konzept» (Design-Leitidee aus Call A, «erst denken, dann wählen») – Kurator-Pipeline v3 (ADR-0013). v0.5 (additiv/minor): optionales Feld «farben» (itemId→Farb-Slug, KI-Farbwahl je Objekt, geerdet auf farbVarianten) – Kurator-Pipeline v3, Welle 3. v0.6 (additiv/minor): optionale Felder «hauptObjekte» (raumprägende Items zuerst) und «ergaenzungen» (Item + anzahl, an Haupt-Objekte verankert) – Objekt-Ebenen-Modell (ADR-0014). «auswahl» bleibt Pflicht und enthält weiterhin JEDE gewählte itemId genau einmal (Kompatibilität).
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
    }[]
  ];
  budget?: number;
  normProfile: "ch" | "eu";
}
export interface KuratorResponse {
  /**
   * Design-Leitidee aus Call A (deutsch, «erst denken, dann wählen»): 1–3 Sätze mit Leitidee, 1–2 Leitmaterialien und Farbwelt, abgestimmt auf Stilprofil UND Raum. Wird wortgleich in Call B/C übernommen und ist UI-zeigbar. Optional (fehlend/leer = kein Konzept-Block, weiche Freiheit, keine Norm).
   */
  konzept?: string;
  /**
   * catalogItemIds – MUSS Teilmenge von request.katalogAuszug sein (harte Validierung). Enthält jede gewählte itemId genau EINMAL (Haupt- und Ergänzungs-Items zusammen, expandiert); die Mengen stehen in «ergaenzungen» (Objekt-Ebenen-Modell, ADR-0014).
   */
  auswahl: Uuid[];
  /**
   * Raumprägende Items (objektEbene=haupt), ZUERST bestimmt (Call A, Objekt-Ebenen-Modell v0.6). Optional; wenn vorhanden Teilmenge von «auswahl». Jedes P1-Pflicht-Item muss hier stehen (harte Validierung).
   */
  hauptObjekte?: Uuid[];
  /**
   * Ergänzende Items (objektEbene=ergaenzung) mit Anzahl (Call A, Objekt-Ebenen-Modell v0.6). Optional. Jedes itemId muss in «auswahl» stehen; anzahl 1..maxAnzahl des Items; ein Item mit ankerTyp nur, wenn ein Haupt-Objekt dieses funktionsTyps gewählt ist (harte Validierung).
   */
  ergaenzungen?: {
    itemId: Uuid;
    anzahl: number;
  }[];
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
  /**
   * Gewählte Farbvariante je generischem Objekt (Call A, Kurator-Pipeline v3, Welle 3): Abbildung itemId → Farb-Slug. Optional; wenn vorhanden, müssen die Keys eine Teilmenge von «auswahl» sein und jeder Slug in den farbVarianten des jeweiligen Katalog-Items liegen (hart validiert – Erdung wie bei den Material-Slugs). Fehlt/leer = kein KI-Farbwunsch; der Client nutzt die Default-Optik (erste farbVariante).
   */
  farben?: {
    /**
     * Farbwelt der Katalog-Items (additiv erweiterbar, minor). Gruppiert: Neutraltöne, Holz, Metall/Stein, Farbakzente. Reihenfolge ist stabil – der Client leitet daraus die Picker-Sortierung ab.
     */
    [k: string]:
      | "weiss"
      | "creme"
      | "sand"
      | "beige"
      | "taupe"
      | "hellgrau"
      | "warmgrau"
      | "anthrazit"
      | "schwarz"
      | "esche-hell"
      | "eiche-hell"
      | "eiche-natur"
      | "nussbaum"
      | "wenge"
      | "buche"
      | "chrom"
      | "edelstahl"
      | "schwarzstahl"
      | "messing"
      | "kupfer"
      | "beton"
      | "naturstein-hell"
      | "marmor-weiss"
      | "salbei"
      | "graugruen"
      | "olive"
      | "petrol"
      | "blaugrau"
      | "dunkelblau"
      | "terracotta"
      | "rostrot"
      | "senf"
      | "bordeaux";
  };
  begruendung?: string;
}
