/** Schritt 4 «Anpassen» (UI-Redesign Etappe B, Bryan-Konzept).
 *
 *  Zwei Spalten: links der Viewer (2D/3D-Umschalter kommt aus App.tsx als
 *  `viewer`-Node), rechts die Elementkarte des gewählten Möbels mit Massen,
 *  Materialfarbe, Normstatus und den bestehenden Aktionen (Austauschen,
 *  Sperren). Ohne Auswahl eine Hilfe-Karte + globale Aktionen. Keyboard-
 *  Steuerung und Live-Ampel bleiben in App.tsx – hier nur Darstellung.
 */
import type { ReactNode } from "react";
import type { ConstraintReport } from "@fp/shared/rules";
import type { KatalogItem } from "./api";
import { materialFarbe } from "./moebel3d";
import { Piktogramm } from "./Piktogramm";
import { CSS, FP_VAR, THEME, titel } from "./theme";

export interface SchrittAnpassenProps {
  viewer: ReactNode;
  gewaehltesItem: KatalogItem | null;
  elementStatus?: "verletzt" | "knapp";
  gesperrt: boolean;
  alternativen: KatalogItem[];
  onTausch: (neueId: string) => void;
  onSperren: () => void;
  onWuerfeln: () => void;
  report: ConstraintReport | null;
  begruendung: string;
}

const STATUS_TEXT = {
  passt: { text: "passt", farbe: THEME.gruen, aktiv: false },
  knapp: { text: "knapp", farbe: FP_VAR.accent, aktiv: true },
  anpassen: { text: "anpassen", farbe: "#c0392b", aktiv: true },
} as const;

export function SchrittAnpassen({
  viewer,
  gewaehltesItem,
  elementStatus,
  gesperrt,
  alternativen,
  onTausch,
  onSperren,
  onWuerfeln,
  report,
  begruendung,
}: SchrittAnpassenProps) {
  const statusKey =
    elementStatus === "verletzt" ? "anpassen" : elementStatus === "knapp" ? "knapp" : "passt";
  const st = STATUS_TEXT[statusKey];

  return (
    <div
      className={`${CSS.twoColumn} ${CSS.schrittNeu}`}
      style={{ padding: 16, alignItems: "start" }}
    >
      {/* ---------- Viewer (feste Höhe kommt aus App) ---------- */}
      <div style={{ minWidth: 0 }}>{viewer}</div>

      {/* ---------- Panel rechts ---------- */}
      <aside key={gewaehltesItem?.id ?? "leer"} style={{ minWidth: 0 }}>
        {gewaehltesItem ? (
          <div className={`${CSS.card} ${CSS.cardAktiv}`} style={{ padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <Piktogramm name="moebel" groesse={28} />
              <h3 style={{ ...titel, margin: 0, fontSize: 16 }}>{gewaehltesItem.name}</h3>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                marginBottom: 6,
              }}
            >
              <span
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 4,
                  background: materialFarbe(gewaehltesItem.funktionsTyp),
                  border: `1px solid ${THEME.salbei}`,
                }}
              />
              <span style={{ color: THEME.salbei }}>Material</span>
              <span style={{ marginLeft: "auto", color: THEME.gruen }}>
                {gewaehltesItem.masse.w} × {gewaehltesItem.masse.d} × {gewaehltesItem.masse.h} m
              </span>
            </div>

            {/* Normstatus des Elements */}
            <div
              className={CSS.soft}
              style={{
                padding: "8px 10px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 12,
              }}
            >
              <Piktogramm name="norm" aktiv={st.aktiv} groesse={20} />
              <span style={{ color: st.farbe, fontWeight: 600 }}>{st.text}</span>
            </div>

            {/* Aktionen */}
            {alternativen.length > 0 && (
              <label
                style={{ display: "block", fontSize: 12.5, marginBottom: 10, color: THEME.gruen }}
              >
                Austauschen:{" "}
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) onTausch(e.target.value);
                    e.target.value = "";
                  }}
                  style={{ width: "100%", marginTop: 4, padding: 6 }}
                >
                  <option value="" disabled>
                    Alternative wählen… ({alternativen.length})
                  </option>
                  {alternativen.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              className={CSS.button}
              onClick={onSperren}
              style={{
                width: "100%",
                borderRadius: 999,
                padding: "9px 14px",
                cursor: "pointer",
                border: `1px solid ${THEME.gruen}`,
                background: gesperrt ? THEME.gruen : "#fff",
                color: gesperrt ? "#fff" : THEME.gruen,
                display: "inline-flex",
                gap: 8,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Piktogramm
                name={gesperrt ? "norm" : "material"}
                aktiv={false}
                groesse={16}
                style={gesperrt ? { filter: "brightness(0) invert(1)" } : undefined}
              />
              {gesperrt ? "Entsperren" : "Sperren"}
            </button>

            <p style={{ fontSize: 11.5, color: THEME.salbei, marginTop: 12, marginBottom: 0 }}>
              Verschieben: ziehen (2D) oder Pfeiltasten · «r» = drehen · Klick daneben = abwählen.
            </p>
          </div>
        ) : (
          <>
            <div className={CSS.soft} style={{ padding: 16, marginBottom: 12 }}>
              <h3 style={{ ...titel, marginTop: 0, fontSize: 15 }}>Anpassen</h3>
              <p style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>
                Tippe ein Möbel im Plan an, um es zu verschieben, zu drehen, auszutauschen oder zu
                sperren. Passt alles, geht es weiter zur Auswertung.
              </p>
            </div>

            <button
              type="button"
              className={CSS.button}
              onClick={onWuerfeln}
              style={{
                width: "100%",
                borderRadius: 999,
                padding: "10px 14px",
                cursor: "pointer",
                border: `1px solid ${THEME.gruen}`,
                background: "#fff",
                color: THEME.gruen,
                display: "inline-flex",
                gap: 8,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Piktogramm name="varianten" groesse={18} /> Andere Variante würfeln
            </button>

            {begruendung && (
              <div className={CSS.soft} style={{ padding: 12, marginTop: 12 }}>
                <p style={{ fontSize: 12.5, margin: 0, lineHeight: 1.5 }}>{begruendung}</p>
              </div>
            )}
          </>
        )}

        {/* Live-Ampel (kompakt) – immer sichtbar, Logik unverändert. */}
        {report && (
          <div className={CSS.soft} style={{ padding: 12, marginTop: 12 }}>
            <h4 style={{ ...titel, marginTop: 0, fontSize: 13 }}>
              Normprüfung {report.hard.ok ? "✓" : "⚠"}
            </h4>
            <p style={{ fontSize: 12, margin: "0 0 6px", color: THEME.salbei }}>
              {report.hard.summary.erfuellt} ok · {report.hard.summary.knapp} knapp ·{" "}
              {report.hard.summary.verletzt} verletzt
            </p>
            <ul style={{ listStyle: "none", padding: 0, fontSize: 12, margin: 0 }}>
              {report.results.map((r) => (
                <li key={r.ruleId} style={{ marginBottom: 2 }}>
                  {r.status === "ok"
                    ? "✅"
                    : r.status === "knapp"
                      ? "⚠️"
                      : r.status === "verletzt"
                        ? "❌"
                        : "➖"}{" "}
                  <code>{r.ruleId}</code>
                  {r.margin_cm !== null && ` · ${r.margin_cm} cm`}
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}
