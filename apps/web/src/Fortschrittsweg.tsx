/** Fortschrittsweg-Navigation (UI-Redesign Etappe A).
 *
 *  Kompakter Weg «1 Projekt ── 2 Stil ── 3 Vorschlag ── 4 Anpassen ──
 *  5 Ergebnis»: Kreis (Nummer bzw. ✓) + Label + Verbindungslinie.
 *  - aktiv      = orange
 *  - erledigt   = dunkelgrün + ✓ + klickbar
 *  - verfügbar  = dunkelgrün + Nummer + klickbar (schon erreicht)
 *  - gesperrt   = salbei, nicht klickbar
 *  Auf kleinen Screens horizontal scrollbar (.fp-fortschritt).
 *
 *  Die reine Zustandslogik (welcher Schritt klickbar/aktiv/…) lebt getestet in
 *  fortschritt.ts – diese Komponente ist nur die Darstellung.
 */
import { Fragment } from "react";
import { FORTSCHRITT_SCHRITTE, schrittZustand, type SchrittZustand } from "./fortschritt";
import { CSS } from "./theme";

export interface FortschrittswegProps {
  /** Aktueller Schritt (1-basiert). */
  aktuellerSchritt: number;
  /** Am weitesten freigeschalteter Schritt (1-basiert). */
  maxErreichterSchritt: number;
  /** Klick auf einen erreichbaren Schritt. */
  onWechsel: (nr: number) => void;
  /** Optionale Labels (Default = die fünf Wizard-Schritte). */
  schritte?: readonly string[];
}

const KREIS_FARBE: Record<SchrittZustand, string> = {
  aktiv: "var(--fp-accent)",
  erledigt: "var(--fp-primary)",
  verfuegbar: "var(--fp-primary)",
  gesperrt: "var(--fp-muted)",
};

export function Fortschrittsweg({
  aktuellerSchritt,
  maxErreichterSchritt,
  onWechsel,
  schritte = FORTSCHRITT_SCHRITTE,
}: FortschrittswegProps) {
  return (
    <nav
      aria-label="Fortschritt"
      className={CSS.fortschritt}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 0,
        padding: "10px 16px",
      }}
    >
      {schritte.map((label, i) => {
        const nr = i + 1;
        const { zustand, klickbar } = schrittZustand(nr, aktuellerSchritt, maxErreichterSchritt);
        // Linie vor dem Schritt: grün, sobald die Grenze überschritten wurde.
        const linieErreicht = nr <= aktuellerSchritt;
        return (
          <Fragment key={label}>
            {i > 0 && (
              <span
                aria-hidden
                style={{
                  flex: "1 0 20px",
                  height: 2,
                  minWidth: 20,
                  background: linieErreicht ? "var(--fp-primary)" : "var(--fp-muted)",
                  opacity: linieErreicht ? 1 : 0.4,
                }}
              />
            )}
            <button
              type="button"
              className={CSS.button}
              disabled={!klickbar}
              aria-current={zustand === "aktiv" ? "step" : undefined}
              onClick={() => klickbar && onWechsel(nr)}
              title={`${nr}. ${label}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flex: "0 0 auto",
                background: "transparent",
                border: "none",
                padding: "2px 4px",
                cursor: klickbar ? "pointer" : "default",
              }}
            >
              <span
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 999,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontWeight: 600,
                  fontSize: 18,
                  flex: "0 0 auto",
                  background: KREIS_FARBE[zustand],
                  boxShadow:
                    zustand === "aktiv"
                      ? "0 0 0 3px rgba(214,145,79,0.28)"
                      : "inset 0 0 8px rgba(255,255,255,0.35)",
                }}
              >
                {zustand === "erledigt" ? "✓" : nr}
              </span>
              <span
                style={{
                  fontSize: 13,
                  whiteSpace: "nowrap",
                  color: zustand === "aktiv" ? "var(--fp-accent)" : "var(--fp-primary)",
                  fontWeight: zustand === "aktiv" ? 700 : 400,
                  opacity: zustand === "gesperrt" ? 0.6 : 1,
                }}
              >
                {label}
              </span>
            </button>
          </Fragment>
        );
      })}
    </nav>
  );
}
