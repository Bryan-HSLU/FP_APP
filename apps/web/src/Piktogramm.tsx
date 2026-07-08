/** Piktogramm-System (UI-Redesign Etappe A).
 *
 *  Einheitlicher Icon-Baukasten: gerundete Linien, konstante Strichstärke
 *  (~1.8 bei 24er-ViewBox), wenig Details, `currentColor` (Standard
 *  --fp-primary, aktiv --fp-accent).
 *
 *  DROP-IN für Bryans echte Piktogramme: Die Komponente versucht ZUERST
 *  `<img src="/piktogramme/<name>.png">`. Schlägt das fehl (Datei fehlt),
 *  fällt sie dauerhaft (State) auf das Inline-SVG zurück. Sobald Bryan die
 *  PNGs nach `apps/web/public/piktogramme/` legt, ersetzen sie die
 *  Platzhalter OHNE Codeänderung. Siehe public/piktogramme/README.md.
 *
 *  Konvention: Wichtige Aktionen zeigen das Piktogramm IMMER mit Text-Label
 *  daneben (nie nur das Icon), damit die Bedeutung eindeutig bleibt.
 */
import { useState, type CSSProperties, type ReactElement } from "react";

export type PiktogrammName =
  | "projekt"
  | "bad"
  | "kueche"
  | "wohnen"
  | "kamera"
  | "scan"
  | "manuell"
  | "stil"
  | "like"
  | "dislike"
  | "stilprofil"
  | "vorschlag"
  | "varianten"
  | "moebel"
  | "material"
  | "farbe"
  | "norm"
  | "kosten"
  | "zeitplan"
  | "gewerke"
  | "dokument"
  | "export"
  | "teilen"
  | "speichern"
  | "hilfe";

/** Inline-SVG-Pfade je Piktogramm (Platzhalter, bis Bryans PNGs kommen).
 *  Bewusst schlicht: gerundete Linien, wenige Elemente. */
const PFADE: Record<PiktogrammName, ReactElement> = {
  projekt: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </>
  ),
  bad: (
    <>
      <path d="M4 13h16v2a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" />
      <path d="M7 13V6a2 2 0 0 1 4 0" />
      <line x1="6.5" y1="18" x2="6.5" y2="20" />
      <line x1="17.5" y1="18" x2="17.5" y2="20" />
    </>
  ),
  kueche: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <circle cx="9" cy="9" r="2.1" />
      <circle cx="15" cy="9" r="2.1" />
      <line x1="7" y1="15" x2="17" y2="15" />
    </>
  ),
  wohnen: (
    <>
      <path d="M5 12V9a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3" />
      <path d="M4 12a1.6 1.6 0 0 1 1.6 1.6V16h12.8v-2.4A1.6 1.6 0 0 1 20 12" />
      <line x1="5.6" y1="16" x2="5.6" y2="18.5" />
      <line x1="18.4" y1="16" x2="18.4" y2="18.5" />
    </>
  ),
  kamera: (
    <>
      <rect x="3" y="7" width="18" height="12" rx="2" />
      <circle cx="12" cy="13" r="3" />
      <path d="M8 7l1.2-2h5.6L16 7" />
    </>
  ),
  scan: (
    <>
      <path d="M4 8V6a2 2 0 0 1 2-2h2" />
      <path d="M16 4h2a2 2 0 0 1 2 2v2" />
      <path d="M20 16v2a2 2 0 0 1-2 2h-2" />
      <path d="M8 20H6a2 2 0 0 1-2-2v-2" />
      <line x1="4" y1="12" x2="20" y2="12" />
    </>
  ),
  manuell: (
    <>
      <path d="M4 20l1-4L16 5a2 2 0 0 1 3 3L8 19z" />
      <line x1="14" y1="7" x2="17" y2="10" />
    </>
  ),
  stil: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.9 1.8-1.9 0-.5-.2-.9-.5-1.2-.3-.4-.5-.8-.5-1.2 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-3.9-4-7-9-7z" />
      <circle cx="8" cy="10" r="1" />
      <circle cx="12" cy="8" r="1" />
      <circle cx="16" cy="10.5" r="1" />
    </>
  ),
  like: (
    <>
      <path d="M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z" />
      <path d="M7 11l4-8a2 2 0 0 1 2 2v4h5a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 18 20H7" />
    </>
  ),
  dislike: (
    <>
      <path d="M7 13V4H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1z" />
      <path d="M7 13l4 8a2 2 0 0 0 2-2v-4h5a2 2 0 0 0 2-2.3l-1.2-6A2 2 0 0 0 18 4H7" />
    </>
  ),
  stilprofil: (
    <>
      <polygon points="12,3 20,9 17,19 7,19 4,9" />
      <polygon points="12,7 16.4,10.3 15,15.8 9,15.8 7.6,10.3" />
      <line x1="12" y1="12" x2="12" y2="3" />
    </>
  ),
  vorschlag: (
    <>
      <path d="M12 3a6 6 0 0 0-4 10.5c.6.6 1 1.4 1 2.2V16h6v-.3c0-.8.4-1.6 1-2.2A6 6 0 0 0 12 3z" />
      <line x1="9.5" y1="19" x2="14.5" y2="19" />
      <line x1="10.5" y1="21.5" x2="13.5" y2="21.5" />
    </>
  ),
  varianten: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <circle cx="9" cy="9" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="15" cy="15" r="1" />
    </>
  ),
  moebel: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <line x1="12" y1="3" x2="12" y2="21" />
      <line x1="10" y1="11" x2="10" y2="13.5" />
      <line x1="14" y1="11" x2="14" y2="13.5" />
    </>
  ),
  material: (
    <>
      <path d="M12 3l9 5-9 5-9-5z" />
      <path d="M3 13l9 5 9-5" />
    </>
  ),
  farbe: (
    <>
      <path d="M12 3s6 6.5 6 10.5a6 6 0 0 1-12 0C6 9.5 12 3 12 3z" />
    </>
  ),
  norm: (
    <>
      <path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  kosten: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10" />
      <path d="M14.5 9.3A2.6 2.6 0 0 0 12 8c-1.6 0-2.6.9-2.6 2 0 2.7 5.2 1.5 5.2 4.2 0 1.1-1 2-2.6 2A2.6 2.6 0 0 1 9.5 14.7" />
    </>
  ),
  zeitplan: (
    <>
      <rect x="4" y="5" width="16" height="16" rx="2" />
      <line x1="4" y1="9" x2="20" y2="9" />
      <line x1="9" y1="3" x2="9" y2="6" />
      <line x1="15" y1="3" x2="15" y2="6" />
      <line x1="8" y1="13" x2="12" y2="13" />
    </>
  ),
  gewerke: (
    <>
      <path d="M4 18h16" />
      <path d="M5.5 18v-1.5a6.5 6.5 0 0 1 13 0V18" />
      <path d="M10 5.5v4" />
      <path d="M14 5.5v4" />
      <path d="M9 5.5h6" />
    </>
  ),
  dokument: (
    <>
      <path d="M14 3H6v18h12V7z" />
      <path d="M14 3v4h4" />
      <line x1="9" y1="12" x2="15" y2="12" />
      <line x1="9" y1="16" x2="15" y2="16" />
    </>
  ),
  export: (
    <>
      <path d="M12 3v10" />
      <path d="M8 7l4-4 4 4" />
      <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </>
  ),
  teilen: (
    <>
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="17" cy="6" r="2.5" />
      <circle cx="17" cy="18" r="2.5" />
      <line x1="8.2" y1="10.8" x2="14.8" y2="7.2" />
      <line x1="8.2" y1="13.2" x2="14.8" y2="16.8" />
    </>
  ),
  speichern: (
    <>
      <path d="M5 21V3h11l3 3v15z" />
      <path d="M8 3v5h7V3" />
      <rect x="8" y="13" width="8" height="5" />
    </>
  ),
  hilfe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.2a2.6 2.6 0 0 1 4.6 1.6c0 1.7-2.1 2-2.1 3.4" />
      <line x1="12" y1="17" x2="12" y2="17.2" />
    </>
  ),
};

export interface PiktogrammProps {
  name: PiktogrammName;
  /** aktiv = orange (--fp-accent) statt dunkelgrün (--fp-primary). */
  aktiv?: boolean;
  /** Kantenlänge in px (quadratisch). */
  groesse?: number;
  /** Zusätzliche Klassen (z. B. CSS.piktogrammPuls für den Ladezustand). */
  className?: string;
  style?: CSSProperties;
  /** Barrierefreiheit: Label; leer = dekorativ (aria-hidden). */
  titel?: string;
}

export function Piktogramm({
  name,
  aktiv = false,
  groesse = 28,
  className,
  style,
  titel,
}: PiktogrammProps) {
  // Sobald die echte PNG fehlt, dauerhaft auf das Inline-SVG zurückfallen.
  const [pngFehlt, setPngFehlt] = useState(false);
  const farbe = aktiv ? "var(--fp-accent)" : "var(--fp-primary)";
  const barriere = titel ? { role: "img", "aria-label": titel } : { "aria-hidden": true };

  if (!pngFehlt) {
    return (
      <img
        src={`/piktogramme/${name}.png`}
        onError={() => setPngFehlt(true)}
        width={groesse}
        height={groesse}
        alt={titel ?? ""}
        className={className}
        style={{ display: "block", objectFit: "contain", ...style }}
      />
    );
  }

  return (
    <svg
      width={groesse}
      height={groesse}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ color: farbe, display: "block", ...style }}
      {...barriere}
    >
      {PFADE[name]}
    </svg>
  );
}
