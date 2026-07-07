/** Schritt 3 «Vorschlag» (UI-Redesign Etappe B, Bryan-Konzept).
 *
 *  Zwei Zustände: (A) noch kein Plan → Auslöser «Vorschlag erstellen» (bei der
 *  Küche mit Normprofil + Formwahl); (B) Plan da → Ergebnis-Karte mit 2D-
 *  Vorschau, Stilbegründung, Hauptmaterialien, Variante/Seed und einfachem
 *  Normstatus, plus die eine orange Hauptaktion «Ansehen & anpassen». Der
 *  Solve-Aufruf selbst (`loesen`) liegt unverändert in App.tsx.
 */
import type { ConstraintReport } from "@fp/shared/rules";
import type { KatalogItem, KuechenForm, Plan, Room } from "./api";
import { Ladezustand } from "./Ladezustand";
import { materialFarbe } from "./moebel3d";
import { Piktogramm } from "./Piktogramm";
import { CSS, FP_VAR, pill, THEME, titel } from "./theme";
import { Viewer2D } from "./Viewer2D";

export interface SchrittVorschlagProps {
  room: Room | null;
  aktuellerRaum: Room | null;
  catalog: KatalogItem[];
  plan: Plan | null;
  report: ConstraintReport | null;
  statusById: Map<string, "verletzt" | "knapp">;
  stilprofil: { meta: { method: string } } | null;
  begruendung: string;
  seed: number;
  ladenVorschlag: boolean;
  // Küche
  istKueche: boolean;
  grossraum: boolean;
  normProfile: "ch" | "eu";
  onNormProfile: (np: "ch" | "eu") => void;
  formen: KuechenForm[] | null;
  form: string | null;
  onFormWaehlen: (f: string) => void;
  onFormenLaden: () => void;
  // Aktionen
  onVorschlagen: () => void;
  onNeueVariante: () => void;
  onAnpassen: () => void;
}

/** Einfacher Normstatus aus dem constraintReport: grün / knapp / verletzt. */
function normStatus(report: ConstraintReport | null): { text: string; farbe: string; ok: boolean } {
  if (!report) return { text: "Norm wird geprüft…", farbe: THEME.salbei, ok: false };
  const { knapp, verletzt } = report.hard.summary;
  if (verletzt > 0) return { text: `${verletzt} Punkte verletzt`, farbe: "#c0392b", ok: false };
  if (knapp > 0) return { text: `${knapp} Punkte knapp`, farbe: FP_VAR.accent, ok: false };
  return { text: "Alle Vorgaben eingehalten", farbe: THEME.gruen, ok: true };
}

export function SchrittVorschlag(props: SchrittVorschlagProps) {
  const { plan, ladenVorschlag } = props;

  if (ladenVorschlag) {
    return (
      <div style={{ maxWidth: 820, margin: "0 auto", padding: 20 }}>
        <Ladezustand variante="vorschlag" />
      </div>
    );
  }

  return plan ? <Ergebnis {...props} plan={plan} /> : <Ausloeser {...props} />;
}

/** Zustand A: Plan noch nicht erzeugt. */
function Ausloeser({
  room,
  stilprofil,
  istKueche,
  grossraum,
  normProfile,
  onNormProfile,
  formen,
  form,
  onFormWaehlen,
  onFormenLaden,
  onVorschlagen,
}: SchrittVorschlagProps) {
  return (
    <div className={CSS.schrittNeu} style={{ maxWidth: 820, margin: "0 auto", padding: 20 }}>
      <h2 style={{ ...titel, marginTop: 0, fontSize: 26 }}>Raumvorschlag erstellen</h2>
      {stilprofil && (
        <p style={{ fontSize: 13, color: THEME.gruen }}>
          <Piktogramm
            name="stilprofil"
            groesse={14}
            style={{ display: "inline-block", verticalAlign: "middle" }}
          />{" "}
          Stilprofil aktiv – der Vorschlag folgt deinen Vorlieben.
        </p>
      )}

      {istKueche && (
        <section className={CSS.soft} style={{ padding: 16, margin: "12px 0" }}>
          <h3 style={{ ...titel, marginTop: 0, fontSize: 15 }}>Küche</h3>
          {grossraum && (
            <p style={{ fontSize: 12, color: THEME.gruen, marginTop: 0 }}>
              Grossraum – geplant wird die Zone «Küche».
            </p>
          )}
          <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
            {(["ch", "eu"] as const).map((np) => {
              const aktiv = normProfile === np;
              return (
                <button
                  key={np}
                  type="button"
                  className={CSS.button}
                  onClick={() => onNormProfile(np)}
                  style={{
                    borderRadius: 999,
                    padding: "6px 14px",
                    cursor: "pointer",
                    border: `1px solid ${aktiv ? THEME.gruen : THEME.salbei}`,
                    background: aktiv ? THEME.gruen : "#fff",
                    color: aktiv ? "#fff" : THEME.gruen,
                  }}
                >
                  {np === "ch" ? "CH (55er)" : "EU (60er)"}
                </button>
              );
            })}
            <button
              type="button"
              className={CSS.button}
              onClick={onFormenLaden}
              style={{
                borderRadius: 999,
                padding: "6px 14px",
                cursor: "pointer",
                border: `1px solid ${THEME.salbei}`,
                background: "#fff",
                color: THEME.gruen,
                marginLeft: "auto",
              }}
            >
              Formen vorschlagen
            </button>
          </div>
          {formen && (
            <div style={{ display: "grid", gap: 8 }}>
              {formen.map((f) => {
                const aktiv = form === f.form;
                return (
                  <button
                    key={f.form}
                    type="button"
                    onClick={() => onFormWaehlen(f.form)}
                    className={`${CSS.cardFlach} ${CSS.auswahl} ${CSS.button} ${aktiv ? CSS.cardAktiv : ""}`}
                    style={{ textAlign: "left", padding: 10, cursor: "pointer" }}
                  >
                    <strong style={{ color: THEME.gruen }}>{f.form.toUpperCase()}-Form</strong> ·{" "}
                    {f.nutzlaenge_m} m
                    <div style={{ fontSize: 12, color: "#555", margin: "2px 0 4px" }}>
                      {f.begruendung}
                    </div>
                    <div style={{ height: 6, background: FP_VAR.soft, borderRadius: 3 }}>
                      <div
                        style={{
                          width: `${Math.round(f.score * 100)}%`,
                          height: 6,
                          background: THEME.gruen,
                          borderRadius: 3,
                        }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      <button
        type="button"
        className={CSS.button}
        disabled={!room}
        onClick={onVorschlagen}
        style={{
          ...pill,
          padding: "12px 26px",
          fontSize: 16,
          display: "inline-flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <Piktogramm name="vorschlag" groesse={20} style={{ filter: "brightness(0) invert(1)" }} />
        Vorschlag erstellen
      </button>
    </div>
  );
}

/** Zustand B: Plan liegt vor – Ergebnis präsentieren. */
function Ergebnis({
  aktuellerRaum,
  catalog,
  plan,
  report,
  statusById,
  begruendung,
  onNeueVariante,
  onAnpassen,
}: SchrittVorschlagProps & { plan: Plan }) {
  const status = normStatus(report);

  // Hauptmaterialien: je funktionsTyp ein Katalog-Item mit Farbpunkt.
  const materialien: { name: string; funktionsTyp: string }[] = [];
  const gesehen = new Set<string>();
  for (const p of plan.placements) {
    const item = catalog.find((c) => c.id === p.catalogItemId);
    if (!item || gesehen.has(item.funktionsTyp)) continue;
    gesehen.add(item.funktionsTyp);
    materialien.push({ name: item.name, funktionsTyp: item.funktionsTyp });
  }

  return (
    <div className={CSS.schrittNeu} style={{ maxWidth: 1100, margin: "0 auto", padding: 20 }}>
      <h2 style={{ ...titel, marginTop: 0, fontSize: 26 }}>Dein Raumvorschlag ist bereit</h2>

      <div className={CSS.twoColumn}>
        {/* Vorschau */}
        <div className={CSS.card} style={{ padding: 12, minHeight: 320 }}>
          <div style={{ height: 360 }}>
            {aktuellerRaum && (
              <Viewer2D
                room={aktuellerRaum}
                placements={plan.placements}
                catalog={catalog}
                gewaehltId={null}
                statusById={statusById}
                onSelect={() => {}}
                onMove={() => {}}
              />
            )}
          </div>
        </div>

        {/* Infos + Aktionen */}
        <div>
          {/* Normstatus */}
          <div
            className={CSS.soft}
            style={{
              padding: 12,
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 12,
            }}
          >
            <Piktogramm name="norm" aktiv={!status.ok} groesse={26} />
            <span style={{ color: status.farbe, fontWeight: 600 }}>
              {status.ok ? "✓ " : "⚠ "}
              {status.text}
            </span>
          </div>

          {begruendung && (
            <div className={CSS.soft} style={{ padding: 12, marginBottom: 12 }}>
              <h4 style={{ ...titel, marginTop: 0, fontSize: 13 }}>Warum dieser Stil</h4>
              <p style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>{begruendung}</p>
            </div>
          )}

          {materialien.length > 0 && (
            <div className={CSS.soft} style={{ padding: 12, marginBottom: 12 }}>
              <h4 style={{ ...titel, marginTop: 0, fontSize: 13 }}>Hauptelemente</h4>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {materialien.map((m) => (
                  <span
                    key={m.funktionsTyp}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5 }}
                  >
                    <span
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 4,
                        background: materialFarbe(m.funktionsTyp),
                        border: `1px solid ${THEME.salbei}`,
                      }}
                    />
                    {m.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          <p style={{ fontSize: 12, color: THEME.salbei }}>
            Variante · Seed {plan.meta.seed} · Solver {plan.meta.solverVersion}
          </p>

          {/* Aktionen */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
            <button
              type="button"
              className={CSS.button}
              onClick={onAnpassen}
              style={{
                ...pill,
                padding: "12px 22px",
                fontSize: 15,
                display: "inline-flex",
                gap: 8,
                alignItems: "center",
              }}
            >
              <Piktogramm
                name="moebel"
                groesse={18}
                style={{ filter: "brightness(0) invert(1)" }}
              />
              Ansehen &amp; anpassen
            </button>
            <button
              type="button"
              className={CSS.button}
              onClick={onNeueVariante}
              style={{
                borderRadius: 999,
                padding: "12px 20px",
                cursor: "pointer",
                border: `1px solid ${THEME.gruen}`,
                background: "#fff",
                color: THEME.gruen,
                display: "inline-flex",
                gap: 8,
                alignItems: "center",
              }}
            >
              <Piktogramm name="varianten" groesse={18} /> Neue Variante
            </button>
          </div>

          {report && (
            <details style={{ marginTop: 14 }}>
              <summary style={{ cursor: "pointer", fontSize: 13, color: THEME.gruen }}>
                Details (Normprüfung)
              </summary>
              <ul style={{ listStyle: "none", padding: 0, fontSize: 12.5, marginTop: 8 }}>
                {report.results.map((r) => (
                  <li key={r.ruleId} style={{ marginBottom: 3 }}>
                    {r.status === "ok"
                      ? "✅"
                      : r.status === "knapp"
                        ? "⚠️"
                        : r.status === "verletzt"
                          ? "❌"
                          : "➖"}{" "}
                    <code>{r.ruleId}</code>
                    {r.margin_cm !== null && ` · Marge ${r.margin_cm} cm`}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
