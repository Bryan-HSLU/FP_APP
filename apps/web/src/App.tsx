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
import {
  api,
  ApiFehler,
  type KatalogItem,
  type KuechenForm,
  type KV,
  type Plan,
  type Room,
} from "./api";
import { SmartSpider, StilSwipe, type Achse, type BildItem, type Stilprofil } from "./Stil";
import { Viewer2D } from "./Viewer2D";
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
  // Küche (M6): Normprofil-Toggle, Formwahl-Karten, gewählte Form.
  const [normProfile, setNormProfile] = useState<"ch" | "eu">("ch");
  const [formen, setFormen] = useState<KuechenForm[] | null>(null);
  const [form, setForm] = useState<string | null>(null);
  // Effektiv geplanter Raum (Viewer/Ampel): bei Grossraum die Küchen-Zone.
  const [planRoom, setPlanRoom] = useState<Room | null>(null);
  // Ansicht: 2D-Grundriss (normgerecht beurteilbar) oder 3D-Box-Platzhalter.
  const [ansicht, setAnsicht] = useState<"2d" | "3d">("2d");

  useEffect(() => {
    api
      .rooms()
      .then(setRooms)
      .catch(() => setMeldung("Engines-Dienst nicht erreichbar – «pnpm api» starten."));
  }, []);

  // Küchen-Zone eines (Gross-)Raums: roomType kueche ODER eine Zone roomType
  // kueche. Liefert {istKueche, zoneId, effektiverRoomType}.
  const kuecheInfo = useMemo(() => {
    if (!room) return { istKueche: false, zoneId: undefined as string | undefined };
    if (room.roomType === "kueche") return { istKueche: true, zoneId: undefined };
    const zonen = (room as Room & { zones?: { id: string; roomType: string }[] }).zones ?? [];
    const z = zonen.find((zone) => zone.roomType === "kueche");
    return { istKueche: !!z, zoneId: z?.id };
  }, [room]);

  const raumWaehlen = useCallback(
    async (r: Room) => {
      setRoom(r);
      setPlan(null);
      setKv(null);
      setGewaehltId(null);
      setStilprofil(null);
      setBegruendung("");
      setFormen(null);
      setForm(null);
      setPlanRoom(null);
      // Für Küchen den Katalog/Regeln des effektiven Raumtyps laden.
      const istKueche =
        r.roomType === "kueche" ||
        ((r as Room & { zones?: { roomType: string }[] }).zones ?? []).some(
          (z) => z.roomType === "kueche",
        );
      const effTyp = istKueche ? "kueche" : r.roomType;
      setCatalog(await api.catalog(effTyp));
      setRules((await api.rules(effTyp)) as Rule[]);
      setBilder(await api.images(r.roomType).catch(() => []));
      if (achsen.length === 0) setAchsen((await api.taxonomy()).achsen);
    },
    [achsen.length],
  );

  // Küche: vor dem ersten Solve die Top-3 Formen holen.
  const formenLaden = useCallback(async () => {
    if (!room || !kuecheInfo.istKueche) return;
    const res = await api.kuecheFormen(room, stilprofil, normProfile, kuecheInfo.zoneId);
    setFormen(res.formen);
    setForm(res.formen[0]?.form ?? null);
  }, [room, kuecheInfo, stilprofil, normProfile]);

  const loesen = useCallback(
    async (s: number) => {
      if (!room) return;
      setMeldung("");
      setKv(null);
      try {
        let res: { plan: Plan; room: Room; hinweis?: string };
        if (kuecheInfo.istKueche) {
          // Küche: lineare Baugruppe – Form + Normprofil (+ Zone) an den Solver.
          let f = form;
          if (f === null) {
            const fr = await api.kuecheFormen(room, stilprofil, normProfile, kuecheInfo.zoneId);
            setFormen(fr.formen);
            f = fr.formen[0]?.form ?? "i";
            setForm(f);
          }
          res = await api.solve(room, s, {
            normProfile,
            form: f,
            zoneId: kuecheInfo.zoneId,
            stilprofil,
            stilprofilRef: stilprofil?.id,
          });
        } else {
          // Bad/Wohnen: mit Stilprofil erst Kurator («KI wählt»), dann Solver.
          let kurator;
          if (stilprofil) {
            const k = await api.curate(room, stilprofil, s);
            kurator = k.kurator;
            setBegruendung(`${k.port}: ${k.kurator.begruendung ?? ""}`);
          }
          res = await api.solve(room, s, { kurator, stilprofilRef: stilprofil?.id });
        }
        setPlan(res.plan);
        setPlanRoom(res.room);
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
    [room, stilprofil, kuecheInfo, form, normProfile],
  );

  // Effektiver Raum für Viewer + Ampel: bei Küche/Grossraum die geplante Zone.
  const aktuellerRaum = planRoom ?? room;

  // Live-Ampel: TS-Interpreter über die aktuelle (ggf. editierte) Szene.
  const report: ConstraintReport | null = useMemo(() => {
    if (!aktuellerRaum || !plan || rules.length === 0) return null;
    return evaluateRules(
      buildScene(
        aktuellerRaum,
        { placements: plan.placements, meta: { normProfile: plan.meta.normProfile } },
        catalog,
      ),
      rules,
    );
  }, [aktuellerRaum, plan, rules, catalog]);

  // Pro-Placement-Status aus dem Report (verletzt schlägt knapp) – färbt die
  // Footprints im 2D-Grundriss nach der Norm-Ampel.
  const statusById = useMemo(() => {
    const m = new Map<string, "verletzt" | "knapp">();
    if (!report) return m;
    for (const r of report.results) {
      if (r.status !== "verletzt" && r.status !== "knapp") continue;
      for (const pid of r.placements) {
        if (r.status === "verletzt" || m.get(pid) !== "verletzt") m.set(pid, r.status);
      }
    }
    return m;
  }, [report]);

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

  // Absolutes Verschieben per Drag&Drop (Viewer2D). Funktionales setPlan, weil
  // beim Ziehen sehr schnell hintereinander aufgerufen wird; gesperrte bleiben.
  const verschiebeNach = useCallback((id: string, welt: [number, number]) => {
    setKv(null);
    setPlan((prev) =>
      prev
        ? {
            ...prev,
            status: "bearbeitet",
            placements: prev.placements.map((p) =>
              p.id !== id || p.locked
                ? p
                : { ...p, source: "user", pose: { ...p.pose, pos: welt } },
            ),
          }
        : prev,
    );
  }, []);

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
        <button
          style={{ ...stil.knopf, background: "#5b8a72" }}
          onClick={() => setAnsicht((a) => (a === "2d" ? "3d" : "2d"))}
        >
          {ansicht === "2d" ? "🧊 3D-Ansicht" : "🗺️ 2D-Grundriss"}
        </button>
        {plan && (
          <span style={{ fontSize: 12 }}>
            Seed {plan.meta.seed} · Solver {plan.meta.solverVersion}
          </span>
        )}
      </header>

      <main>
        {aktuellerRaum ? (
          ansicht === "2d" ? (
            <Viewer2D
              room={aktuellerRaum}
              placements={plan?.placements ?? []}
              catalog={catalog}
              gewaehltId={gewaehltId}
              statusById={statusById}
              onSelect={setGewaehltId}
              onMove={verschiebeNach}
            />
          ) : (
            <Viewer3D
              room={aktuellerRaum}
              placements={plan?.placements ?? []}
              catalog={catalog}
              gewaehltId={gewaehltId}
              onSelect={setGewaehltId}
            />
          )
        ) : (
          <p style={{ padding: 24 }}>Raum wählen, dann «Plan vorschlagen». {meldung}</p>
        )}
      </main>

      <aside style={stil.panel}>
        {meldung && <p style={{ color: "#c96f2e" }}>{meldung}</p>}

        {kuecheInfo.istKueche && (
          <section>
            <h3 style={{ marginTop: 0 }}>Küche planen</h3>
            {kuecheInfo.zoneId && (
              <p style={{ fontSize: 12, color: "#1f4d3a" }}>
                Grossraum – geplant wird die Zone «Küche».
              </p>
            )}
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              {(["ch", "eu"] as const).map((np) => (
                <button
                  key={np}
                  onClick={() => {
                    setNormProfile(np);
                    setFormen(null);
                    setForm(null);
                  }}
                  style={{
                    ...stil.knopf,
                    background: normProfile === np ? "#1f4d3a" : "#a3b9aa",
                  }}
                >
                  {np === "ch" ? "CH (55er)" : "EU (60er)"}
                </button>
              ))}
              <button style={stil.knopf} onClick={() => void formenLaden()}>
                Formen zeigen
              </button>
            </div>
            {formen && (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {formen.map((f) => (
                  <li
                    key={f.form}
                    onClick={() => setForm(f.form)}
                    style={{
                      border: `2px solid ${form === f.form ? "#c96f2e" : "#ddd"}`,
                      borderRadius: 6,
                      padding: 8,
                      marginBottom: 6,
                      cursor: "pointer",
                      background: "white",
                    }}
                  >
                    <strong>{f.form.toUpperCase()}-Form</strong> · {f.nutzlaenge_m} m
                    <div style={{ fontSize: 12, color: "#555" }}>{f.begruendung}</div>
                    <div
                      style={{
                        height: 6,
                        marginTop: 4,
                        background: "#eee",
                        borderRadius: 3,
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.round(f.score * 100)}%`,
                          height: 6,
                          background: "#5b8a72",
                          borderRadius: 3,
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

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
              Ziehen (2D) oder Pfeiltasten = verschieben · «r» = rotieren · Klick daneben = abwählen
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
