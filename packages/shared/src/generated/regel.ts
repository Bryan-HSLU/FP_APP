/* AUTOGENERIERT aus packages/shared/schemas – nicht von Hand ändern (pnpm codegen). */

/**
 * Vertrag 6: deklarative Norm-Regel (Daten statt Code, Norm-Regelsatz-v0). Beide Interpreter (TS @fp/shared · Python fp_engines) lesen exakt dieses Format. Parameter-Konventionen je type: siehe packages/shared/src/rules/README.md.
 */
export interface Regel {
  id: string;
  /**
   * «alle» = Basis-Rahmen, gilt in jedem Raum. Im Grossraum gelten Regeln pro Zone.
   */
  roomType: "alle" | "bad" | "kueche" | "wohnen" | "schlafen" | "essen" | "flur" | "sonstig";
  /**
   * funktionsTyp des Zielobjekts (z.B. wc, lavabo) oder «*» für alle Objekte bzw. raumbezogene Regeln.
   */
  appliesTo: string;
  kategorie: "rahmen" | "objekt-raum" | "objekt-objekt" | "sperrzone" | "anschluss" | "ergonomie";
  type:
    | "collision"
    | "wall-distance"
    | "object-distance"
    | "clearance"
    | "door-swing"
    | "keep-clear"
    | "host-binding"
    | "connection"
    | "circulation"
    | "relation";
  /**
   * hard = Constraint (muss) · soft = Score (Ergonomie/Stil).
   */
  severity: "hard" | "soft";
  /**
   * Parametrierung je type (z.B. minDist, depth, width, radius, anschluss, maxDist, measure).
   */
  params?: {
    [k: string]: number | string;
  };
  /**
   * Regel gilt nur in diesem Normprofil; ohne Feld: in allen.
   */
  normProfile?: "ch" | "eu";
  /**
   * Profil → params-Overrides (CH/EU-Werte über der Basis).
   */
  profilOverrides?: {
    [k: string]: {
      [k: string]: number | string;
    };
  };
  /**
   * Strengere Werte, wenn Barrierefrei-Overlay aktiv (Mechanik vorgesehen, Werte post-POC).
   */
  barrierefreiOverride?: {
    [k: string]: number | string;
  };
  quelle: string;
  status: "zu-verifizieren" | "verifiziert";
  hinweis?: string;
}
