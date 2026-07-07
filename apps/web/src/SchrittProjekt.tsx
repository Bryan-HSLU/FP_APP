/** Schritt 1 «Projekt» (UI-Redesign Etappe B, Bryan-Konzept).
 *
 *  Zwei Entscheidungen in einer Ansicht: (1) WAS planen (Raumtyp-Vorwahl über
 *  drei grosse Karten) und (2) WIE starten (Beispiel · Scan · manuell). Die
 *  Vorwahl steuert den Scan-Raumtyp und filtert die Beispielräume. Die
 *  bestehenden Funktionen (Sample wählen, Scan laden, RaumEditor, Korrektur)
 *  bleiben unverändert – hier nur neu präsentiert.
 */
import { useState } from "react";
import type { Room } from "./api";
import { Ladezustand } from "./Ladezustand";
import { Piktogramm, type PiktogrammName } from "./Piktogramm";
import { CSS, FP_VAR, THEME, titel } from "./theme";

export type RaumtypKey = "bad" | "wohnen" | "kueche";

const RAUMTYPEN: { key: RaumtypKey; label: string; satz: string }[] = [
  { key: "bad", label: "Bad", satz: "Nasszelle mit WC, Waschtisch, Dusche oder Wanne." },
  { key: "wohnen", label: "Wohnen", satz: "Wohnzimmer mit frei platzierbaren Möbeln." },
  { key: "kueche", label: "Küche", satz: "Küchenzeile als Form – I, L, U oder Insel." },
];

type Weg = "beispiel" | "scan" | "manuell" | null;

export interface SchrittProjektProps {
  rooms: Room[];
  room: Room | null;
  vorwahl: RaumtypKey | null;
  onVorwahl: (typ: RaumtypKey) => void;
  onRaumWaehlen: (r: Room) => void;
  onScanDatei: (f: File) => void;
  onEditorOeffnen: () => void;
  onKorrigieren: () => void;
  korrigierbar: boolean;
  ladenScan: boolean;
}

/** Passt der Raum zur Raumtyp-Vorwahl? Grossraum zählt als Küche, wenn er eine
 *  Küchen-Zone trägt (gleiche Logik wie der Solver-Klickpfad). */
function raumPasst(r: Room, typ: RaumtypKey | null): boolean {
  if (!typ) return true;
  if (r.roomType === typ) return true;
  if (typ === "kueche") {
    const zonen = (r as Room & { zones?: { roomType: string }[] }).zones ?? [];
    return zonen.some((z) => z.roomType === "kueche");
  }
  return false;
}

export function SchrittProjekt({
  rooms,
  room,
  vorwahl,
  onVorwahl,
  onRaumWaehlen,
  onScanDatei,
  onEditorOeffnen,
  onKorrigieren,
  korrigierbar,
  ladenScan,
}: SchrittProjektProps) {
  const [weg, setWeg] = useState<Weg>(null);
  const sichtbareRooms = rooms.filter((r) => raumPasst(r, vorwahl));

  if (ladenScan) {
    return (
      <div style={{ maxWidth: 760, margin: "0 auto", padding: 20 }}>
        <Ladezustand variante="scan" />
      </div>
    );
  }

  return (
    <div className={CSS.schrittNeu} style={{ maxWidth: 900, margin: "0 auto", padding: 20 }}>
      <h2 style={{ ...titel, marginTop: 0, fontSize: 26 }}>Was möchtest du planen?</h2>

      {/* ---------- Raumtyp-Vorwahl: drei grosse Karten ---------- */}
      <div className={CSS.dreiKarten} style={{ marginBottom: 28 }}>
        {RAUMTYPEN.map((rt) => {
          const aktiv = vorwahl === rt.key;
          return (
            <button
              key={rt.key}
              type="button"
              onClick={() => onVorwahl(rt.key)}
              className={`${CSS.card} ${CSS.auswahl} ${CSS.button} ${aktiv ? CSS.cardAktiv : ""}`}
              style={{
                cursor: "pointer",
                textAlign: "center",
                padding: "22px 16px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
              }}
              aria-pressed={aktiv}
            >
              <Piktogramm
                name={rt.key as PiktogrammName}
                aktiv={aktiv}
                groesse={64}
                titel={rt.label}
              />
              <span style={{ ...titel, fontSize: 19 }}>{rt.label}</span>
              <span style={{ fontSize: 13, color: FP_VAR.primary, lineHeight: 1.4 }}>
                {rt.satz}
              </span>
            </button>
          );
        })}
      </div>

      {/* ---------- Startweg wählen ---------- */}
      <h3 style={{ ...titel, fontSize: 18 }}>Wie möchtest du starten?</h3>
      <div className={CSS.dreiKarten}>
        <WegKarte
          pikto="projekt"
          titel="Beispielprojekt"
          text="Fertig vermessenen Musterraum verwenden."
          aktiv={weg === "beispiel"}
          onClick={() => setWeg((w) => (w === "beispiel" ? null : "beispiel"))}
        />
        <label style={{ display: "block", cursor: "pointer" }}>
          <WegKarte
            pikto="scan"
            titel="Raum scannen"
            text="Scan-Bundle (layout.txt / .zip) laden."
            aktiv={false}
            alsDiv
          />
          <input
            type="file"
            accept=".zip,.txt"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onScanDatei(f);
              e.target.value = "";
            }}
          />
        </label>
        <WegKarte
          pikto="manuell"
          titel="Raum manuell erstellen"
          text="Grundriss selbst zeichnen."
          aktiv={false}
          onClick={onEditorOeffnen}
        />
      </div>

      {korrigierbar && (
        <button
          type="button"
          className={CSS.button}
          onClick={onKorrigieren}
          style={{
            marginTop: 16,
            background: FP_VAR.soft,
            border: `1px solid ${THEME.salbei}`,
            borderRadius: 999,
            padding: "8px 16px",
            color: FP_VAR.primary,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Piktogramm name="scan" groesse={18} /> Scan korrigieren
        </button>
      )}

      {/* ---------- Beispielprojekt: Direktwahl ---------- */}
      {weg === "beispiel" && (
        <section className={`${CSS.schrittNeu} ${CSS.soft}`} style={{ marginTop: 20, padding: 16 }}>
          <h4 style={{ ...titel, marginTop: 0, fontSize: 15 }}>
            Beispielraum wählen{vorwahl ? ` · ${vorwahl}` : ""}
          </h4>
          <div style={{ display: "grid", gap: 10 }}>
            {sichtbareRooms.map((r) => {
              const gewaehlt = room?.id === r.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => onRaumWaehlen(r)}
                  className={`${CSS.cardFlach} ${CSS.auswahl} ${CSS.button} ${gewaehlt ? CSS.cardAktiv : ""}`}
                  style={{
                    textAlign: "left",
                    padding: 12,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <Piktogramm name={r.roomType as PiktogrammName} groesse={26} />
                  <strong style={{ color: THEME.gruen }}>{r.name}</strong>
                  <span style={{ fontSize: 12, color: THEME.salbei, marginLeft: "auto" }}>
                    {r.roomType}
                  </span>
                </button>
              );
            })}
            {sichtbareRooms.length === 0 && (
              <p style={{ fontSize: 13, color: THEME.salbei, margin: 0 }}>
                {rooms.length === 0
                  ? "Räume werden geladen…"
                  : "Für diese Vorwahl liegt kein Beispielraum vor – Vorwahl ändern oder scannen."}
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

/** Eine Startweg-Karte (Piktogramm + Titel + Zeile). `alsDiv` rendert ohne
 *  eigenen Button (für den Datei-Upload, der ein <label> umschliesst). */
function WegKarte({
  pikto,
  titel: kartenTitel,
  text,
  aktiv,
  onClick,
  alsDiv,
}: {
  pikto: PiktogrammName;
  titel: string;
  text: string;
  aktiv: boolean;
  onClick?: () => void;
  alsDiv?: boolean;
}) {
  const inhalt = (
    <>
      <Piktogramm name={pikto} aktiv={aktiv} groesse={40} titel={kartenTitel} />
      <span style={{ ...titel, fontSize: 15 }}>{kartenTitel}</span>
      <span style={{ fontSize: 12.5, color: FP_VAR.primary, lineHeight: 1.4 }}>{text}</span>
    </>
  );
  const stil = {
    cursor: "pointer",
    textAlign: "center" as const,
    padding: "18px 14px",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    gap: 8,
    width: "100%",
  };
  const klasse = `${CSS.card} ${CSS.auswahl} ${aktiv ? CSS.cardAktiv : ""}`;
  if (alsDiv) {
    return (
      <div className={klasse} style={stil}>
        {inhalt}
      </div>
    );
  }
  return (
    <button type="button" onClick={onClick} className={`${klasse} ${CSS.button}`} style={stil}>
      {inhalt}
    </button>
  );
}
