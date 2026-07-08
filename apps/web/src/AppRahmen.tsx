/** App-Rahmen (UI-Redesign Etappe A).
 *
 *  Legt das gemeinsame Gerüst um den jeweiligen Schritt-Inhalt:
 *  - Header: Logo links · Projektname (oder Claim) mittig · Menü-Platzhalter rechts.
 *  - darunter der Fortschrittsweg.
 *  - optionale Hinweiszeile.
 *  - Inhalt zentriert (max-width 1400px) – die Schritt-Ansichten (Etappe B)
 *    füllen `children`.
 *  - Footer-Leiste: «Zurück» links · «Weiter» rechts (orange Hauptaktion).
 *
 *  Der Rahmen ist der einzige Ort, an dem Header/Weg/Footer definiert sind –
 *  die Ansichten konsumieren ihn nur.
 */
import type { ReactNode } from "react";
import { Fortschrittsweg } from "./Fortschrittsweg";
import { Piktogramm } from "./Piktogramm";
import { CSS, FP_VAR, pill, titel as titelStil } from "./theme";

export interface AppRahmenProps {
  /** Projektname in der Kopfmitte; ohne = Claim. */
  projektName?: string;
  aktuellerSchritt: number;
  maxErreichterSchritt: number;
  onSchrittWechsel: (nr: number) => void;
  /** Optionale globale Hinweiszeile (unter dem Weg). */
  hinweis?: string;
  onZurueck: () => void;
  onWeiter: () => void;
  zurueckDeaktiviert?: boolean;
  weiterDeaktiviert?: boolean;
  /** Label des Weiter-Buttons (Default «Weiter»). */
  weiterLabel?: string;
  /** Label des Zurück-Buttons (Default «← Zurück»). */
  zurueckLabel?: string;
  /** Menü rechts im Header (Default = Platzhalter-Button). */
  menu?: ReactNode;
  children: ReactNode;
}

export function AppRahmen({
  projektName,
  aktuellerSchritt,
  maxErreichterSchritt,
  onSchrittWechsel,
  hinweis,
  onZurueck,
  onWeiter,
  zurueckDeaktiviert,
  weiterDeaktiviert,
  weiterLabel = "Weiter",
  zurueckLabel = "← Zurück",
  menu,
  children,
}: AppRahmenProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        background: FP_VAR.background,
        fontFamily: "var(--fp-font-body)",
        color: FP_VAR.text,
      }}
    >
      {/* ---------- Header ---------- */}
      <header
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          gap: 12,
          padding: "10px 16px",
          background: "#fff",
          borderBottom: "1px solid var(--fp-muted)",
        }}
      >
        <img
          src="/FP-Logo-horizontal.png"
          alt="Future Planning"
          style={{ height: 40, justifySelf: "start" }}
        />
        <div
          style={{
            ...titelStil,
            fontSize: 15,
            justifySelf: "center",
            textAlign: "center",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: "40vw",
          }}
        >
          {projektName || "Meet. Match. Build."}
        </div>
        <div style={{ justifySelf: "end" }}>
          {menu ?? (
            // Menü-Platzhalter: noch ohne Funktion (Etappe B / später).
            <button
              type="button"
              className={CSS.button}
              aria-label="Menü (folgt)"
              disabled
              style={{
                background: "transparent",
                border: "none",
                padding: 6,
                display: "inline-flex",
                cursor: "not-allowed",
              }}
            >
              <Piktogramm name="hilfe" groesse={28} titel="Menü" />
            </button>
          )}
        </div>
      </header>

      {/* ---------- Fortschrittsweg ---------- */}
      <div style={{ borderBottom: "1px solid var(--fp-muted)", background: "#fff" }}>
        <Fortschrittsweg
          aktuellerSchritt={aktuellerSchritt}
          maxErreichterSchritt={maxErreichterSchritt}
          onWechsel={onSchrittWechsel}
        />
      </div>

      {/* ---------- optionale Hinweiszeile ---------- */}
      {hinweis && (
        <div style={{ padding: "6px 16px", color: FP_VAR.accent, fontSize: 13 }}>{hinweis}</div>
      )}

      {/* ---------- Inhalt (zentriert, max 1400px) ---------- */}
      <main
        style={{
          flex: 1,
          minHeight: 0,
          width: "100%",
          maxWidth: 1400,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {children}
      </main>

      {/* ---------- Footer: Zurück / Weiter ---------- */}
      <nav
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          padding: "10px 16px",
          borderTop: "1px solid var(--fp-muted)",
          background: "#fff",
        }}
      >
        <button
          type="button"
          className={CSS.button}
          disabled={zurueckDeaktiviert}
          onClick={onZurueck}
          style={{
            ...pill,
            background: "transparent",
            color: FP_VAR.primary,
            border: "1px solid var(--fp-primary)",
          }}
        >
          {zurueckLabel}
        </button>
        <button
          type="button"
          className={CSS.button}
          disabled={weiterDeaktiviert}
          onClick={onWeiter}
          style={pill}
        >
          {weiterLabel} →
        </button>
      </nav>
    </div>
  );
}
