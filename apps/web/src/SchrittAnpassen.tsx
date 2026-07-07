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
import type { OberflaechenSpez, OberflaechenVarianten, OberflaechenWahl } from "./oberflaechen";
import { Piktogramm } from "./Piktogramm";
import { CSS, FP_VAR, THEME, titel } from "./theme";
import type { FlaechenWahl } from "./Viewer3D";

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
  /** Gewählte Oberfläche (Boden/Wand) im 3D – zeigt die Oberflächen-Karte. */
  flaeche?: FlaechenWahl | null;
  /** Angebotene Boden-/Wandvarianten des aktuellen Raumtyps. */
  oberflaechenVarianten?: OberflaechenVarianten | null;
  /** Aktuelle Variantenwahl (leer = stilabgeleitete Optik). */
  oberflaechenWahl?: OberflaechenWahl;
  /** Effektive (ggf. überschriebene) Oberflächen-Spez zur Anzeige. */
  aktuelleSpez?: OberflaechenSpez | null;
  onFlaecheVariante?: (art: FlaechenWahl, id: string) => void;
}

const MUSTER_LABEL: Record<string, string> = {
  uni: "Uni",
  fliesen: "Fliesen",
  parkett: "Parkett",
  stein: "Stein",
};

/** Elementkarte-Ersatz für eine gewählte Oberfläche (Boden/Wand). Zeigt das
 *  aktuelle Muster/Farbe und bietet die vordefinierten Varianten zur Auswahl –
 *  rein visuell, überschreibt lokal die stilabgeleitete Optik. */
function OberflaecheKarte({
  flaeche,
  varianten,
  wahl,
  spez,
  onVariante,
}: {
  flaeche: FlaechenWahl;
  varianten: OberflaechenVarianten;
  wahl: OberflaechenWahl | undefined;
  spez: OberflaechenSpez | null | undefined;
  onVariante: (art: FlaechenWahl, id: string) => void;
}) {
  const istBoden = flaeche === "boden";
  const liste = istBoden ? varianten.boden : varianten.wand;
  const aktuelleId = istBoden ? wahl?.boden : wahl?.wand;
  const aktSpez = istBoden ? spez?.boden : spez?.wand;
  const aktFarbe = aktSpez
    ? "grundfarbe" in aktSpez
      ? aktSpez.grundfarbe
      : aktSpez.farbe
    : THEME.salbei;
  const aktMuster = aktSpez ? (MUSTER_LABEL[aktSpez.muster] ?? aktSpez.muster) : "–";
  return (
    <div className={`${CSS.card} ${CSS.cardAktiv}`} style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <Piktogramm name="material" groesse={28} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 style={{ ...titel, margin: 0, fontSize: 16 }}>Oberfläche</h3>
          <span style={{ fontSize: 12, color: THEME.salbei }}>{istBoden ? "Boden" : "Wände"}</span>
        </div>
      </div>

      <div
        style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 12 }}
      >
        <span
          style={{
            width: 16,
            height: 16,
            borderRadius: 4,
            background: aktFarbe,
            border: `1px solid ${THEME.salbei}`,
          }}
        />
        <span style={{ color: THEME.salbei }}>Aktuell</span>
        <span style={{ marginLeft: "auto", color: THEME.gruen }}>{aktMuster}</span>
      </div>

      <p style={{ fontSize: 12.5, margin: "0 0 6px", color: THEME.gruen }}>
        Varianten ({liste.length}):
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {liste.map((v) => {
          const farbe = "grundfarbe" in v.spez ? v.spez.grundfarbe : v.spez.farbe;
          const aktiv = aktuelleId === v.id;
          return (
            <button
              key={v.id}
              type="button"
              className={CSS.card}
              onClick={() => onVariante(flaeche, v.id)}
              aria-pressed={aktiv}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "7px 10px",
                cursor: "pointer",
                textAlign: "left",
                background: aktiv ? THEME.offwhite : "#fff",
                border: `1px solid ${aktiv ? THEME.orange : THEME.salbei}`,
              }}
            >
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 4,
                  flexShrink: 0,
                  background: farbe,
                  border: `1px solid ${THEME.salbei}`,
                }}
              />
              <span style={{ fontSize: 12.5, color: THEME.gruen, minWidth: 0, flex: 1 }}>
                {v.label}
              </span>
              {aktiv && <span style={{ fontSize: 11, color: THEME.orange }}>aktiv</span>}
            </button>
          );
        })}
      </div>
      <p style={{ fontSize: 11.5, color: THEME.salbei, marginTop: 12, marginBottom: 0 }}>
        Rein visuell · bleibt beim Würfeln erhalten · Klick auf ein Möbel wechselt zurück.
      </p>
    </div>
  );
}

const STATUS_TEXT = {
  passt: { text: "passt", farbe: THEME.gruen, aktiv: false },
  knapp: { text: "knapp", farbe: FP_VAR.accent, aktiv: true },
  anpassen: { text: "anpassen", farbe: "#c0392b", aktiv: true },
} as const;

/** Prioritätsklassen-Erklärung (Tooltip auf dem Badge). */
const PRIO_TEXT: Record<string, string> = {
  P1: "P1 – Pflichtobjekt",
  P2: "P2 – wichtig",
  P3: "P3 – optional",
};

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
  flaeche,
  oberflaechenVarianten,
  oberflaechenWahl,
  aktuelleSpez,
  onFlaecheVariante,
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
      <aside key={flaeche ?? gewaehltesItem?.id ?? "leer"} style={{ minWidth: 0 }}>
        {flaeche && oberflaechenVarianten && onFlaecheVariante ? (
          <OberflaecheKarte
            flaeche={flaeche}
            varianten={oberflaechenVarianten}
            wahl={oberflaechenWahl}
            spez={aktuelleSpez}
            onVariante={onFlaecheVariante}
          />
        ) : gewaehltesItem ? (
          <div className={`${CSS.card} ${CSS.cardAktiv}`} style={{ padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <Piktogramm name="moebel" groesse={28} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <h3 style={{ ...titel, margin: 0, fontSize: 16 }}>{gewaehltesItem.name}</h3>
                <span style={{ fontSize: 12, color: THEME.salbei }}>
                  {gewaehltesItem.funktionsTyp}
                </span>
              </div>
              <span
                title={PRIO_TEXT[gewaehltesItem.priorityClass]}
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#fff",
                  background: THEME.gruen,
                  borderRadius: 999,
                  padding: "2px 9px",
                  whiteSpace: "nowrap",
                }}
              >
                {gewaehltesItem.priorityClass}
              </span>
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

            {/* Austausch-Alternativen aus der Produktdatenbank (kleine Karten) */}
            {alternativen.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <p style={{ fontSize: 12.5, margin: "0 0 6px", color: THEME.gruen }}>
                  Aus der Produktdatenbank ({alternativen.length}):
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {alternativen.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className={CSS.card}
                      onClick={() => onTausch(a.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "7px 10px",
                        cursor: "pointer",
                        textAlign: "left",
                        background: "#fff",
                        border: `1px solid ${THEME.salbei}`,
                      }}
                    >
                      <span
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: 4,
                          flexShrink: 0,
                          background: materialFarbe(a.funktionsTyp),
                          border: `1px solid ${THEME.salbei}`,
                        }}
                      />
                      <span style={{ fontSize: 12.5, color: THEME.gruen, minWidth: 0, flex: 1 }}>
                        {a.name}
                      </span>
                      <span style={{ fontSize: 11, color: THEME.salbei, whiteSpace: "nowrap" }}>
                        {a.masse.w} × {a.masse.d} m
                      </span>
                    </button>
                  ))}
                </div>
              </div>
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
