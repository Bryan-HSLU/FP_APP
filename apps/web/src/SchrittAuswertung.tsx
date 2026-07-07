/** Schritt 5 «Auswertung» (UI-Redesign Etappe B, Bryan-Konzept).
 *
 *  Zuerst eine Zusammenfassungs-Karte «DEIN PROJEKT» mit grossen Zahlen
 *  (Kosten von–bis, Anzahl Gewerke, Planungsstatus), darunter ein Raster von
 *  Dokument-Karten mit je einem Download. Die Kostenschätzung wird beim Betreten
 *  automatisch geladen (bestehendes `auswerten` in App.tsx); die Downloads
 *  nutzen unverändert `api.dokument`.
 */
import type { Arbeitsdreieck, KV, Plan, Room } from "./api";
import { Ladezustand } from "./Ladezustand";
import { Piktogramm, type PiktogrammName } from "./Piktogramm";
import { CSS, FP_VAR, THEME, titel } from "./theme";

interface DokDef {
  pfad: string;
  datei: string;
  pikto: PiktogrammName;
  titel: string;
  zeile: string;
  primaer?: boolean;
}

const DOKUMENTE: DokDef[] = [
  {
    pfad: "kv-pdf",
    datei: "kostenschaetzung.pdf",
    pikto: "kosten",
    titel: "Kostenschätzung",
    zeile: "Grobkosten je Gewerk (KV).",
  },
  {
    pfad: "lv-pdf",
    datei: "leistungsverzeichnis.pdf",
    pikto: "dokument",
    titel: "Leistungsverzeichnis",
    zeile: "Positionen für die Ausschreibung.",
  },
  {
    pfad: "einkaufsliste-pdf",
    datei: "einkaufsliste.pdf",
    pikto: "dokument",
    titel: "Mengen & Einkauf",
    zeile: "Materialmengen als Liste.",
  },
  {
    pfad: "bauzeitenplan-pdf",
    datei: "bauzeitenplan.pdf",
    pikto: "zeitplan",
    titel: "Zeitplan",
    zeile: "Bauzeitenplan der Gewerke.",
  },
  {
    pfad: "gewerke-pdf",
    datei: "gewerke-uebersicht.pdf",
    pikto: "gewerke",
    titel: "Gewerke",
    zeile: "Übersicht beteiligter Gewerke.",
  },
  {
    pfad: "plan-pdf",
    datei: "grundriss.pdf",
    pikto: "dokument",
    titel: "Grundriss (PDF)",
    zeile: "Massstäblicher 2D-Plan.",
  },
  {
    pfad: "dxf",
    datei: "grundriss.dxf",
    pikto: "export",
    titel: "Grundriss (DXF)",
    zeile: "CAD-Austauschformat.",
  },
  {
    pfad: "gltf",
    datei: "szene.gltf",
    pikto: "export",
    titel: "3D-Modell (glTF)",
    zeile: "Szene für 3D-Programme.",
  },
  {
    pfad: "offertanfrage",
    datei: "offertanfrage.pdf",
    pikto: "teilen",
    titel: "Offertanfrage",
    zeile: "Komplettes Paket für Handwerker.",
    primaer: true,
  },
];

const DREIECK_SYMBOL: Record<Arbeitsdreieck["bewertung"], string> = {
  effizient: "✅",
  akzeptabel: "⚠️",
  beengt: "🔻",
  weitläufig: "🔺",
};

export interface SchrittAuswertungProps {
  room: Room | null;
  plan: Plan | null;
  kv: KV | null;
  dreieck: Arbeitsdreieck | null;
  normOk: boolean;
  ladenDokumente: boolean;
  onDokument: (pfad: string, datei: string) => void;
}

function Stat({ zahl, label }: { zahl: string; label: string }) {
  return (
    <div style={{ textAlign: "center", minWidth: 120 }}>
      <div style={{ ...titel, fontSize: 30, color: THEME.gruen, lineHeight: 1.1 }}>{zahl}</div>
      <div style={{ fontSize: 12.5, color: THEME.salbei, marginTop: 4 }}>{label}</div>
    </div>
  );
}

export function SchrittAuswertung({
  room,
  plan,
  kv,
  dreieck,
  normOk,
  ladenDokumente,
  onDokument,
}: SchrittAuswertungProps) {
  const gewerke = new Set((plan?.placements ?? []).map((p) => p.gewerk)).size;
  const kosten =
    kv != null
      ? `${kv.von_chf.toLocaleString("de-CH")}–${kv.bis_chf.toLocaleString("de-CH")}`
      : "…";

  return (
    <div className={CSS.schrittNeu} style={{ maxWidth: 1000, margin: "0 auto", padding: 20 }}>
      {/* ---------- Zusammenfassung ---------- */}
      <div className={CSS.card} style={{ padding: 20, marginBottom: 24 }}>
        <h2 style={{ ...titel, marginTop: 0, fontSize: 24 }}>Dein Projekt</h2>
        {ladenDokumente && !kv ? (
          <Ladezustand variante="dokumente" />
        ) : (
          <>
            <div
              style={{
                display: "flex",
                gap: 24,
                flexWrap: "wrap",
                justifyContent: "space-around",
                alignItems: "flex-start",
                marginTop: 8,
              }}
            >
              <Stat
                zahl={`CHF ${kosten}`}
                label={`Geschätzte Kosten${kv ? ` (±${kv.bandbreitePct}%)` : ""}`}
              />
              <Stat zahl={String(gewerke || "–")} label="Beteiligte Gewerke" />
              <Stat
                zahl={normOk ? "✓" : "⚠"}
                label={normOk ? "Normen eingehalten" : "Punkte prüfen"}
              />
            </div>
            <p
              style={{
                ...titel,
                fontSize: 15,
                color: FP_VAR.accent,
                textAlign: "center",
                marginTop: 18,
                marginBottom: 0,
              }}
            >
              Bereit für die Offertanfrage
            </p>

            {dreieck && (
              <p
                style={{
                  fontSize: 12.5,
                  color: THEME.salbei,
                  textAlign: "center",
                  marginTop: 10,
                  marginBottom: 0,
                }}
              >
                {DREIECK_SYMBOL[dreieck.bewertung]} Arbeitsdreieck {dreieck.bewertung} · Ergonomie{" "}
                {Math.round(dreieck.score * 100)}% · Summe {dreieck.summe_m.toLocaleString("de-CH")}{" "}
                m
              </p>
            )}
          </>
        )}
      </div>

      {/* ---------- Dokument-Karten ---------- */}
      <h3 style={{ ...titel, fontSize: 18 }}>Unterlagen</h3>
      <div className={CSS.dreiKarten}>
        {DOKUMENTE.map((d) => (
          <div
            key={d.pfad}
            className={`${CSS.card} ${d.primaer ? CSS.cardAktiv : ""}`}
            style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}
          >
            <Piktogramm name={d.pikto} aktiv={d.primaer} groesse={30} titel={d.titel} />
            <strong style={{ ...titel, fontSize: 14 }}>{d.titel}</strong>
            <span style={{ fontSize: 12.5, color: THEME.salbei, flex: 1 }}>{d.zeile}</span>
            <button
              type="button"
              className={CSS.button}
              disabled={!plan || !room}
              onClick={() => onDokument(d.pfad, d.datei)}
              style={{
                borderRadius: 999,
                padding: "8px 14px",
                cursor: "pointer",
                border: d.primaer ? "none" : `1px solid ${THEME.gruen}`,
                background: d.primaer ? FP_VAR.accent : "#fff",
                color: d.primaer ? "#fff" : THEME.gruen,
                display: "inline-flex",
                gap: 6,
                alignItems: "center",
                justifyContent: "center",
                fontSize: 13,
              }}
            >
              <Piktogramm
                name="export"
                groesse={15}
                style={d.primaer ? { filter: "brightness(0) invert(1)" } : undefined}
              />
              Herunterladen
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
