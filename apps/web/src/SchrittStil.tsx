/** Schritt 2 «Stil» (UI-Redesign Etappe B, Bryan-Konzept).
 *
 *  Bildzentriert statt Achsen-Formular: ein grosses Beispielbild, darunter
 *  Like / Dislike / Überspringen. Die Swipe-Logik (Index, Likes, Dislikes) ist
 *  dieselbe wie im bisherigen `StilSwipe`-Dialog – nur inline und gross statt im
 *  Overlay. Ist ein Stilprofil berechnet, erscheint rechts (bzw. darunter) die
 *  Profil-Karte mit Kurzworten, Smart-Spider, Top-Achsen und Palette.
 */
import { useEffect, useMemo, useState } from "react";
import type { Room } from "./api";
import { Ladezustand } from "./Ladezustand";
import { Piktogramm } from "./Piktogramm";
import { BildKachel, SmartSpider, type Achse, type BildItem, type Stilprofil } from "./Stil";
import { CSS, FP_VAR, THEME, titel } from "./theme";

export interface SchrittStilProps {
  room: Room | null;
  bilder: BildItem[];
  achsen: Achse[];
  stilprofil: Stilprofil | null;
  /** Bewertung abgeschlossen → App berechnet das Profil (api.styleProfile). */
  onProfil: (likes: string[], dislikes: string[], presetId: string | null) => void;
  onUeberspringen: () => void;
  ladenStil: boolean;
}

/** Die stärksten Achsen (grösster |Wert|) als Pol-Kurzworte, z. B. «Warm». */
function kurzworte(vektor: Record<string, number>, achsen: Achse[], anzahl: number): string[] {
  return [...achsen]
    .map((a) => ({ a, wert: vektor[a.id] ?? 0 }))
    .filter((x) => Math.abs(x.wert) > 0.05)
    .sort((x, y) => Math.abs(y.wert) - Math.abs(x.wert))
    .slice(0, anzahl)
    .map(({ a, wert }) => {
      const pol = wert >= 0 ? a.positivPol : a.negativPol;
      return pol.charAt(0).toUpperCase() + pol.slice(1);
    });
}

export function SchrittStil({
  room,
  bilder,
  achsen,
  stilprofil,
  onProfil,
  onUeberspringen,
  ladenStil,
}: SchrittStilProps) {
  const [index, setIndex] = useState(0);
  const [likes, setLikes] = useState<string[]>([]);
  const [dislikes, setDislikes] = useState<string[]>([]);

  // Bei Raum-/Bilderwechsel den Swipe zurücksetzen.
  useEffect(() => {
    setIndex(0);
    setLikes([]);
    setDislikes([]);
  }, [bilder]);

  const bild = bilder[index];
  const bewertete = likes.length + dislikes.length;
  const presets = bilder.filter((b) => b.istPreset);

  const bewerte = (gefaellt: boolean) => {
    if (!bild) return;
    const neueLikes = gefaellt ? [...likes, bild.id] : likes;
    const neueDislikes = gefaellt ? dislikes : [...dislikes, bild.id];
    setLikes(neueLikes);
    setDislikes(neueDislikes);
    if (index + 1 >= bilder.length) onProfil(neueLikes, neueDislikes, null);
    else setIndex(index + 1);
  };

  const worte = useMemo(
    () => (stilprofil ? kurzworte(stilprofil.styleVector, achsen, 3) : []),
    [stilprofil, achsen],
  );
  const topAchsen = useMemo(() => {
    if (!stilprofil) return [];
    return [...achsen]
      .map((a) => ({ a, wert: stilprofil.styleVector[a.id] ?? 0 }))
      .sort((x, y) => Math.abs(y.wert) - Math.abs(x.wert))
      .slice(0, 3);
  }, [stilprofil, achsen]);

  const alleBewertet = bilder.length > 0 && index >= bilder.length;

  return (
    <div className={CSS.schrittNeu} style={{ maxWidth: 1000, margin: "0 auto", padding: 20 }}>
      <h2 style={{ ...titel, marginTop: 0, fontSize: 26 }}>Welcher Stil gefällt dir?</h2>

      <div className={stilprofil ? CSS.twoColumn : undefined}>
        {/* ---------- Swipe-Karte ---------- */}
        <div className={CSS.card} style={{ padding: 16 }}>
          {ladenStil ? (
            <Ladezustand variante="stil" />
          ) : !room || bilder.length === 0 ? (
            <p style={{ fontSize: 14, color: THEME.salbei, textAlign: "center", padding: 20 }}>
              {room
                ? "Für diesen Raumtyp liegen keine Beispielbilder vor – du kannst überspringen."
                : "Zuerst im Schritt «Projekt» einen Raum wählen."}
            </p>
          ) : alleBewertet || !bild ? (
            <p style={{ fontSize: 14, color: THEME.gruen, textAlign: "center", padding: 20 }}>
              Alle Bilder bewertet – dein Stilprofil steht rechts.
            </p>
          ) : (
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 10,
                  flexWrap: "wrap",
                }}
              >
                <span
                  className={CSS.soft}
                  style={{ fontSize: 12, padding: "3px 10px", color: THEME.gruen }}
                >
                  {room.roomType}
                </span>
                <span style={{ fontSize: 12, color: THEME.salbei, marginLeft: "auto" }}>
                  {bewertete} von {bilder.length} bewertet
                </span>
              </div>

              <BildKachel bild={bild} key={bild.id} />

              {bewertete > 0 && bewertete % 5 === 0 && (
                <p
                  key={bewertete}
                  className={CSS.schrittNeu}
                  style={{
                    fontSize: 12.5,
                    color: FP_VAR.accent,
                    textAlign: "center",
                    margin: "10px 0 0",
                  }}
                >
                  Dein Stilprofil wird genauer.
                </p>
              )}

              <div
                style={{
                  display: "flex",
                  gap: 12,
                  justifyContent: "center",
                  alignItems: "center",
                  margin: "16px 0 6px",
                }}
              >
                <button
                  type="button"
                  className={CSS.button}
                  onClick={() => bewerte(false)}
                  style={{
                    background: FP_VAR.soft,
                    border: `1px solid ${THEME.salbei}`,
                    borderRadius: 999,
                    padding: "12px 22px",
                    color: FP_VAR.primary,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 16,
                  }}
                >
                  <Piktogramm name="dislike" groesse={24} /> Gefällt nicht
                </button>
                <button
                  type="button"
                  className={CSS.button}
                  onClick={() => bewerte(true)}
                  style={{
                    background: THEME.gruen,
                    border: "none",
                    borderRadius: 999,
                    padding: "12px 26px",
                    color: "#fff",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 16,
                  }}
                >
                  <Piktogramm
                    name="like"
                    groesse={24}
                    style={{ filter: "brightness(0) invert(1)" }}
                  />{" "}
                  Gefällt mir
                </button>
              </div>

              <div style={{ textAlign: "center" }}>
                <button
                  type="button"
                  className={CSS.button}
                  onClick={onUeberspringen}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: THEME.salbei,
                    cursor: "pointer",
                    fontSize: 13,
                    textDecoration: "underline",
                  }}
                >
                  Überspringen
                </button>
              </div>

              {presets.length > 0 && index === 0 && (
                <p
                  style={{
                    fontSize: 12,
                    textAlign: "center",
                    color: THEME.salbei,
                    marginBottom: 0,
                  }}
                >
                  Abkürzung – Vorlage wählen:{" "}
                  {presets.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={CSS.button}
                      onClick={() => onProfil([], [], p.id)}
                      style={{
                        background: FP_VAR.soft,
                        border: `1px solid ${THEME.salbei}`,
                        borderRadius: 999,
                        padding: "3px 10px",
                        margin: 2,
                        color: THEME.gruen,
                        cursor: "pointer",
                        fontSize: 12,
                      }}
                    >
                      {p.bildRef.split("-").slice(2).join(" ").replace(".svg", "")}
                    </button>
                  ))}
                </p>
              )}
            </>
          )}
        </div>

        {/* ---------- Stilprofil-Karte ---------- */}
        {stilprofil && (
          <div className={CSS.card} style={{ padding: 16 }}>
            <h3 style={{ ...titel, marginTop: 0, fontSize: 18 }}>Dein Stilprofil</h3>
            {worte.length > 0 && (
              <p style={{ ...titel, fontSize: 20, color: FP_VAR.accent, margin: "4px 0 12px" }}>
                {worte.join(" · ")}
              </p>
            )}
            <div style={{ display: "flex", justifyContent: "center" }}>
              <SmartSpider vektor={stilprofil.styleVector} achsen={achsen} />
            </div>

            <div style={{ marginTop: 8 }}>
              {topAchsen.map(({ a, wert }) => {
                const pol = wert >= 0 ? a.positivPol : a.negativPol;
                const pct = Math.round(Math.abs(wert) * 100);
                return (
                  <div key={a.id} style={{ marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                      <span style={{ color: THEME.gruen, textTransform: "capitalize" }}>{pol}</span>
                      <span style={{ color: THEME.salbei }}>{pct}%</span>
                    </div>
                    <div style={{ height: 6, background: FP_VAR.soft, borderRadius: 3 }}>
                      <div
                        style={{
                          width: `${pct}%`,
                          height: 6,
                          background: THEME.gruen,
                          borderRadius: 3,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {stilprofil.palette.length > 0 && (
              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                {stilprofil.palette.map((f) => (
                  <span
                    key={f}
                    title={f}
                    style={{
                      width: 26,
                      height: 26,
                      background: f,
                      borderRadius: 6,
                      border: `1px solid ${THEME.salbei}`,
                    }}
                  />
                ))}
              </div>
            )}

            {!stilprofil.meta.sampleSufficient && (
              <p style={{ fontSize: 12, color: FP_VAR.accent, marginBottom: 0 }}>
                Wenige Bewertungen – Profil noch unsicher.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
