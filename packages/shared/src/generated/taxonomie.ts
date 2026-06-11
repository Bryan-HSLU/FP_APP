/* AUTOGENERIERT aus packages/shared/schemas – nicht von Hand ändern (pnpm codegen). */

/**
 * Stützschema (Stammdaten): datengetriebenes Achsen-Set (ADR-0006) + offenes Attribut-Vokabular. Erweiterung der Achsen/Attribute braucht KEINE Schema-Änderung – nur eine neue Taxonomie-Version.
 */
export interface Taxonomie {
  taxonomyVersion: string;
  /**
   * @minItems 1
   */
  achsen: [
    {
      id: string;
      /**
       * Bedeutung bei −1.
       */
      negativPol: string;
      /**
       * Bedeutung bei +1.
       */
      positivPol: string;
      beschreibung?: string;
    },
    ...{
      id: string;
      /**
       * Bedeutung bei −1.
       */
      negativPol: string;
      /**
       * Bedeutung bei +1.
       */
      positivPol: string;
      beschreibung?: string;
    }[],
  ];
  attributKategorien: {
    id: string;
    beschreibung?: string;
    /**
     * Optional: bekannte Werte; offenes Vokabular, neue Werte erlaubt.
     */
    werte?: string[];
  }[];
}
