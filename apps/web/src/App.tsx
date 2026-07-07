/** M3-Klickpfad, jetzt als Schritt-für-Schritt-Wizard (CI-UX-Kreislauf):
 *  1 Projekt → 2 Stil → 3 Vorschlag → 4 Anpassen → 5 Auswertung & Export.
 *  Nach jeder Auswahl einen Schritt weiter; die bisherige UI-Logik/Callbacks
 *  bleiben unverändert – nur die Anzeige ist pro Schritt gruppiert.
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
  type Arbeitsdreieck,
  type KatalogItem,
  type KuechenForm,
  type KV,
  type Plan,
  type Room,
} from "./api";
import { RaumEditor } from "./RaumEditor";
import { ScanKorrektur } from "./ScanKorrektur";
import { SmartSpider, StilSwipe, type Achse, type BildItem, type Stilprofil } from "./Stil";
import { karte, pill, schlagschatten, THEME, titel } from "./theme";
import { Viewer2D } from "./Viewer2D";
import { Viewer3D } from "./Viewer3D";

const AMPEL: Record<RuleResult["status"], string> = {
  ok: "✅",
  knapp: "⚠️",
  verletzt: "❌",
  "nicht-geprueft": "➖",
};

const DREIECK_SYMBOL: Record<Arbeitsdreieck["bewertung"], string> = {
  effizient: "✅",
  akzeptabel: "⚠️",
  beengt: "🔻",
  weitläufig: "🔺",
};

// Schriften (Accidental Presidency/Gleasonslight lt. CI) werden bewusst NICHT
// eingebettet – Lizenz laut Brain (Corporate-Identity.md, "Offene Punkte")
// noch ungeklärt. Bis zur Klärung bleibt system-ui als sichere Wahl.
// CI-Layoutsprache: heller Grund (dezenter Verlauf, NICHT der dunkle Marketing-
// Look), helle Karten mit innerem Schein + hartem Schlagschatten, orange Pills.
const stil = {
  seite: {
    display: "flex",
    flexDirection: "column" as const,
    height: "100vh",
    fontFamily: "system-ui, sans-serif",
    background: "linear-gradient(160deg, #F0F7F2, #dfe7df)",
  },
  // Header wird HELL (weiss), dünne Salbei-Unterkante, harter Schlagschatten.
  kopf: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    padding: "10px 16px",
    background: "#ffffff",
    borderBottom: `1px solid ${THEME.salbei}`,
    boxShadow: schlagschatten,
    flexWrap: "wrap" as const,
    zIndex: 2,
  },
  // Rechtes Panel + wiederverwendbarer Karten-Stil (CI).
  sektion: { ...karte, padding: 12, marginBottom: 12 },
  panel: { padding: 12, overflowY: "auto" as const, minWidth: 0 },
} as const;

// Reihenfolge der Wizard-Schritte (Bryans Schritt-für-Schritt-Kreislauf, CI).
const SCHRITTE = ["Projekt", "Stil", "Vorschlag", "Anpassen", "Auswertung & Export"] as const;

const badgeBasis = {
  width: 30,
  height: 30,
  borderRadius: 999,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  color: "white",
  fontWeight: 600,
  fontSize: 14,
  flex: "0 0 auto",
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
  // Manueller Raum-Editor (dritte Erstellungsvariante neben Sample/Scan).
  const [editorOffen, setEditorOffen] = useState(false);
  const [begruendung, setBegruendung] = useState<string>("");
  // Küche (M6): Normprofil-Toggle, Formwahl-Karten, gewählte Form.
  const [normProfile, setNormProfile] = useState<"ch" | "eu">("ch");
  const [formen, setFormen] = useState<KuechenForm[] | null>(null);
  const [form, setForm] = useState<string | null>(null);
  // Gemessenes Arbeitsdreieck des aktuellen Küchenplans (server-berechnet).
  const [dreieck, setDreieck] = useState<Arbeitsdreieck | null>(null);
  // Effektiv geplanter Raum (Viewer/Ampel): bei Grossraum die Küchen-Zone.
  const [planRoom, setPlanRoom] = useState<Room | null>(null);
  // Ansicht: 2D-Grundriss (normgerecht beurteilbar) oder 3D-Box-Platzhalter.
  const [ansicht, setAnsicht] = useState<"2d" | "3d">("2d");
  // Scan-Upload (M7 Schritt 4): Raumtyp des hochgeladenen Scan-Bundles.
  const [scanRoomType, setScanRoomType] = useState("bad");
  // Scan-Korrektur-Modus (M7 Schritt 6): geladener Scan wartet auf Korrektur.
  const [korrektur, setKorrektur] = useState<{ room: Room; warnungen: string[] } | null>(null);
  // Wizard: aktueller Schritt (1..5). Schritt-für-Schritt statt alles auf einmal.
  const [schritt, setSchritt] = useState(1);

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
      setDreieck(null);
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
      // Nach erfolgreicher Raumwahl automatisch weiter zu Schritt 2 «Stil».
      setSchritt(2);
    },
    [achsen.length],
  );

  // Scan-Bundle hochladen → Raummodell → Korrektur-Modus (M7 Schritt 6).
  // Gescannte Geometrie ist ~8.5 cm unsicher (kein LiDAR) und trägt weder
  // Anschlüsse noch bestätigte Objekte – erst nach der Nutzer-Korrektur geht der
  // Raum (geometryConfirmed) in den bestehenden Klickpfad.
  const scanLaden = useCallback(
    async (datei: File) => {
      setMeldung("Scan wird verarbeitet…");
      try {
        const { room: neu, warnungen } = await api.scan(datei, scanRoomType, datei.name);
        setKorrektur({ room: neu, warnungen });
        setMeldung("Scan geladen – bitte korrigieren.");
      } catch (e) {
        setMeldung(
          e instanceof ApiFehler ? `Scan fehlgeschlagen: ${e.message}` : "Scan fehlgeschlagen.",
        );
      }
    },
    [scanRoomType],
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
        let res: { plan: Plan; room: Room; hinweis?: string; arbeitsdreieck?: Arbeitsdreieck };
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
        setDreieck(res.arbeitsdreieck ?? null);
        setSeed(s);
        // Nach erfolgreichem Plan automatisch weiter zu Schritt 4 «Anpassen».
        setSchritt(4);
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
  // Footprints im 2D-Grundriss und die Möbel im 3D-Viewer nach der Norm-Ampel.
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

  // «austauschen»: das gewählte Item gegen eine Katalog-Alternative tauschen
  // (Pose bleibt; Live-Ampel rechnet die neuen Masse sofort durch).
  const tauscheItem = useCallback(
    (neueId: string) => {
      if (!gewaehltId) return;
      setKv(null);
      setPlan((prev) =>
        prev
          ? {
              ...prev,
              status: "bearbeitet",
              placements: prev.placements.map((p) =>
                p.id === gewaehltId ? { ...p, source: "user", catalogItemId: neueId } : p,
              ),
            }
          : prev,
      );
    },
    [gewaehltId],
  );

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
      const schrittW = 0.05;
      if (e.key === "ArrowLeft") bewege(-schrittW, 0);
      if (e.key === "ArrowRight") bewege(schrittW, 0);
      if (e.key === "ArrowUp") bewege(0, -schrittW);
      if (e.key === "ArrowDown") bewege(0, schrittW);
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

  // Tausch-Alternativen: gleicher Funktionstyp, gleiche Normprofil-Variante
  // (Küchenzeile bleibt konsistent), ohne das aktuelle Item selbst.
  const alternativen = gewaehltesItem
    ? catalog.filter(
        (c) =>
          c.funktionsTyp === gewaehltesItem.funktionsTyp &&
          c.id !== gewaehltesItem.id &&
          (c as { normProfileVariante?: string }).normProfileVariante ===
            (gewaehltesItem as { normProfileVariante?: string }).normProfileVariante,
      )
    : [];

  // Zwei-Spalten-Layout (Viewer links, Panel rechts) nur ab Schritt 4/5.
  const zweiSpaltig = schritt >= 4;
  // Erreichbarkeit der Badges: 1/2 immer, 3 nur mit Raum, 4/5 nur mit Plan.
  const erreichbar = (nr: number) => (nr <= 2 ? true : nr === 3 ? !!room : !!plan);

  return (
    <div style={stil.seite}>
      <header style={stil.kopf}>
        {/* Echtes Horizontal-Logo (Signet + Wortmarke) ersetzt die getippte
            Wortmarke; Claim klein/dezent in Salbei daneben (CI). */}
        <img src="/FP-Logo-horizontal.png" alt="Future Planning" style={{ height: 44 }} />
        <span style={{ fontSize: 12, color: THEME.salbei, letterSpacing: "0.04em" }}>
          Meet. Match. Build.
        </span>
      </header>

      {/* Stepper: 5 Kreis-Badges (dunkelblau) + Label. erledigt = grün mit ✓,
          aktiv = orange Ring. Klick springt zu jedem erreichbaren Schritt. */}
      <nav
        aria-label="Schritte"
        style={{
          display: "flex",
          gap: 14,
          padding: "10px 16px",
          alignItems: "center",
          flexWrap: "wrap",
          borderBottom: `1px solid ${THEME.salbei}`,
        }}
      >
        {SCHRITTE.map((label, i) => {
          const nr = i + 1;
          const kann = erreichbar(nr);
          const erledigt = nr < schritt;
          const aktiv = nr === schritt;
          return (
            <button
              key={label}
              type="button"
              disabled={!kann}
              onClick={() => kann && setSchritt(nr)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: kann ? "pointer" : "not-allowed",
                opacity: kann ? 1 : 0.4,
              }}
            >
              <span
                style={{
                  ...badgeBasis,
                  background: erledigt ? "#5b8a72" : THEME.blau,
                  boxShadow: aktiv ? `0 0 0 3px ${THEME.orange}` : "none",
                }}
              >
                {erledigt ? "✓" : nr}
              </span>
              <span
                style={{
                  fontSize: 13,
                  color: aktiv ? THEME.gruen : "#5a635a",
                  fontWeight: aktiv ? 700 : 400,
                }}
              >
                {label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Meldungszeile bleibt global sichtbar. */}
      {meldung && (
        <div style={{ padding: "6px 16px", color: THEME.orange, fontSize: 13 }}>{meldung}</div>
      )}

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: zweiSpaltig ? "grid" : "block",
          gridTemplateColumns: zweiSpaltig ? "minmax(0,1fr) 360px" : undefined,
          overflow: zweiSpaltig ? "hidden" : "auto",
        }}
      >
        {/* ---------- Schritte 1–3: einspaltig ---------- */}
        {schritt <= 3 && (
          <div style={{ maxWidth: 760, margin: "0 auto", padding: 20 }}>
            {/* Schritt 1 – Projekt: Raum wählen / Scan / selbst erstellen. */}
            {schritt === 1 && (
              <section>
                <h2 style={{ ...titel, marginTop: 0 }}>Projekt starten</h2>
                <p style={{ color: "#5a635a", fontSize: 14 }}>
                  Raum wählen – oder einen Scan laden bzw. selbst erstellen.
                </p>
                <div style={{ display: "grid", gap: 10 }}>
                  {rooms.map((r) => {
                    const gewaehlt = room?.id === r.id;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => void raumWaehlen(r)}
                        style={{
                          ...karte,
                          textAlign: "left",
                          padding: 12,
                          cursor: "pointer",
                          border: `2px solid ${gewaehlt ? THEME.orange : THEME.salbei}`,
                        }}
                      >
                        <strong style={{ color: THEME.gruen }}>{r.name}</strong>
                        <span style={{ fontSize: 12, color: "#5a635a", marginLeft: 8 }}>
                          {r.roomType}
                        </span>
                      </button>
                    );
                  })}
                  {rooms.length === 0 && (
                    <p style={{ fontSize: 13, color: "#5a635a" }}>Räume werden geladen…</p>
                  )}
                </div>

                <div
                  style={{
                    ...stil.sektion,
                    marginTop: 16,
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <label
                    style={{ ...pill, display: "inline-flex", gap: 6, alignItems: "center" }}
                    title="Scan-Bundle (layout.txt oder .zip vom Colab-Worker) laden"
                  >
                    📷 Scan laden
                    <input
                      type="file"
                      accept=".zip,.txt"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void scanLaden(f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <select
                    value={scanRoomType}
                    onChange={(e) => setScanRoomType(e.target.value)}
                    title="Raumtyp des Scans (SpatialLM kennt ihn nicht)"
                  >
                    <option value="bad">Scan → Bad</option>
                    <option value="wohnen">Scan → Wohnen</option>
                    <option value="kueche">Scan → Küche</option>
                    {/* «sonstig» bewusst nicht anbieten: ohne Katalog kein Klickpfad. */}
                  </select>
                  <button style={pill} onClick={() => setEditorOffen(true)}>
                    ✏️ Raum erstellen
                  </button>
                  {/* Korrektur erneut öffnen – nur für gescannte Räume (captureMethod
                      "ar"); defensiv geprüft, da Samples evtl. kein meta tragen. */}
                  {room &&
                    (room.meta as { captureMethod?: string } | undefined)?.captureMethod ===
                      "ar" && (
                      <button
                        style={{ ...pill, background: THEME.blau }}
                        onClick={() => setKorrektur({ room, warnungen: [] })}
                      >
                        📐 Korrigieren
                      </button>
                    )}
                </div>
              </section>
            )}

            {/* Schritt 2 – Stil: StilSwipe + SmartSpider + Preset. */}
            {schritt === 2 && (
              <section>
                <h2 style={{ ...titel, marginTop: 0 }}>Stil festlegen</h2>
                <p style={{ color: "#5a635a", fontSize: 14 }}>
                  Swipe dich durch Beispielbilder (oder wähle ein Preset) – oder überspringe.
                </p>
                <div
                  style={{
                    ...stil.sektion,
                    display: "flex",
                    gap: 10,
                    flexWrap: "wrap",
                    alignItems: "center",
                  }}
                >
                  <button
                    style={pill}
                    disabled={!room || bilder.length === 0}
                    onClick={() => setSwipeOffen(true)}
                  >
                    🎴 Stil swipen
                  </button>
                  {(!room || bilder.length === 0) && (
                    <span style={{ fontSize: 12, color: "#5a635a" }}>
                      {room
                        ? "Für diesen Raumtyp liegen keine Beispielbilder vor."
                        : "Zuerst einen Raum wählen."}
                    </span>
                  )}
                </div>

                {stilprofil && (
                  <div style={stil.sektion}>
                    <h3 style={{ ...titel, marginTop: 0, fontSize: 15 }}>
                      Dein Stil ({stilprofil.meta.method})
                    </h3>
                    <SmartSpider vektor={stilprofil.styleVector} achsen={achsen} />
                    <p style={{ display: "flex", gap: 4 }}>
                      {stilprofil.palette.map((f) => (
                        <span
                          key={f}
                          style={{ width: 22, height: 22, background: f, borderRadius: 4 }}
                        />
                      ))}
                    </p>
                    {!stilprofil.meta.sampleSufficient && (
                      <p style={{ fontSize: 12, color: THEME.orange }}>
                        Wenige Bewertungen – Profil noch unsicher.
                      </p>
                    )}
                    {begruendung && <p style={{ fontSize: 12 }}>{begruendung}</p>}
                  </div>
                )}

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button style={pill} disabled={!stilprofil} onClick={() => setSchritt(3)}>
                    Stil übernehmen → weiter
                  </button>
                  <button
                    style={{ ...pill, background: THEME.salbei }}
                    onClick={() => setSchritt(3)}
                  >
                    Überspringen
                  </button>
                </div>
              </section>
            )}

            {/* Schritt 3 – Vorschlag: Küche (Normprofil + Formwahl) + Plan lösen. */}
            {schritt === 3 && (
              <section>
                <h2 style={{ ...titel, marginTop: 0 }}>Vorschlag</h2>
                {stilprofil && (
                  <p style={{ fontSize: 12, color: "#5a635a" }}>
                    Stil aktiv ({stilprofil.meta.method}).
                  </p>
                )}

                {kuecheInfo.istKueche && (
                  <div style={stil.sektion}>
                    <h3 style={{ ...titel, marginTop: 0, fontSize: 15 }}>Küche planen</h3>
                    {kuecheInfo.zoneId && (
                      <p style={{ fontSize: 12, color: THEME.gruen }}>
                        Grossraum – geplant wird die Zone «Küche».
                      </p>
                    )}
                    <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                      {(["ch", "eu"] as const).map((np) => (
                        <button
                          key={np}
                          onClick={() => {
                            setNormProfile(np);
                            setFormen(null);
                            setForm(null);
                          }}
                          style={{
                            ...pill,
                            background: normProfile === np ? THEME.gruen : "#a3b9aa",
                          }}
                        >
                          {np === "ch" ? "CH (55er)" : "EU (60er)"}
                        </button>
                      ))}
                      <button style={pill} onClick={() => void formenLaden()}>
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
                              ...karte,
                              padding: 8,
                              marginBottom: 6,
                              cursor: "pointer",
                              border: `2px solid ${form === f.form ? THEME.orange : THEME.salbei}`,
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
                  </div>
                )}

                <button style={pill} disabled={!room} onClick={() => void loesen(seed)}>
                  Plan vorschlagen
                </button>
              </section>
            )}
          </div>
        )}

        {/* ---------- Schritte 4–5: zweispaltig (Viewer + Panel) ---------- */}
        {zweiSpaltig && (
          <>
            <main
              style={{
                display: "flex",
                flexDirection: "column",
                minWidth: 0,
                minHeight: 0,
              }}
            >
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  padding: "8px 12px",
                  flexWrap: "wrap",
                }}
              >
                <button
                  style={{ ...pill, background: "#5b8a72" }}
                  onClick={() => setAnsicht((a) => (a === "2d" ? "3d" : "2d"))}
                >
                  {ansicht === "2d" ? "🧊 3D-Ansicht" : "🗺️ 2D-Grundriss"}
                </button>
                {plan && (
                  <span style={{ fontSize: 12, color: THEME.gruen }}>
                    Seed {plan.meta.seed} · Solver {plan.meta.solverVersion}
                  </span>
                )}
              </div>
              <div style={{ flex: 1, minHeight: 0 }}>
                {aktuellerRaum &&
                  (ansicht === "2d" ? (
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
                      statusById={statusById}
                      onSelect={setGewaehltId}
                      stilprofil={stilprofil}
                    />
                  ))}
              </div>
            </main>

            <aside style={stil.panel}>
              {/* Schritt 4 – Anpassen: würfeln + Auswahl-Panel + Live-Ampel. */}
              {schritt === 4 && (
                <>
                  <div style={stil.sektion}>
                    <button
                      style={{ ...pill, width: "100%" }}
                      disabled={!plan}
                      onClick={() => void loesen(seed + 1)}
                    >
                      🎲 Variante würfeln
                    </button>
                  </div>

                  {gewaehltesItem && (
                    <section style={stil.sektion}>
                      <h3 style={{ ...titel, marginTop: 0, fontSize: 15 }}>
                        {gewaehltesItem.name}
                      </h3>
                      <p style={{ fontSize: 12 }}>
                        Ziehen (2D) oder Pfeiltasten = verschieben · «r» = rotieren · Klick daneben
                        = abwählen
                      </p>
                      {alternativen.length > 0 && (
                        <label style={{ display: "block", fontSize: 12, marginBottom: 8 }}>
                          Austauschen:{" "}
                          <select
                            value=""
                            onChange={(e) => {
                              if (e.target.value) tauscheItem(e.target.value);
                              e.target.value = "";
                            }}
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
                      <button style={pill} onClick={sperren}>
                        🔒 sperren/entsperren
                      </button>
                    </section>
                  )}

                  {begruendung && (
                    <section style={stil.sektion}>
                      <p style={{ fontSize: 12, margin: 0 }}>{begruendung}</p>
                    </section>
                  )}

                  {report && (
                    <section style={stil.sektion}>
                      <h3 style={{ marginTop: 0 }}>
                        Norm-Ampel {report.hard.ok ? "✅" : "❌"} ({report.hard.summary.erfuellt} ok
                        · {report.hard.summary.knapp} knapp · {report.hard.summary.verletzt}{" "}
                        verletzt)
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
                </>
              )}

              {/* Schritt 5 – Auswertung & Export: Auswertung + KV + Dokumente + Dreieck. */}
              {schritt === 5 && (
                <>
                  <div
                    style={{
                      ...stil.sektion,
                      display: "flex",
                      gap: 8,
                      flexWrap: "wrap",
                      alignItems: "center",
                    }}
                  >
                    <button style={pill} disabled={!plan} onClick={() => void auswerten()}>
                      Auswertung
                    </button>
                    <select
                      disabled={!plan}
                      value=""
                      onChange={(e) => {
                        const [pfad, datei] = e.target.value.split("|");
                        if (room && plan && pfad && datei)
                          void api.dokument(pfad, datei, room, plan);
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
                  </div>

                  {kv && (
                    <section style={stil.sektion}>
                      <h3 style={{ marginTop: 0 }}>Kostenschätzung</h3>
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
                          <tr style={{ fontWeight: "bold", borderTop: `1px solid ${THEME.gruen}` }}>
                            <td>Summe (±{kv.bandbreitePct}%)</td>
                            <td style={{ textAlign: "right" }}>
                              CHF {kv.summe_chf.toLocaleString("de-CH")}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                      <p style={{ fontSize: 11, color: THEME.orange }}>⚠ {kv.hinweis}</p>
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

                  {dreieck && (
                    <section style={stil.sektion}>
                      <h3 style={{ marginBottom: 4, marginTop: 0 }}>
                        {DREIECK_SYMBOL[dreieck.bewertung]} Arbeitsdreieck · {dreieck.bewertung}
                      </h3>
                      <p style={{ fontSize: 13, margin: "2px 0" }}>
                        Ergonomie {Math.round(dreieck.score * 100)} % · Summe{" "}
                        {dreieck.summe_m.toLocaleString("de-CH")} m
                      </p>
                      <p style={{ fontSize: 12, color: "#555", margin: "2px 0" }}>
                        Seiten {dreieck.seiten_m.map((s) => s.toLocaleString("de-CH")).join(" · ")}{" "}
                        m (Spüle–Kochfeld–Kühlschrank)
                      </p>
                      <p style={{ fontSize: 11, color: "#999", margin: "2px 0" }}>
                        AMK-Richtwert: jede Seite 1.2–2.7 m, Summe 4–8 m = effizient.
                      </p>
                    </section>
                  )}
                </>
              )}
            </aside>
          </>
        )}
      </div>

      {/* Wizard-Navigation: Zurück / Weiter als Pills. */}
      <nav
        style={{
          display: "flex",
          gap: 10,
          padding: "10px 16px",
          borderTop: `1px solid ${THEME.salbei}`,
          background: "rgba(255,255,255,0.55)",
        }}
      >
        <button
          style={{ ...pill, background: THEME.salbei }}
          disabled={schritt === 1}
          onClick={() => setSchritt((s) => Math.max(1, s - 1))}
        >
          ← Zurück
        </button>
        <button
          style={pill}
          disabled={schritt === 5 || !erreichbar(schritt + 1)}
          onClick={() => setSchritt((s) => Math.min(5, s + 1))}
        >
          Weiter →
        </button>
      </nav>

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

      {editorOffen && (
        <RaumEditor
          onAbbruch={() => setEditorOffen(false)}
          onFertig={(neu) => {
            // Gleicher Klickpfad wie scanLaden: Raum in die Liste, dann wählen.
            setRooms((prev) => [neu, ...prev.filter((r) => r.id !== neu.id)]);
            void raumWaehlen(neu);
            setEditorOffen(false);
            setMeldung("Raum erstellt.");
          }}
        />
      )}

      {korrektur && (
        <ScanKorrektur
          room={korrektur.room}
          warnungen={korrektur.warnungen}
          onAbbruch={() => {
            // Abbrechen: Scan trotzdem UNKORRIGIERT laden (geometryConfirmed bleibt
            // false → Konfidenz-Ampel rechnet weiter mit Messunsicherheit).
            const neu = korrektur.room;
            setRooms((prev) => [neu, ...prev.filter((r) => r.id !== neu.id)]);
            void raumWaehlen(neu);
            setKorrektur(null);
            setMeldung("Scan unkorrigiert übernommen.");
          }}
          onFertig={(neu) => {
            // Korrigierten Raum in die Liste (gleiche id ersetzt) und wählen.
            setRooms((prev) => [neu, ...prev.filter((r) => r.id !== neu.id)]);
            void raumWaehlen(neu);
            setKorrektur(null);
            setMeldung("Scan korrigiert übernommen.");
          }}
        />
      )}
    </div>
  );
}
