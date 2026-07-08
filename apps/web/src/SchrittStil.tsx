/** Schritt 2 «Stil» (UI-Redesign Etappe B, Bryan-Konzept · v2).
 *
 *  Bildzentriert statt Achsen-Formular: ein grosses Beispielbild, darunter
 *  Like / Dislike / Überspringen. Die Stil-Analyse steht v2 **immer** daneben
 *  (rechts auf breit, darunter auf schmal) und aktualisiert sich **live pro
 *  Swipe** – nach jeder Bewertung berechnet die App das Profil neu
 *  (`onZwischenProfil`, kein Schrittwechsel). Sobald das Profil stabil ist
 *  (siehe `stilkonvergenz`), stoppt das Bewerten und bietet «Weiter mit diesem
 *  Profil» an – man muss nicht alle Bilder durchklicken.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Room } from "./api";
import { Ladezustand } from "./Ladezustand";
import { Piktogramm } from "./Piktogramm";
import { BildKachel, SmartSpider, type Achse, type BildItem, type Stilprofil } from "./Stil";
import { istStabil, type StilVektor } from "./stilkonvergenz";
import { CSS, FP_VAR, THEME, titel } from "./theme";

/** Höhe des Swipe-Bildes: passt ohne Scrollen in den Viewport (Bryan). */
const BILD_MAX_HOEHE = "min(46vh, 420px)";
/** Dauer der Swipe-Animation, danach kommt das nächste Bild (ms). */
const SWIPE_MS = 230;

export interface SchrittStilProps {
  room: Room | null;
  bilder: BildItem[];
  achsen: Achse[];
  stilprofil: Stilprofil | null;
  /** Bewertung abgeschlossen → App berechnet das Profil final und geht weiter. */
  onProfil: (likes: string[], dislikes: string[], presetId: string | null) => void;
  /** Live nach jeder Bewertung → App aktualisiert NUR das Profil (kein Schritt). */
  onZwischenProfil: (likes: string[], dislikes: string[]) => void;
  onUeberspringen: () => void;
  ladenStil: boolean;
}

/** Bewegungsreduktion respektieren (Barrierefreiheit) – Swipe ohne Animation. */
function reduzierteBewegung(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
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
  onZwischenProfil,
  onUeberspringen,
  ladenStil,
}: SchrittStilProps) {
  const [index, setIndex] = useState(0);
  const [likes, setLikes] = useState<string[]>([]);
  const [dislikes, setDislikes] = useState<string[]>([]);
  // Laufende Swipe-Animation (blockiert Doppelklicks bis das nächste Bild kommt).
  const [animation, setAnimation] = useState<null | "like" | "dislike">(null);
  // Verlauf der styleVector-Updates (ein Eintrag je zurückgekommenem Live-Profil).
  const [verlauf, setVerlauf] = useState<StilVektor[]>([]);
  // Nutzer will trotz Stabilität weiterverfeinern (einmalig, dann erneut prüfen).
  const [verfeinern, setVerfeinern] = useState(false);
  // Identität des zuletzt in den Verlauf aufgenommenen Profils (Doppelte meiden).
  const letztesProfil = useRef<Stilprofil | null>(null);

  // Bei Raum-/Bilderwechsel den Swipe komplett zurücksetzen.
  useEffect(() => {
    setIndex(0);
    setLikes([]);
    setDislikes([]);
    setAnimation(null);
    setVerlauf([]);
    setVerfeinern(false);
    letztesProfil.current = null;
  }, [bilder]);

  // Jedes neue Live-Profil in den Verlauf schreiben (für die Konvergenzprüfung).
  useEffect(() => {
    if (stilprofil && stilprofil !== letztesProfil.current) {
      letztesProfil.current = stilprofil;
      setVerlauf((v) => [...v, stilprofil.styleVector]);
    }
  }, [stilprofil]);

  const bild = bilder[index];
  const bewertete = likes.length + dislikes.length;
  const presets = bilder.filter((b) => b.istPreset);
  const stabil = useMemo(() => istStabil(verlauf), [verlauf]);

  const bewerte = (gefaellt: boolean) => {
    if (!bild || animation) return;
    const neueLikes = gefaellt ? [...likes, bild.id] : likes;
    const neueDislikes = gefaellt ? dislikes : [...dislikes, bild.id];
    setLikes(neueLikes);
    setDislikes(neueDislikes);
    // Ein «weiter verfeinern»-Klick gilt nur für diese eine Bewertung; danach
    // prüft die Stabilität erneut (Bryan).
    setVerfeinern(false);
    const letztesBild = index + 1 >= bilder.length;
    const weiter = () => {
      setAnimation(null);
      if (letztesBild) onProfil(neueLikes, neueDislikes, null);
      else setIndex(index + 1);
    };
    if (letztesBild) {
      // Beim letzten Bild rechnet onProfil final – kein separates Live-Update.
      if (reduzierteBewegung()) weiter();
      else {
        setAnimation(gefaellt ? "like" : "dislike");
        window.setTimeout(weiter, SWIPE_MS);
      }
      return;
    }
    // Live-Profil sofort anstossen (unabhängig von der Animation).
    onZwischenProfil(neueLikes, neueDislikes);
    if (reduzierteBewegung()) weiter();
    else {
      setAnimation(gefaellt ? "like" : "dislike");
      window.setTimeout(weiter, SWIPE_MS);
    }
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
  // Konvergenz-Stopp: genug Signal, kaum noch Bewegung, Nutzer verfeinert nicht.
  const zeigeStopp = stabil && !verfeinern && !alleBewertet && !!bild;

  return (
    <div className={CSS.schrittNeu} style={{ maxWidth: 1000, margin: "0 auto", padding: 20 }}>
      <h2 style={{ ...titel, marginTop: 0, fontSize: 26 }}>Welcher Stil gefällt dir?</h2>

      <div className={CSS.twoColumn}>
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
              Alle Bilder bewertet – dein Stilprofil steht daneben.
            </p>
          ) : zeigeStopp ? (
            /* ---------- Konvergenz-Stopp ---------- */
            <div style={{ textAlign: "center", padding: "16px 8px" }}>
              <Piktogramm name="like" groesse={56} />
              <p style={{ ...titel, fontSize: 18, margin: "12px 0 4px" }}>
                Dein Stilprofil ist stabil.
              </p>
              <p style={{ fontSize: 13, color: THEME.salbei, margin: "0 0 18px" }}>
                Weitere Bilder würden es kaum noch verändern – du kannst direkt weiter.
              </p>
              <button
                type="button"
                className={`${CSS.button} ${CSS.farbig}`}
                onClick={() => onProfil(likes, dislikes, null)}
                style={{
                  background: FP_VAR.accent,
                  border: "none",
                  borderRadius: 999,
                  padding: "13px 28px",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: 16,
                }}
              >
                Weiter mit diesem Profil
              </button>
              <div style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className={CSS.button}
                  onClick={() => setVerfeinern(true)}
                  style={{
                    background: "transparent",
                    border: `1px solid ${THEME.salbei}`,
                    borderRadius: 999,
                    padding: "9px 20px",
                    color: THEME.salbei,
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  Weiter verfeinern
                </button>
              </div>
            </div>
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

              <div
                className={
                  animation
                    ? animation === "like"
                      ? "fp-swipe-like"
                      : "fp-swipe-dislike"
                    : undefined
                }
              >
                <BildKachel bild={bild} key={bild.id} maxHoehe={BILD_MAX_HOEHE} />
              </div>

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
                  disabled={!!animation}
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
                  <Piktogramm name="dislike" groesse={32} /> Gefällt nicht
                </button>
                <button
                  type="button"
                  className={CSS.button}
                  onClick={() => bewerte(true)}
                  disabled={!!animation}
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
                    groesse={32}
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

        {/* ---------- Stil-Analyse (immer sichtbar, live pro Swipe) ---------- */}
        <div className={CSS.card} style={{ padding: 16 }}>
          <h3 style={{ ...titel, marginTop: 0, fontSize: 18 }}>Deine Stil-Analyse</h3>
          {!stilprofil ? (
            <p style={{ fontSize: 14, color: THEME.salbei, margin: "6px 0 0" }}>
              Bewerte Bilder, dein Profil entsteht live.
            </p>
          ) : (
            <>
              {worte.length > 0 && (
                <p
                  key={worte.join("·")}
                  className={CSS.schrittNeu}
                  style={{ ...titel, fontSize: 20, color: FP_VAR.accent, margin: "4px 0 12px" }}
                >
                  {worte.join(" · ")}
                </p>
              )}
              <div style={{ display: "flex", justifyContent: "center" }}>
                <SmartSpider vektor={stilprofil.styleVector} achsen={achsen} />
              </div>

              <div key={bewertete} className={CSS.schrittNeu} style={{ marginTop: 8 }}>
                {topAchsen.map(({ a, wert }) => {
                  const pol = wert >= 0 ? a.positivPol : a.negativPol;
                  const pct = Math.round(Math.abs(wert) * 100);
                  return (
                    <div key={a.id} style={{ marginBottom: 8 }}>
                      <div
                        style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}
                      >
                        <span style={{ color: THEME.gruen, textTransform: "capitalize" }}>
                          {pol}
                        </span>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
