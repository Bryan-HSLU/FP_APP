/** M3-Klickpfad, jetzt als Schritt-für-Schritt-Wizard (CI-UX-Kreislauf):
 *  1 Projekt → 2 Stil → 3 Vorschlag → 4 Anpassen → 5 Auswertung & Export.
 *  Nach jeder Auswahl einen Schritt weiter; die bisherige UI-Logik/Callbacks
 *  bleiben unverändert – nur die Anzeige ist pro Schritt gruppiert.
 *
 *  Live-Regel-Feedback läuft CLIENTSEITIG über den TS-Interpreter aus
 *  @fp/shared – dieselben Regel-JSONs wie der Server (Regel-Parität).
 */
import { buildScene, evaluateRules, type ConstraintReport, type Rule } from "@fp/shared/rules";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  ApiFehler,
  type Arbeitsdreieck,
  type DressingItem,
  type KatalogItem,
  type KuechenForm,
  type KV,
  type Plan,
  type Room,
} from "./api";
import { AppRahmen } from "./AppRahmen";
import { Splash, StartMenue } from "./StartMenue";
import { RaumEditor } from "./RaumEditor";
import { ScanKorrektur } from "./ScanKorrektur";
import { SchrittAnpassen } from "./SchrittAnpassen";
import { SchrittAuswertung } from "./SchrittAuswertung";
import { SchrittProjekt, type RaumtypKey } from "./SchrittProjekt";
import { SchrittStil } from "./SchrittStil";
import { SchrittVorschlag } from "./SchrittVorschlag";
import { type Achse, type BildItem, type Stilprofil } from "./Stil";
import { CSS, THEME } from "./theme";
import { Viewer2D } from "./Viewer2D";
import { Viewer3D, type FlaechenWahl } from "./Viewer3D";
import {
  leiteOberflaechen,
  variantenFuer,
  wendeVariantenAn,
  type FlaechenKonzept,
  type OberflaechenWahl,
} from "./oberflaechen";
import type { Begehungsmodus } from "./viewer3d-logik";

// UI-Redesign Etappe B: Die fünf Schritt-Inhalte leben jetzt in eigenen
// Schritt*-Komponenten (SchrittProjekt/Stil/Vorschlag/Anpassen/Auswertung).
// App.tsx hält weiterhin State, Callbacks, Live-Ampel und Navigation – die
// bestehende Logik ist unverändert, nur die Präsentation ist ausgelagert.

export function App() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [room, setRoom] = useState<Room | null>(null);
  const [catalog, setCatalog] = useState<KatalogItem[]>([]);
  const [dressingItems, setDressingItems] = useState<DressingItem[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [seed, setSeed] = useState(1);
  const [gewaehltId, setGewaehltId] = useState<string | null>(null);
  const [kv, setKv] = useState<KV | null>(null);
  const [meldung, setMeldung] = useState<string>("");
  const [bilder, setBilder] = useState<BildItem[]>([]);
  const [achsen, setAchsen] = useState<Achse[]>([]);
  const [stilprofil, setStilprofil] = useState<Stilprofil | null>(null);
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
  // 3D-Viewer: Begehungsmodus (in App gehalten, damit die Möbel-Pfeiltasten im
  // Begehungsmodus ruhen und nicht mit der WASD-Kamera kollidieren).
  const [viewer3dModus, setViewer3dModus] = useState<Begehungsmodus>("orbit");
  // 3D-Viewer: gewählte Oberfläche (Boden/Wand) + rein visuelle Variantenwahl.
  // `oberflaechenWahl` bleibt bewusst über «Variante würfeln» hinweg erhalten
  // (loesen fasst sie nicht an) – nur ein Raumwechsel setzt sie zurück.
  const [flaeche, setFlaeche] = useState<FlaechenWahl | null>(null);
  const [oberflaechenWahl, setOberflaechenWahl] = useState<OberflaechenWahl>({
    boden: null,
    wand: null,
  });
  // Flächen-Konzept des Kurators (Boden-/Wand-Material je Wand), aus /solve.
  // Fehlt es (Küche/Baseline/alte Pläne) → null → stilabgeleiteter Fallback im 3D.
  const [flaechen, setFlaechen] = useState<FlaechenKonzept | null>(null);
  // Scan-Upload (M7 Schritt 4): Raumtyp des hochgeladenen Scan-Bundles.
  const [scanRoomType, setScanRoomType] = useState("bad");
  // Scan-Korrektur-Modus (M7 Schritt 6): geladener Scan wartet auf Korrektur.
  const [korrektur, setKorrektur] = useState<{ room: Room; warnungen: string[] } | null>(null);
  // Einstieg vor dem Wizard: Splash (Logo) → Startmenü → App (Bryan-Wunsch).
  const [phase, setPhase] = useState<"splash" | "menue" | "app">("splash");
  // Wizard: aktueller Schritt (1..5). Schritt-für-Schritt statt alles auf einmal.
  const [schritt, setSchritt] = useState(1);
  // Raumtyp-Vorwahl (Schritt 1): steuert Scan-Raumtyp + filtert Beispielräume.
  const [raumtypVorwahl, setRaumtypVorwahl] = useState<RaumtypKey | null>(null);
  // Ladezustände (Etappe B): hängen die <Ladezustand>-Anzeigen an die await-Stellen.
  const [ladenStil, setLadenStil] = useState(false);
  const [ladenVorschlag, setLadenVorschlag] = useState(false);
  const [ladenDokumente, setLadenDokumente] = useState(false);
  const [ladenScan, setLadenScan] = useState(false);

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
      setFlaeche(null);
      setFlaechen(null);
      setOberflaechenWahl({ boden: null, wand: null });
      // Für Küchen den Katalog/Regeln des effektiven Raumtyps laden.
      const istKueche =
        r.roomType === "kueche" ||
        ((r as Room & { zones?: { roomType: string }[] }).zones ?? []).some(
          (z) => z.roomType === "kueche",
        );
      const effTyp = istKueche ? "kueche" : r.roomType;
      setCatalog(await api.catalog(effTyp));
      // Scene-Dressing-Stammdaten (rein visuelle Deko) je Raumtyp; fehlt der
      // Datensatz (nur «bad» im Durchstich), bleibt die Deko-Ebene einfach leer.
      setDressingItems(await api.dressing(r.roomType).catch(() => []));
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
      setLadenScan(true);
      try {
        const { room: neu, warnungen } = await api.scan(datei, scanRoomType, datei.name);
        setKorrektur({ room: neu, warnungen });
        setMeldung("Scan geladen – bitte korrigieren.");
      } catch (e) {
        setMeldung(
          e instanceof ApiFehler ? `Scan fehlgeschlagen: ${e.message}` : "Scan fehlgeschlagen.",
        );
      } finally {
        setLadenScan(false);
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
      setLadenVorschlag(true);
      try {
        let res: {
          plan: Plan;
          room: Room;
          hinweis?: string;
          arbeitsdreieck?: Arbeitsdreieck;
          flaechen?: FlaechenKonzept | null;
        };
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
          // Flächen-Wünsche des Kurators mit an /solve geben; der Server reicht
          // sie unverändert zurück (res.flaechen) → Optik im 3D-Viewer.
          res = await api.solve(room, s, {
            kurator,
            stilprofilRef: stilprofil?.id,
            flaechen: kurator?.flaechen,
          });
        }
        setPlan(res.plan);
        setFlaechen(res.flaechen ?? null);
        setPlanRoom(res.room);
        setDreieck(res.arbeitsdreieck ?? null);
        setSeed(s);
        // Kein Auto-Sprung mehr: Schritt 3 «Vorschlag» zeigt das Ergebnis selbst
        // (der Nutzer geht per «Ansehen & anpassen» weiter zu Schritt 4). So kann
        // «Neue Variante» aus Schritt 4 dort bleiben, ohne zurückzuspringen.
        if (res.hinweis)
          setMeldung("Hinweis: Geometrie unbestätigt – Ampel rechnet mit Messunsicherheit.");
      } catch (e) {
        if (e instanceof ApiFehler && e.code === "NO_FEASIBLE_PLACEMENT") {
          setMeldung(`Solver ehrlich: ${e.message} – Raum zu klein / Anschlüsse fehlen.`);
          setPlan(null);
        } else throw e;
      } finally {
        setLadenVorschlag(false);
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

  // Absolutes Drehen per Rotations-Griff (Viewer2D). Setzt den Yaw direkt (der
  // Griff rastet bereits auf 15°) – dieselbe Live-Ampel wie beim Ziehen/«r».
  const rotiereNach = useCallback((id: string, yawDeg: number) => {
    setKv(null);
    setPlan((prev) =>
      prev
        ? {
            ...prev,
            status: "bearbeitet",
            placements: prev.placements.map((p) =>
              p.id !== id || p.locked
                ? p
                : {
                    ...p,
                    source: "user",
                    pose: { ...p.pose, yawDeg: ((yawDeg % 360) + 360) % 360 },
                  },
            ),
          }
        : prev,
    );
  }, []);

  // Auswahl Möbel ↔ Oberfläche schliessen sich gegenseitig aus (eine Karte).
  // Möbelwahl UND Abwählen (id=null) beenden immer die Oberflächen-Auswahl.
  const waehleItem = useCallback((id: string | null) => {
    setGewaehltId(id);
    setFlaeche(null);
  }, []);
  const waehleFlaeche = useCallback((f: FlaechenWahl | null) => {
    setFlaeche(f);
    if (f !== null) setGewaehltId(null);
  }, []);
  // Oberflächen-Variante wählen (rein visuell, kein Schema-/API-Eingriff).
  const flaecheVariante = useCallback((art: FlaechenWahl, id: string) => {
    setOberflaechenWahl((prev) => ({ ...prev, [art]: id }));
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Im 3D-Begehungsmodus steuert WASD/Pfeile die Kamera – dann keine
      // Möbel-Pfeiltasten (Konflikt vermeiden).
      if (ansicht === "3d" && viewer3dModus === "begehung") return;
      const schrittW = 0.05;
      if (e.key === "ArrowLeft") bewege(-schrittW, 0);
      if (e.key === "ArrowRight") bewege(schrittW, 0);
      if (e.key === "ArrowUp") bewege(0, -schrittW);
      if (e.key === "ArrowDown") bewege(0, schrittW);
      if (e.key === "r") bewege(0, 0, 90);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [bewege, ansicht, viewer3dModus]);

  const auswerten = useCallback(async () => {
    if (!room || !plan) return;
    setLadenDokumente(true);
    try {
      setKv(await api.evaluate(room, plan));
    } finally {
      setLadenDokumente(false);
    }
  }, [room, plan]);

  // Schritt 5 «Auswertung»: die Kostenschätzung beim Betreten automatisch laden,
  // damit die Zusammenfassungs-Karte direkt Zahlen zeigt (nutzt `auswerten`).
  useEffect(() => {
    if (schritt === 5 && plan && !kv && !ladenDokumente) void auswerten();
  }, [schritt, plan, kv, ladenDokumente, auswerten]);

  // Stilprofil FINAL berechnen (Schritt 2: «Weiter mit diesem Profil», letztes
  // Bild oder Preset). Danach automatisch weiter zu Schritt 3 «Vorschlag» –
  // das Profil steht dann fest, der Nutzer hat es bestätigt.
  const stilBerechnen = useCallback(
    (likes: string[], dislikes: string[], presetId: string | null) => {
      if (!room) return;
      setLadenStil(true);
      api
        .styleProfile(room.roomType, likes, dislikes, presetId)
        .then((p) => {
          setStilprofil(p);
          setSchritt(3);
        })
        .catch(() => setMeldung("Stilprofil konnte nicht berechnet werden."))
        .finally(() => setLadenStil(false));
    },
    [room],
  );

  // Live-Zwischenprofil (Schritt 2, nach JEDER Bewertung): nur das Profil neu
  // rechnen und anzeigen – KEIN Ladezustand (der würde die Swipe-Karte
  // verdecken) und KEIN Schrittwechsel. api.styleProfile ist deterministisch
  // und billig; Fehler bleiben still (Live-Feedback, kein Blocker).
  const stilZwischenprofil = useCallback(
    (likes: string[], dislikes: string[]) => {
      if (!room) return;
      api
        .styleProfile(room.roomType, likes, dislikes, null)
        .then(setStilprofil)
        .catch(() => {});
    },
    [room],
  );

  // Dokument-Download (Schritt 5) – Blob über den bestehenden Export-Endpunkt.
  const dokumentLaden = useCallback(
    (pfad: string, datei: string) => {
      if (!room || !plan) return;
      void api
        .dokument(pfad, datei, room, plan)
        .catch(() => setMeldung("Download fehlgeschlagen."));
    },
    [room, plan],
  );

  // Raumtyp-Vorwahl (Schritt 1): steuert zugleich den Scan-Raumtyp.
  const vorwahlSetzen = useCallback((typ: RaumtypKey) => {
    setRaumtypVorwahl(typ);
    setScanRoomType(typ);
  }, []);

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

  // Oberflächen-Karte (Schritt 4): angebotene Varianten + effektive Spez des
  // aktuellen Raums (Stil-Ableitung, lokal von der Nutzerwahl überschrieben).
  const oberflaechenVarianten = aktuellerRaum ? variantenFuer(aktuellerRaum.roomType) : null;
  const aktuelleSpez = aktuellerRaum
    ? wendeVariantenAn(
        leiteOberflaechen(stilprofil ?? null, aktuellerRaum.roomType),
        aktuellerRaum.roomType,
        oberflaechenWahl,
      )
    : null;

  // Gesperrt-/Normstatus des aktuell gewählten Placements (Schritt 4).
  const gesperrt = !!(plan && gewaehltId
    ? plan.placements.find((p) => p.id === gewaehltId)?.locked
    : false);
  const elementStatus = gewaehltId ? statusById.get(gewaehltId) : undefined;

  // Korrektur-Modus erneut öffnen – nur für gescannte Räume (captureMethod "ar").
  const korrigierbar =
    !!room && (room.meta as { captureMethod?: string } | undefined)?.captureMethod === "ar";

  // Erreichbarkeit der Schritte: 1/2 immer, 3 nur mit Raum, 4/5 nur mit Plan.
  const erreichbar = (nr: number) => (nr <= 2 ? true : nr === 3 ? !!room : !!plan);
  // Am weitesten freigeschalteter Schritt (für den Fortschrittsweg): mit Plan
  // sind alle 5 offen, mit Raum bis 3, sonst bis 2.
  const maxErreicht = plan ? 5 : room ? 3 : 2;

  // Viewer-Bereich (Schritt 4): 2D/3D-Umschalter + Viewer in fester Höhe, damit
  // der Canvas verlässlich füllt (kein Flex/Grid-Höhenproblem im fp-two-column).
  const viewerBereich = (
    <div style={{ display: "flex", flexDirection: "column", height: "min(72vh, 640px)" }}>
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          padding: "0 0 8px",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          className={CSS.button}
          onClick={() => {
            setAnsicht((a) => (a === "2d" ? "3d" : "2d"));
            setFlaeche(null); // Oberflächen-Karte gehört zum 3D-Kontext.
          }}
          style={{
            borderRadius: 999,
            padding: "7px 14px",
            cursor: "pointer",
            border: `1px solid ${THEME.gruen}`,
            background: "#fff",
            color: THEME.gruen,
          }}
        >
          {ansicht === "2d" ? "🧊 3D-Ansicht" : "🗺️ 2D-Grundriss"}
        </button>
        {plan && (
          <span style={{ fontSize: 12, color: THEME.salbei }}>
            Seed {plan.meta.seed} · Solver {plan.meta.solverVersion}
          </span>
        )}
      </div>
      <div className={CSS.card} style={{ flex: 1, minHeight: 0, overflow: "hidden", padding: 6 }}>
        {aktuellerRaum &&
          (ansicht === "2d" ? (
            <Viewer2D
              room={aktuellerRaum}
              placements={plan?.placements ?? []}
              catalog={catalog}
              rules={rules}
              gewaehltId={gewaehltId}
              statusById={statusById}
              onSelect={waehleItem}
              onMove={verschiebeNach}
              onRotate={rotiereNach}
              interaktiv
            />
          ) : (
            <Viewer3D
              room={aktuellerRaum}
              placements={plan?.placements ?? []}
              catalog={catalog}
              gewaehltId={gewaehltId}
              statusById={statusById}
              onSelect={waehleItem}
              stilprofil={stilprofil}
              plan={plan}
              dressingItems={dressingItems}
              interaktiv
              gewaehlteFlaeche={flaeche}
              onSelectFlaeche={waehleFlaeche}
              oberflaechenWahl={oberflaechenWahl}
              flaechen={flaechen}
              modus={viewer3dModus}
              onModus={setViewer3dModus}
            />
          ))}
      </div>
    </div>
  );

  // Einstieg: Splash → Startmenü, erst danach der Wizard. Hooks oben bleiben
  // unverändert aktiv (Daten laden schon im Hintergrund).
  if (phase === "splash") return <Splash onFertig={() => setPhase("menue")} />;
  if (phase === "menue") return <StartMenue onStart={() => setPhase("app")} />;

  return (
    <>
      <AppRahmen
        projektName={room?.name}
        aktuellerSchritt={schritt}
        maxErreichterSchritt={maxErreicht}
        onSchrittWechsel={setSchritt}
        hinweis={meldung || undefined}
        onZurueck={() =>
          // Auf Schritt 1 führt «Zurück» zurück zur Titelseite (Startmenü),
          // sonst einen Wizard-Schritt zurück (Bryan 2026-07-07).
          schritt === 1 ? setPhase("menue") : setSchritt((s) => Math.max(1, s - 1))
        }
        onWeiter={() => setSchritt((s) => Math.min(5, s + 1))}
        zurueckLabel={schritt === 1 ? "← Zur Startseite" : "← Zurück"}
        weiterDeaktiviert={schritt === 5 || !erreichbar(schritt + 1)}
        weiterLabel={schritt === 4 ? "Zur Auswertung" : "Weiter"}
      >
        {schritt === 1 && (
          <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            <SchrittProjekt
              rooms={rooms}
              room={room}
              vorwahl={raumtypVorwahl}
              onVorwahl={vorwahlSetzen}
              onRaumWaehlen={(r) => void raumWaehlen(r)}
              onScanDatei={(f) => void scanLaden(f)}
              onEditorOeffnen={() => setEditorOffen(true)}
              onKorrigieren={() => room && setKorrektur({ room, warnungen: [] })}
              korrigierbar={korrigierbar}
              ladenScan={ladenScan}
            />
          </div>
        )}

        {schritt === 2 && (
          <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            <SchrittStil
              room={room}
              bilder={bilder}
              achsen={achsen}
              stilprofil={stilprofil}
              onProfil={stilBerechnen}
              onZwischenProfil={stilZwischenprofil}
              onUeberspringen={() => setSchritt(3)}
              ladenStil={ladenStil}
            />
          </div>
        )}

        {schritt === 3 && (
          <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            <SchrittVorschlag
              room={room}
              aktuellerRaum={aktuellerRaum}
              catalog={catalog}
              plan={plan}
              report={report}
              statusById={statusById}
              stilprofil={stilprofil}
              begruendung={begruendung}
              seed={seed}
              ladenVorschlag={ladenVorschlag}
              istKueche={kuecheInfo.istKueche}
              grossraum={!!kuecheInfo.zoneId}
              normProfile={normProfile}
              onNormProfile={(np) => {
                setNormProfile(np);
                setFormen(null);
                setForm(null);
              }}
              formen={formen}
              form={form}
              onFormWaehlen={setForm}
              onFormenLaden={() => void formenLaden()}
              onVorschlagen={() => void loesen(seed)}
              onNeueVariante={() => void loesen(seed + 1)}
              onAnpassen={() => setSchritt(4)}
            />
          </div>
        )}

        {schritt === 4 && (
          <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            <SchrittAnpassen
              viewer={viewerBereich}
              gewaehltesItem={gewaehltesItem ?? null}
              elementStatus={elementStatus}
              gesperrt={gesperrt}
              alternativen={alternativen}
              stilprofil={stilprofil}
              onTausch={tauscheItem}
              onSperren={sperren}
              onWuerfeln={() => void loesen(seed + 1)}
              report={report}
              begruendung={begruendung}
              flaeche={flaeche}
              oberflaechenVarianten={oberflaechenVarianten}
              oberflaechenWahl={oberflaechenWahl}
              aktuelleSpez={aktuelleSpez}
              onFlaecheVariante={flaecheVariante}
            />
          </div>
        )}

        {schritt === 5 && (
          <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            <SchrittAuswertung
              room={room}
              plan={plan}
              kv={kv}
              dreieck={dreieck}
              normOk={!!report?.hard.ok}
              ladenDokumente={ladenDokumente}
              onDokument={dokumentLaden}
            />
          </div>
        )}
      </AppRahmen>

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
    </>
  );
}
