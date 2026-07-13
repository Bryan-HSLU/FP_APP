/** Corporate-Identity-Tokens (Future Planning) – v2 (UI-Redesign Etappe A).
 *
 *  Quelle/Vorgabe: Bryans UI-Konzept + Brain
 *  ../FP_Kopf/vault/40_Produktkonzepte/Corporate-Identity.md.
 *  Nicht frei erfinden – Werte-Änderungen zuerst im Brain festhalten (Bryan),
 *  dann hier nachziehen.
 *
 *  SINGLE SOURCE OF TRUTH ist ab v2 das globale Stylesheet `fp.css` (:root
 *  CSS-Variablen). Diese Datei spiegelt die Werte als JS-Tokens für die
 *  verbliebenen Inline-Styles und exportiert die Klassennamen als Konstanten,
 *  damit Komponenten die fp.css-Klassen typsicher referenzieren.
 *
 *  Rückwärtskompatibilität: die bisherigen Exporte (THEME, schlagschatten,
 *  innerGlow, karte, pill, titel) bleiben erhalten und zeigen intern auf die
 *  neuen Werte – bestehende Ansichten brechen dadurch nicht.
 */

/** Farbrollen als CSS-Variablennamen (fp.css `:root`). Für Inline-Styles:
 *  `background: FP_VAR.soft` → "var(--fp-soft)". */
export const FP_VAR = {
  primary: "var(--fp-primary)",
  primaryDark: "var(--fp-primary-dark)",
  accent: "var(--fp-accent)",
  muted: "var(--fp-muted)",
  soft: "var(--fp-soft)",
  background: "var(--fp-background)",
  text: "var(--fp-text)",
} as const;

/** Rohe Hex-Werte (wo eine CSS-Variable nicht geht, z. B. three.js-Material,
 *  Canvas). Deckungsgleich mit fp.css. */
export const THEME = {
  gruen: "#243D35", // --fp-primary  (Navigation, Titel, Text, Rahmen, Sekundär)
  orange: "#D6914F", // --fp-accent   (die EINE Hauptaktion, aktiv, Auswahl)
  offwhite: "#F0F7F2", // --fp-soft    (Felder/Infoboxen/Sekundärflächen)
  blau: "#123845", // --fp-primary-dark / --fp-text
  salbei: "#9BA494", // --fp-muted    (inaktiv, Tags, ruhige Flächen)
  weiss: "#FFFFFF", // --fp-background (App-Body reinweiss)
} as const;

/** Klassennamen aus fp.css – typsicher referenzierbar (kein Magic-String). */
export const CSS = {
  card: "fp-card",
  cardFlach: "fp-card-flach",
  cardAktiv: "fp-card-aktiv",
  soft: "fp-soft",
  button: "fp-button",
  auswahl: "fp-auswahl",
  titel: "fp-titel",
  schrittNeu: "fp-schritt-neu",
  piktogrammPuls: "fp-piktogramm-puls",
  twoColumn: "fp-two-column",
  dreiKarten: "fp-drei-karten",
  fortschritt: "fp-fortschritt",
  /** Farbige Objekte (CI-Farbe) tragen Schlagschatten + Innenschein (Bryan). */
  farbig: "fp-farbig",
  /** Ladebildschirm-Fortschrittsbalken (Ladezustand.tsx): Track, Füllung,
   *  Füllung unbestimmt (animiert). */
  fortschrittsbalken: "fp-fortschrittsbalken",
  fortschrittsbalkenFuellung: "fp-fortschrittsbalken-fuellung",
  fortschrittsbalkenUnbestimmt: "fp-fortschrittsbalken-unbestimmt",
} as const;

/** Harter Schlagschatten OHNE Blur (scharfe Kante) – Bryans Pitch-/Grafikstil.
 *  Der Blur-Radius (3. Wert) ist bewusst 0. Deckungsgleich mit --fp-card-shadow
 *  (nur der Schlagschatten-Anteil). */
export const schlagschatten = "7px 7px 0 rgba(36,61,53,0.18)";

/** Weisser Schein nach innen (inner glow) – CI-Grafiksprache. Kräftiger als
 *  v1 (Bryan, 2026-07-08: «Schein nach innen überall UND stärker»).
 *  Deckungsgleich mit --fp-inner-glow / dem Innenschein-Anteil von
 *  --fp-card-shadow. */
export const innerGlow =
  "inset 0 0 30px rgba(240,247,242,0.95), inset 0 0 8px rgba(255,255,255,0.7)";

/** Wiederverwendbares Karten-Style-Objekt für Inline-Styles (spiegelt
 *  `.fp-card`). Wo möglich stattdessen `className={CSS.card}` nutzen. */
export const karte = {
  background: "#ffffff",
  borderRadius: 12,
  border: "1px solid rgba(36,61,53,0.3)",
  boxShadow: `${schlagschatten}, ${innerGlow}`,
} as const;

/** Orange Pill-Button (CI: «Buttons als orange Pills»). Kombiniere mit
 *  `className={CSS.button}` für die Press-/Hover-Animation. */
export const pill = {
  background: THEME.orange,
  color: "#ffffff",
  border: "none",
  borderRadius: 999,
  padding: "8px 16px",
  cursor: "pointer",
} as const;

/** Dünner Versal-Titel (Display-Font, versal mit Sperrung – CI). */
export const titel = {
  fontFamily: "var(--fp-font-display)",
  fontWeight: 400,
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  color: THEME.gruen,
} as const;
