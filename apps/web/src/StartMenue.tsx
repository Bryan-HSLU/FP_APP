/** Start-Ladescreen + Startmenü (Bryan-Wunsch 2026-07-07, vor dem Wizard).
 *
 *  Ablauf: Splash (Logo-Signet, blendet nach ~1.7 s oder per Klick um) →
 *  Startmenü (Logo, Claim, EINE orange Hauptaktion «Projekt starten») →
 *  Wizard. Beides rein präsentational; der App-Zustand bleibt in App.tsx.
 */
import { useEffect, useState } from "react";
import { CSS, FP_VAR } from "./theme";

export function Splash({ onFertig }: { onFertig: () => void }) {
  useEffect(() => {
    const t = setTimeout(onFertig, 1700);
    return () => clearTimeout(t);
  }, [onFertig]);
  return (
    <div
      onClick={onFertig}
      style={{
        position: "fixed",
        inset: 0,
        background: FP_VAR.background,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        cursor: "pointer",
      }}
      title="Klicken zum Überspringen"
    >
      <img
        src="/FP-Logo-Signet.png"
        alt="Future Planning"
        className={CSS.schrittNeu}
        style={{ width: "min(180px, 40vw)" }}
      />
    </div>
  );
}

export function StartMenue({ onStart }: { onStart: () => void }) {
  const [logoFehlt, setLogoFehlt] = useState(false);
  return (
    <div
      className={CSS.schrittNeu}
      style={{
        minHeight: "100vh",
        background: FP_VAR.background,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        padding: 24,
        textAlign: "center",
      }}
    >
      {!logoFehlt && (
        <img
          src="/FP-Logo-horizontal.png"
          alt="Future Planning"
          onError={() => setLogoFehlt(true)}
          style={{ width: "min(340px, 78vw)" }}
        />
      )}
      <p
        className={CSS.titel}
        style={{ fontSize: "clamp(20px, 4vw, 30px)", margin: 0, color: FP_VAR.primary }}
      >
        MEET. MATCH. BUILD.
      </p>
      <p style={{ fontSize: 15, color: FP_VAR.muted, maxWidth: 460, margin: "0 0 8px" }}>
        Sieh deinen zukünftigen Raum, bevor er gebaut wird – vom Stil über die normgerechte Planung
        bis zu den Kosten.
      </p>
      <button
        type="button"
        className={`${CSS.button} ${CSS.farbig}`}
        onClick={onStart}
        style={{
          background: FP_VAR.accent,
          color: "#fff",
          border: "none",
          borderRadius: 999,
          padding: "14px 34px",
          fontSize: 17,
          cursor: "pointer",
        }}
      >
        Projekt starten
      </button>
    </div>
  );
}
