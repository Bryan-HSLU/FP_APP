/** Ladezustands-Baukasten (UI-Redesign Etappe A).
 *
 *  Einheitliche Warteanzeige: sanft pulsierendes Piktogramm + Titelzeile +
 *  Untertext auf einer Off-White-Fläche (--fp-soft). Vier vordefinierte
 *  Varianten decken die App-Wartepunkte ab; Etappe B verdrahtet sie an die
 *  jeweiligen `await`-Stellen (Stilprofil, Solve, Scan, Dokumente).
 */
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
}

export function Ladezustand({ variante, piktogramm, titel, text }: LadezustandProps) {
  const preset = variante ? PRESETS[variante] : undefined;
  const iconName = piktogramm ?? preset?.piktogramm ?? "hilfe";
  const kopf = titel ?? preset?.titel ?? "Bitte warten";
  const unter = text ?? preset?.text ?? "";

  return (
    <div
      className={CSS.soft}
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
        padding: "28px 20px",
        textAlign: "center",
      }}
    >
      <Piktogramm name={iconName} groesse={48} className={CSS.piktogrammPuls} titel={kopf} />
      <div style={{ ...titelStil, fontSize: 16, letterSpacing: "0.06em" }}>{kopf}</div>
      {unter && <div style={{ fontSize: 13, color: "var(--fp-muted)" }}>{unter}</div>}
    </div>
  );
}
