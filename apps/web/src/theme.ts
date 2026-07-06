/** Corporate-Identity-Farbtokens (Future Planning).
 *
 *  Quelle/Vorgabe: ../FP_Kopf/vault/40_Produktkonzepte/Corporate-Identity.md
 *  (Farbpalette-Tabelle). Nicht frei erfinden – Änderungen an den Werten dort
 *  zuerst festhalten (Bryan), dann hier nachziehen.
 */
export const THEME = {
  gruen: "#243D35",
  orange: "#D6914F",
  offwhite: "#F0F7F2",
  blau: "#123845",
  salbei: "#9BA494",
} as const;

/** Harter Schlagschatten OHNE Blur/Verlauf (starke Kante) – Bryans Pitch-/
 *  Grafikstil laut CI («harter Schlagschatten OHNE Verlauf»). Der 3. Shadow-Wert
 *  (Blur-Radius) ist bewusst 0, damit die Kante scharf statt weich bleibt. */
export const schlagschatten = "8px 8px 0 rgba(18,56,69,0.16)";

/** Weisser Schein nach innen (inner glow) – CI-Grafiksprache für Grafik-Objekte. */
export const innerGlow = "inset 0 0 16px rgba(255,255,255,0.85)";

/** Wiederverwendbares Karten-Style-Objekt: helle Karte auf hellem Grund
 *  (CI-Layoutsprache) mit innerem Schein + hartem Schlagschatten. */
export const karte = {
  background: "#ffffff",
  borderRadius: 16,
  border: `1px solid ${THEME.salbei}`,
  boxShadow: `${innerGlow}, ${schlagschatten}`,
} as const;

/** Orange Pill-Button (CI: «Buttons als orange Pills»). */
export const pill = {
  background: THEME.orange,
  color: "#ffffff",
  border: "none",
  borderRadius: 999,
  padding: "8px 16px",
  cursor: "pointer",
} as const;

/** Dünner Versal-Titel (Geo-Sans-Light-Look, versal mit Sperrung – CI). */
export const titel = {
  fontWeight: 300,
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  color: THEME.gruen,
} as const;
