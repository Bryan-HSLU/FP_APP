/** M3-Klickpfad: Sample-Raum → Plan vorschlagen → ansehen/editieren mit
 *  Live-Ampel → Variante würfeln → Auswertung (Mengen/KV) → KV-PDF.
 *
 *  Live-Regel-Feedback läuft CLIENTSEITIG über den TS-Interpreter aus
 *  @fp/shared – dieselben Regel-JSONs wie der Server (Regel-Parität).
 */
import {
  buildScene,
  evaluateRules,
  type ConstraintReport,
  type Rule,
  type RuleResult,
} from "@fp/shared/rules";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiFehler, type KatalogItem, type KV, type Plan, type Room } from "./api";
import { SmartSpider, StilSwipe, type Achse, type BildItem, type Stilprofil } from "./Stil";
import { Viewer3D } from "./Viewer3D";

const AMPEL: Record<RuleResult["status"], string> = {
  ok: "✅",
  knapp: "⚠️",
  verletzt: "❌",
  "nicht-geprueft": "➖",
};

const stil = {
  seite: {
    display: "grid",
    gridTemplateColumns: "minmax(0,1fr) 340px",
    gridTemplateRows: "auto minmax(0,1fr)",
    height: "100vh",
    fontFamily: "system-ui, sans-serif",
    background: "#faf7f0",
  },
  kopf: {
    gridColumn: "1 / 3",
    display: "flex",
    gap: 12,
    alignItems: "center",
    padding: "10px 16px",
    background: "#1f4d3a",
    color: "white",
    flexWrap: "wrap" as const,
  },
  knopf: {
    background: "#c96f2e",
    color: "white",
    border: "none",
    borderRadius: 6,
    padding: "6px 12px",
    cursor: "pointer",
  },
  panel: { padding: 12, overflowY: "auto" as const, borderLeft: "1px solid #ddd" },
} as const;

export function App() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [room, setRoom] = useState<Room | null>(null);
  const [catalog, setCatalog] = useState<KatalogItem[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [seed, setSeed] = useState(1);
  const [gewaehltId, setGewaehltId] = useState<string | null>(null);
  const [kv, setKv] = useState<KV | null>(null);
  const [meldung, setMeldung] = useState<string>("");
  const [bilder, setBilder] = useState<BildItem[]>([]);
  const [achsen, setAchsen] = useState<Achse[]>([]);
  const [stilprofil, setStilprofil] = useState<Stilprofil | null>(null);
  const [swipeOffen, setSwipeOffen] = useState(false);
  const [begruendung, setBegruendung] = useState<string>("");

  useEffect(() => {
    api
      .rooms()
      .then(setRooms)
      .catch(() => setMeldung("Engines-Dienst nicht erreichbar – «pnpm api» starten."));
  }, []);

  const raumWaehlen = useCallback(
    async (r: Room) => {
      setRoom(r);
      setPlan(null);
      setKv(null);
      setGewaehltId(null);
      setStilprofil(null);
      setBegruendung("");
      setCatalog(await api.catalog(r.roomType));
      setRules((await api.rules(r.roomType)) as Rule[]);
      setBilder(await api.images(r.roomType).catch(() => []));
      if (achsen.length === 0) setAchsen((await api.taxonomy()).achsen);
    },
    [achsen.length],
  );

  const loesen = useCallback(
    async (s: number) => {
      if (!room) return;
      setMeldung("");
      setKv(null);
      try {
        // Mit Stilprofil: erst Kurator («KI wählt»), dann Solver («platziert»).
        let kurator;
        if (stilprofil) {
          const k = await api.curate(room, stilprofil, s);
          kurator = k.kurator;
          setBegruendung(`${k.port}: ${k.kurator.begruendung ?? ""}`);
        }
        const res = await api.solve(room, s, kurator, stilprofil?.id);
        setPlan(res.plan);
        setSeed(s);
        if (res.hinweis)
          setMeldung("Hinweis: Geometrie unbestätigt – Ampel rechnet mit Messunsicherheit.");
      } catch (e) {
        if (e instanceof ApiFehler && e.code === "NO_FEASIBLE_PLACEMENT") {
          setMeldung(`Solver ehrlich: ${e.message} – Raum zu klein / Anschlüsse fehlen.`);
          setPlan(null);
        } else throw e;
      }
    },
    [room, stilprofil],
  );

  // Live-Ampel: TS-Interpreter über die aktuelle (ggf. editierte) Szene.
  const report: ConstraintReport | null = useMemo(() => {
    if (!room || !plan || rules.length === 0) return null;
    return evaluateRules(
      buildScene(
        room,
        { placements: plan.placements, meta: { normProfile: plan.meta.normProfile } },
        catalog,
      ),
      rules,
    );
  }, [room, plan, rules, catalog]);

  const bewege = useCallback(
    (dx: number, dz: number, drehung = 0) => {
      if (!plan || !gewaehltId) return;
      setKv(null);
      setPlan({
        ...plan,
        status: "bearbeitet",
        placements: plan.placements.map((p) =>
          p.id !== gewaehltId || p.locked
            ? p
            : {
                ...p,
                source: "user",
                pose: {
                  pos: [p.pose.pos[0] + dx, p.pose.pos[1] + dz],
                  yawDeg: (p.pose.yawDeg + drehung + 360) % 360,
                },
              },
        ),
      });
    },
    [plan, gewaehltId],
  );

  const sperren = useCallback(() => {
    if (!plan || !gewaehltId) return;
    setPlan({
      ...plan,
      placements: plan.placements.map((p) =>
        p.id === gewaehltId ? { ...p, locked: !p.locked } : p,
      ),
    });
  }, [plan, gewaehltId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const schritt = 0.05;
      if (e.key === "ArrowLeft") bewege(-schritt, 0);
      if (e.key === "ArrowRight") bewege(schritt, 0);
      if (e.key === "ArrowUp") bewege(0, -schritt);
      if (e.key === "ArrowDown") bewege(0, schritt);
      if (e.key === "r") bewege(0, 0, 90);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [bewege]);

  const auswerten = useCallback(async () => {
    if (!room || !plan) return;
    setKv(await api.evaluate(room, plan));
  }, [room, plan]);

  const gewaehltesItem =
    plan && gewaehltId
      ? catalog.find(
          (c) => c.id === plan.placements.find((p) => p.id === gewaehltId)?.catalogItemId,
        )
      : null;

  return (
    <div style={stil.seite}>
      <header style={stil.kopf}>
        <strong>Future Planning</strong>
        <select
          value={room?.id ?? ""}
          onChange={(e) => {
            const r = rooms.find((x) => x.id === e.target.value);
            if (r) void raumWaehlen(r);
          }}
        >
          <option value="" disabled>
            Raum wählen…
          </option>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <button
          style={stil.knopf}
          disabled={!room || bilder.length === 0}
          onClick={() => setSwipeOffen(true)}
        >
          🎴 Stil festlegen
        </button>
        <button style={stil.knopf} disabled={!room} onClick={() => void loesen(seed)}>
          Plan vorschlagen
        </button>
        <button style={stil.knopf} disabled={!plan} onClick={() => void loesen(seed + 1)}>
          🎲 Variante würfeln
        </button>
        <button style={stil.knopf} disabled={!plan} onClick={() => void auswerten()}>
          Auswertung
        </button>
        <select
          disabled={!plan}
          value=""
          onChange={(e) => {
            const [pfad, datei] = e.target.value.split("|");
            if (room && plan && pfad && datei) void api.dokument(pfad, datei, room, plan);
            e.target.value = "";
          }}
        >
          <option value="" disabled>
            📄 Dokumente…
          </option>
          <option value="kv-pdf|kostenschaetzung.pdf">Kostenschätzung (KV)</option>
          <option value="lv-pdf|leistungsverzeichnis.pdf">Leistungsverzeichnis</option>
          <option value="bauzeitenplan-pdf|bauzeitenplan.pdf">Bauzeitenplan</option>
          <option value="offertanfrage|offertanfrage.pdf">Offertanfrage-Paket</option>
          <option value="gewerke-pdf|gewerke-uebersicht.pdf">Gewerke-Übersicht</option>
          <option value="einkaufsliste-pdf|einkaufsliste.pdf">Einkaufsliste</option>
          <option value="plan-pdf|grundriss.pdf">2D-Plan (PDF)</option>
          <option value="dxf|grundriss.dxf">2D-Plan (DXF)</option>
          <option value="gltf|szene.gltf">3D-Export (glTF)</option>
        </select>
        {plan && (
          <span style={{ fontSize: 12 }}>
            Seed {plan.meta.seed} · Solver {plan.meta.solverVersion}
          </span>
        )}
      </header>

      <main>
        {room ? (
          <Viewer3D
            room={room}
            placements={plan?.placements ?? []}
            catalog={catalog}
            gewaehltId={gewaehltId}
            onSelect={setGewaehltId}
          />
        ) : (
          <p style={{ padding: 24 }}>Raum wählen, dann «Plan vorschlagen». {meldung}</p>
        )}
      </main>

      <aside style={stil.panel}>
        {meldung && <p style={{ color: "#c96f2e" }}>{meldung}</p>}

        {stilprofil && (
          <section>
            <h3 style={{ marginTop: 0 }}>Dein Stil ({stilprofil.meta.method})</h3>
            <SmartSpider vektor={stilprofil.styleVector} achsen={achsen} />
            <p style={{ display: "flex", gap: 4 }}>
              {stilprofil.palette.map((f) => (
                <span key={f} style={{ width: 22, height: 22, background: f, borderRadius: 4 }} />
              ))}
            </p>
            {!stilprofil.meta.sampleSufficient && (
              <p style={{ fontSize: 12, color: "#c96f2e" }}>
                Wenige Bewertungen – Profil noch unsicher.
              </p>
            )}
            {begruendung && <p style={{ fontSize: 12 }}>{begruendung}</p>}
          </section>
        )}

        {gewaehltesItem && (
          <section>
            <h3 style={{ marginTop: 0 }}>{gewaehltesItem.name}</h3>
            <p style={{ fontSize: 12 }}>
              Pfeiltasten = verschieben · «r» = rotieren · Klick daneben = abwählen
            </p>
            <button style={stil.knopf} onClick={sperren}>
              🔒 sperren/entsperren
            </button>
          </section>
        )}

        {report && (
          <section>
            <h3>
              Norm-Ampel {report.hard.ok ? "✅" : "❌"} ({report.hard.summary.erfuellt} ok ·{" "}
              {report.hard.summary.knapp} knapp · {report.hard.summary.verletzt} verletzt)
            </h3>
            <ul style={{ listStyle: "none", padding: 0, fontSize: 13 }}>
              {report.results.map((r) => (
                <li key={r.ruleId} style={{ marginBottom: 4 }}>
                  {AMPEL[r.status]} <code>{r.ruleId}</code>
                  {r.margin_cm !== null && ` · Marge ${r.margin_cm} cm`}
                </li>
              ))}
            </ul>
          </section>
        )}

        {kv && (
          <section>
            <h3>Kostenschätzung</h3>
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <tbody>
                {kv.positionen.map((p) => (
                  <tr key={p.bezeichnung}>
                    <td>{p.bezeichnung}</td>
                    <td style={{ textAlign: "right" }}>
                      CHF {p.total_chf.toLocaleString("de-CH")}
                    </td>
                  </tr>
                ))}
                <tr style={{ fontWeight: "bold", borderTop: "1px solid #1f4d3a" }}>
                  <td>Summe (±{kv.bandbreitePct}%)</td>
                  <td style={{ textAlign: "right" }}>CHF {kv.summe_chf.toLocaleString("de-CH")}</td>
                </tr>
              </tbody>
            </table>
            <p style={{ fontSize: 11, color: "#c96f2e" }}>⚠ {kv.hinweis}</p>
            {kv.nextSteps.length > 0 && (
              <>
                <h4>Next Steps</h4>
                <ul style={{ fontSize: 12 }}>
                  {kv.nextSteps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}
      </aside>

      {swipeOffen && (
        <StilSwipe
          bilder={bilder}
          onAbbruch={() => setSwipeOffen(false)}
          onFertig={(likes, dislikes, presetId) => {
            setSwipeOffen(false);
            if (!room) return;
            void api
              .styleProfile(room.roomType, likes, dislikes, presetId)
              .then((p) => setStilprofil(p));
          }}
        />
      )}
    </div>
  );
}
