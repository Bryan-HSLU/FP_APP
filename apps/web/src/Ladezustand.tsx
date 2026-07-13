/** Ladezustands-Baukasten (UI-Redesign Etappe A, Ladebildschirm-Update 2026-07-13).
 *
 *  Einheitliche Warteanzeige – dieselbe Optik wie der Start-Splash
 *  (`StartMenue.tsx`): das FP-Logo-Signet sanft pulsierend, darunter Titelzeile
 *  + Untertext + ein dezenter Fortschrittsbalken, alles auf einer Off-White-
 *  Fläche (--fp-soft). Bryan-Wunsch (2026-07-13): «wie beim Öffnen der App».
 *  Der Balken ist per Default UNBESTIMMT (animiert) – die meisten Wartepunkte
 *  sind KI-Calls ohne bekannten Fortschritt; ist er ausnahmsweise bekannt,
 *  liefert die aufrufende Stelle `fortschritt` (0–100) für einen bestimmten
 *  Balken. Vier vordefinierte Varianten decken die App-Wartepunkte ab
 *  (Stilprofil, Vorschlag/Kurator, Scan, Dokumente) – siehe Verwendungsstellen
 *  in den Schritt-Ansichten.
 */
import { useState } from "react";
import { CSS, titel as titelStil } from "./theme";
import { Piktogramm, type PiktogrammName } from "./Piktogramm";

export type LadeVariante = "stil" | "vorschlag" | "scan" | "dokumente";

interface Preset {
  piktogramm: PiktogrammName;
  titel: string;
  text: string;
}

/** Presets = die vier wiederkehrenden Wartepunkte der App. */
const PRESETS: Record<LadeVariante, Preset> = {
  stil: {
    piktogramm: "stilprofil",
    titel: "Stil wird ausgewertet",
    text: "Wir analysieren deine Vorlieben.",
  },
  vorschlag: {
    piktogramm: "vorschlag",
    titel: "Vorschlag wird erstellt",
    text: "Wir erstellen eine passende Raumvariante.",
  },
  scan: {
    piktogramm: "scan",
    titel: "Scan wird verarbeitet",
    text: "Wir erfassen Wände, Türen und Fenster.",
  },
  dokumente: {
    piktogramm: "dokument",
    titel: "Unterlagen werden vorbereitet",
    text: "Kosten, Mengen und Unterlagen werden vorbereitet.",
  },
};

export interface LadezustandProps {
  /** Vordefinierte Variante ODER frei über piktogramm/titel/text. */
  variante?: LadeVariante;
  piktogramm?: PiktogrammName;
  titel?: string;
  text?: string;
  /** Bekannter Fortschritt 0–100 → bestimmter Balken. Ohne Angabe (der
   *  Regelfall): unbestimmter, animierter Balken – die meisten Wartepunkte
   *  (KI-Calls) kennen keinen echten Fortschritt. */
  fortschritt?: number;
}

export function Ladezustand({ variante, piktogramm, titel, text, fortschritt }: LadezustandProps) {
  const preset = variante ? PRESETS[variante] : undefined;
  const iconName = piktogramm ?? preset?.piktogramm ?? "hilfe";
  const kopf = titel ?? preset?.titel ?? "Bitte warten";
  const unter = text ?? preset?.text ?? "";
  // Drop-in wie beim Logo im Startmenü: fehlt die echte PNG, dauerhaft auf das
  // Puls-Piktogramm zurückfallen (kein kaputtes <img>).
  const [logoFehlt, setLogoFehlt] = useState(false);
  const bestimmt = typeof fortschritt === "number";
  const anteil = bestimmt ? Math.max(0, Math.min(100, fortschritt as number)) : null;

  return (
    <div
      className={CSS.soft}
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
        padding: "32px 20px",
        textAlign: "center",
      }}
    >
      {logoFehlt ? (
        <Piktogramm name={iconName} groesse={76} className={CSS.piktogrammPuls} titel={kopf} />
      ) : (
        <img
          src="/FP-Logo-Signet.png"
          alt="Future Planning"
          onError={() => setLogoFehlt(true)}
          className={CSS.piktogrammPuls}
          style={{ width: 76, height: 76, objectFit: "contain" }}
        />
      )}
      <div style={{ ...titelStil, fontSize: 16, letterSpacing: "0.06em" }}>{kopf}</div>
      {unter && <div style={{ fontSize: 13, color: "var(--fp-muted)" }}>{unter}</div>}
      <div className={CSS.fortschrittsbalken} aria-hidden="true">
        <div
          className={`${CSS.fortschrittsbalkenFuellung} ${bestimmt ? "" : CSS.fortschrittsbalkenUnbestimmt}`}
          style={bestimmt ? { width: `${anteil}%` } : undefined}
        />
      </div>
    </div>
  );
}
