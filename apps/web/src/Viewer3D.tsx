/** 3D-Viewer v2: Raumhülle + Plan als Möbel-Kompositionen, jetzt mit
 *  Ansichts-Presets, zwei Begehungsmodi (Orbit/Begehung), direkter Objekt-
 *  Interaktion (Drag auf Bodenebene, Doppelklick = +90°), Ebenen-Toggles und
 *  wählbaren Oberflächen (Klick auf Boden/Wand → Variantenwahl in der Karte).
 *
 *  Reine Rechenlogik (Preset-Posen, Begehungs-Schrittvektor, Raum-BBox) lebt in
 *  `viewer3d-logik.ts` (getestet); hier bleibt nur das r3f-Rendering/Verdrahten.
 *  Box-Platzhalter-Prinzip und die dominierende Norm-Ampel sind unverändert.
 */
import { ContactShadows, Environment, Lightformer, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type ComponentRef, type CSSProperties } from "react";
import { ACESFilmicToneMapping, Euler, Shape, Vector3, type Camera } from "three";
import type { DressingItem, KatalogItem, Placement, Plan, Room } from "./api";
import { DressingLayer3D } from "./dressing3d.tsx";
import { materialFarbe, Moebel3D } from "./moebel3d.tsx";
import {
  leiteOberflaechen,
  loeseBodenSpez,
  loeseWandZonen,
  wendeVariantenAn,
  type BodenSpez,
  type FlaechenKonzept,
  type WandZonen,
} from "./oberflaechen";
import type { OberflaechenWahl } from "./oberflaechen";
import { bodenTextur, WandMitOeffnungen } from "./raum3d.tsx";
import type { WandOeffnung } from "./raum3d";
import type { Stilprofil } from "./Stil";
import { THEME } from "./theme";
import {
  AUGENHOEHE,
  begehungStart,
  bewegungsDelta,
  blickRichtung,
  presetKamera,
  raumBBox,
  RAUMHOEHE_FALLBACK,
  type Ansichtspreset,
  type Begehungsmodus,
} from "./viewer3d-logik";

const FARBE_VERLETZT = "#c0392b";
const FARBE_KNAPP = "#e67e22";
const FARBE_GEWAEHLT = THEME.orange;
const FARBE_GESPERRT = "#7a7a7a";

/** Auswählbare Fläche der Raumhülle (Boden bzw. Wände als Ganzes). */
export type FlaechenWahl = "boden" | "wand";

type Status = "verletzt" | "knapp";

function Boden({
  room,
  boden,
  gewaehlt,
  onFlaeche,
}: {
  room: Room;
  boden: BodenSpez;
  gewaehlt: boolean;
  onFlaeche?: (f: FlaechenWahl, e: ThreeEvent<MouseEvent>) => void;
}) {
  const shape = new Shape();
  const poly = room.shell.floor.polygon;
  const textur = useMemo(
    () => bodenTextur(boden),
    [boden.muster, boden.grundfarbe, boden.fugenfarbe, boden.masse_m],
  );
  const start = poly[0];
  if (!start) return null;
  shape.moveTo(start[0], start[1]);
  for (const p of poly.slice(1)) shape.lineTo(p[0], p[1]);
  shape.closePath();
  return (
    <mesh
      rotation={[Math.PI / 2, 0, 0]}
      position={[0, 0, 0]}
      onClick={onFlaeche ? (e) => onFlaeche("boden", e) : undefined}
    >
      <shapeGeometry args={[shape]} />
      <meshStandardMaterial
        color={textur ? "#ffffff" : boden.grundfarbe}
        map={textur ?? undefined}
        side={2}
        emissive={gewaehlt ? FARBE_GEWAEHLT : "#000000"}
        emissiveIntensity={gewaehlt ? 0.22 : 0}
      />
    </mesh>
  );
}

/** Gewählte Wandfläche solid einfärben (Highlight) – Muster aus, damit das Orange
 *  auch auf texturierten Zonen sichtbar bleibt. */
const HIGHLIGHT: WandZonen = {
  basis: { muster: "uni", farbe: FARBE_GEWAEHLT, fugenfarbe: FARBE_GEWAEHLT, masse_m: 0.3 },
  zone: null,
};
// Rein defensiver Fallback (loeseWandZonen liefert immer genau `wandAnzahl`
// Einträge – dieser greift nur, falls doch ein Index fehlt).
const NEUTRAL: WandZonen = {
  basis: { muster: "uni", farbe: "#d8d2c4", fugenfarbe: "#9b9689", masse_m: 0.3 },
  zone: null,
};

function Waende({
  room,
  zonen,
  sichtbar,
  gewaehlt,
  onFlaeche,
}: {
  room: Room;
  /** Zonen je Wand, Index = Position in room.shell.walls (aus loeseWandZonen). */
  zonen: WandZonen[];
  sichtbar: boolean;
  gewaehlt: boolean;
  onFlaeche?: (f: FlaechenWahl, e: ThreeEvent<MouseEvent>) => void;
}) {
  const proWand = new Map<string, WandOeffnung[]>();
  for (const o of room.openings) {
    const eintrag = o as (typeof room.openings)[number] & { height?: number };
    const liste = proWand.get(eintrag.hostWall) ?? [];
    liste.push({
      type: eintrag.type,
      offset: eintrag.offset,
      width: eintrag.width,
      height: eintrag.height ?? (eintrag.type === "door" ? 2.0 : 1.2),
      sill: eintrag.sill,
    });
    proWand.set(eintrag.hostWall, liste);
  }
  if (!sichtbar) return null;
  return (
    <group onClick={onFlaeche ? (e) => onFlaeche("wand", e) : undefined}>
      {room.shell.walls.map((w, i) => {
        const z = gewaehlt ? HIGHLIGHT : (zonen[i] ?? NEUTRAL);
        return (
          <WandMitOeffnungen
            key={w.id}
            wand={w as Parameters<typeof WandMitOeffnungen>[0]["wand"]}
            oeffnungen={proWand.get(w.id) ?? []}
            basis={z.basis}
            zone={z.zone}
          />
        );
      })}
    </group>
  );
}

function PlacementBox({
  placement,
  item,
  gewaehlt,
  status,
  ampelAn,
  onClick,
}: {
  placement: Placement;
  item: KatalogItem;
  gewaehlt: boolean;
  status: Status | undefined;
  ampelAn: boolean;
  onClick: () => void;
}) {
  const { w, d, h } = item.masse;
  const y = (placement.mountHeight ?? 0) + h / 2;
  // Ampel dominiert: nur bei Status «ok» zeigt das Möbel seine Materialfarbe.
  const farbe = gewaehlt
    ? FARBE_GEWAEHLT
    : ampelAn && status === "verletzt"
      ? FARBE_VERLETZT
      : ampelAn && status === "knapp"
        ? FARBE_KNAPP
        : ampelAn && placement.locked
          ? FARBE_GESPERRT
          : materialFarbe(item.funktionsTyp);
  // 3D ist reine Ansicht/Begehung: Klick wählt aus (öffnet die Produktkarte),
  // aber Möbel werden hier NICHT mehr verschoben/gedreht – das Bearbeiten läuft
  // über den 2D-Grundriss (Bryan 2026-07-07).
  return (
    <group
      position={[placement.pose.pos[0], y, placement.pose.pos[1]]}
      rotation={[0, (-placement.pose.yawDeg * Math.PI) / 180, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Moebel3D
        funktionsTyp={item.funktionsTyp}
        modell3d={item.modell3d}
        w={w}
        d={d}
        h={h}
        farbe={farbe}
      />
    </group>
  );
}

/** Orbit-/Preset-Kamerasteuerung: setzt Kamera + OrbitControls-Ziel bei jedem
 *  Preset-Wechsel neu (animationsfrei, Bryan ok). */
function KameraSteuerung({
  preset,
  bboxKey,
  pose,
}: {
  preset: Ansichtspreset;
  bboxKey: string;
  pose: ReturnType<typeof presetKamera>;
}) {
  const ref = useRef<ComponentRef<typeof OrbitControls>>(null);
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(...pose.position);
    const c = ref.current;
    if (c) {
      c.target.set(...pose.target);
      c.update();
    } else {
      camera.lookAt(...pose.target);
    }
    // preset + bboxKey als Auslöser: nur bei Preset-/Raumwechsel neu setzen.
  }, [preset, bboxKey]);
  return <OrbitControls ref={ref} makeDefault maxPolarAngle={Math.PI / 2.05} />;
}

/** First-Person-Begehung: Drag = umsehen (Yaw/Pitch), WASD/Pfeile = bewegen,
 *  Doppeltipp = ein Schritt vorwärts (Touch). Bodenhöhe (Augenhöhe) bleibt fix.
 *  Kollision mit Wänden ist bewusst NICHT modelliert (POC, Bryan). */
function Begehung({ start }: { start: ReturnType<typeof begehungStart> }) {
  const { camera, gl } = useThree();
  const yaw = useRef(0);
  const pitch = useRef(0);
  const tasten = useRef<Set<string>>(new Set());

  useEffect(() => {
    camera.position.set(start.position[0], AUGENHOEHE, start.position[2]);
    yaw.current = 0;
    pitch.current = 0;
  }, [start.position[0], start.position[2]]);

  // Drag zum Umsehen (Maus & Touch); Doppeltipp = Schritt vorwärts.
  useEffect(() => {
    const el = gl.domElement;
    let ziehen = false;
    let lx = 0;
    let ly = 0;
    let letzterTipp = 0;
    const down = (e: PointerEvent) => {
      ziehen = true;
      lx = e.clientX;
      ly = e.clientY;
      const jetzt = performance.now();
      if (jetzt - letzterTipp < 300) {
        const r = blickRichtung(yaw.current);
        camera.position.x += r[0] * 0.5;
        camera.position.z += r[1] * 0.5;
      }
      letzterTipp = jetzt;
    };
    const move = (e: PointerEvent) => {
      if (!ziehen) return;
      yaw.current += (e.clientX - lx) * 0.005;
      pitch.current = Math.max(-1.4, Math.min(1.4, pitch.current - (e.clientY - ly) * 0.005));
      lx = e.clientX;
      ly = e.clientY;
    };
    const up = () => {
      ziehen = false;
    };
    el.style.touchAction = "none";
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [gl, camera]);

  // WASD/Pfeiltasten (nur solange die Begehung montiert ist).
  useEffect(() => {
    const down = (e: KeyboardEvent) => tasten.current.add(e.key.toLowerCase());
    const up = (e: KeyboardEvent) => tasten.current.delete(e.key.toLowerCase());
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  useFrame((_, delta) => {
    const t = tasten.current;
    const vor =
      (t.has("w") || t.has("arrowup") ? 1 : 0) - (t.has("s") || t.has("arrowdown") ? 1 : 0);
    const seit =
      (t.has("d") || t.has("arrowright") ? 1 : 0) - (t.has("a") || t.has("arrowleft") ? 1 : 0);
    if (vor !== 0 || seit !== 0) {
      const [dx, dz] = bewegungsDelta(blickRichtung(yaw.current), vor, seit, delta * 2.4);
      camera.position.x += dx;
      camera.position.z += dz;
    }
    camera.position.y = AUGENHOEHE;
    // Blickrichtung aus Yaw/Pitch: aus dem Zentrum heraus schauen.
    const richtung = new Vector3(0, 0, -1).applyEuler(
      new Euler(pitch.current, -yaw.current, 0, "YXZ"),
    );
    lookAtDir(camera, richtung);
  });
  return null;
}

/** Kamera in Blickrichtung `dir` ausrichten (dir muss nicht normiert sein). */
function lookAtDir(camera: Camera, dir: Vector3): void {
  const ziel = new Vector3().copy(camera.position).add(dir);
  camera.lookAt(ziel);
}

/**
 * Prozedurale Studio-Environment – komplett OFFLINE, ohne Netz-HDRI.
 *
 * Warum kein `<Environment preset=…>`: die drei-Presets laden HDRIs von
 * polyhaven/GitHub – auf dem HF-Space (strikte CSP, kein verlässliches Netz)
 * schlägt das fehl. Stattdessen rendert drei aus den `<Lightformer>`-Kindern
 * eine eigene kleine Umgebungs-Szene (einmalig, `frames={1}`) in eine
 * Cube-Map. Das gibt Chrom echte Reflexe und Glas Tiefe, ohne jeglichen
 * externen Asset.
 *
 * Lichtaufbau (Softbox-Studio): grosse warmweisse Deckenfläche als Hauptlicht,
 * zwei kühlere Seitenstreifen für plastische Kanten-Reflexe, dezenter warmer
 * Boden-Bounce. `background={false}` (Default): die Environment beleuchtet/
 * spiegelt nur – der neutrale Canvas-Hintergrund bleibt, damit die Ampelfarben
 * klar lesbar bleiben. `resolution` klein gehalten (Performance-Wächter).
 */
function Studioumgebung() {
  return (
    <Environment resolution={128} frames={1} environmentIntensity={0.55}>
      {/* Hauptlicht: grosse weiche Deckenfläche, warmweiss, von oben herab */}
      <Lightformer
        form="rect"
        intensity={1.3}
        color="#fff2e0"
        position={[0, 6, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[14, 14, 1]}
      />
      {/* Kühler Seitenstreifen links – plastische Kanten an Chrom/Glas */}
      <Lightformer
        form="rect"
        intensity={0.75}
        color="#dbe6ff"
        position={[-7, 2.5, 0]}
        rotation={[0, Math.PI / 2, 0]}
        scale={[9, 5, 1]}
      />
      {/* Kühler Seitenstreifen rechts */}
      <Lightformer
        form="rect"
        intensity={0.75}
        color="#dbe6ff"
        position={[7, 2.5, 0]}
        rotation={[0, -Math.PI / 2, 0]}
        scale={[9, 5, 1]}
      />
      {/* Dezenter, warmer Boden-Bounce (schwach) – füllt Unterseiten auf */}
      <Lightformer
        form="rect"
        intensity={0.3}
        color="#efe4d4"
        position={[0, -4, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[14, 14, 1]}
      />
    </Environment>
  );
}

// ── Bedienleiste ────────────────────────────────────────────────────────────

const PRESETS: [Ansichtspreset, string][] = [
  ["perspektive", "Perspektive"],
  ["draufsicht", "Draufsicht"],
  ["front", "Front"],
  ["seite", "Seite"],
];

function knopfStil(aktiv: boolean, farbe: string = THEME.gruen): CSSProperties {
  return {
    borderRadius: 999,
    padding: "5px 11px",
    fontSize: 12,
    cursor: "pointer",
    border: `1px solid ${aktiv ? farbe : THEME.salbei}`,
    background: aktiv ? farbe : "#fff",
    color: aktiv ? "#fff" : THEME.salbei,
  };
}

function Bedienleiste({
  preset,
  onPreset,
  modus,
  onModus,
  ampel,
  onAmpel,
  waende,
  onWaende,
  deko,
  onDeko,
  dekoVerfuegbar,
}: {
  preset: Ansichtspreset;
  onPreset: (p: Ansichtspreset) => void;
  modus: Begehungsmodus;
  onModus: (m: Begehungsmodus) => void;
  ampel: boolean;
  onAmpel: () => void;
  waende: boolean;
  onWaende: () => void;
  deko: boolean;
  onDeko: () => void;
  /** «Deko»-Knopf nur zeigen, wenn Scene-Dressing-Daten vorliegen. */
  dekoVerfuegbar: boolean;
}) {
  const trenner = (
    <span
      style={{ width: 1, height: 20, background: THEME.salbei, opacity: 0.4, margin: "0 2px" }}
    />
  );
  const begehung = modus === "begehung";
  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        flexWrap: "wrap",
        padding: "0 0 8px",
        alignItems: "center",
      }}
    >
      {PRESETS.map(([p, label]) => (
        <button
          key={p}
          type="button"
          onClick={() => onPreset(p)}
          style={knopfStil(preset === p && !begehung)}
          aria-pressed={preset === p && !begehung}
          disabled={begehung}
        >
          {label}
        </button>
      ))}
      {trenner}
      <button
        type="button"
        onClick={() => onModus("orbit")}
        style={knopfStil(!begehung)}
        aria-pressed={!begehung}
      >
        🌀 Orbit
      </button>
      <button
        type="button"
        onClick={() => onModus("begehung")}
        style={knopfStil(begehung, THEME.orange)}
        aria-pressed={begehung}
      >
        🚶 Begehung
      </button>
      {trenner}
      <button type="button" onClick={onAmpel} style={knopfStil(ampel)} aria-pressed={ampel}>
        Ampel
      </button>
      <button type="button" onClick={onWaende} style={knopfStil(waende)} aria-pressed={waende}>
        Wände
      </button>
      {dekoVerfuegbar && (
        <button type="button" onClick={onDeko} style={knopfStil(deko)} aria-pressed={deko}>
          Deko
        </button>
      )}
    </div>
  );
}

export function Viewer3D({
  room,
  placements,
  catalog,
  gewaehltId,
  statusById,
  onSelect,
  stilprofil,
  plan,
  dressingItems,
  interaktiv = false,
  gewaehlteFlaeche,
  onSelectFlaeche,
  oberflaechenWahl,
  flaechen,
  modus,
  onModus,
}: {
  room: Room;
  placements: Placement[];
  catalog: KatalogItem[];
  /** Voller Plan (für Scene-Dressing: Anker + Seed). Nur lesend genutzt. */
  plan?: Plan | null;
  /** Scene-Dressing-Stammdaten des Raumtyps (rein visuelle Deko-Ebene). */
  dressingItems?: DressingItem[];
  gewaehltId: string | null;
  statusById: Map<string, Status>;
  onSelect: (id: string | null) => void;
  stilprofil?: Stilprofil | null;
  /** Flächenwahl (Oberflächen) aktiv. Möbel werden im 3D NICHT bearbeitet –
   *  Verschieben/Drehen läuft nur im 2D-Grundriss (Bryan 2026-07-07). */
  interaktiv?: boolean;
  /** Aktuell gewählte Oberfläche (Boden/Wand) – zeigt die Oberflächen-Karte. */
  gewaehlteFlaeche?: FlaechenWahl | null;
  /** Klick auf Boden/Wand (kein Möbel getroffen) wählt die Fläche. */
  onSelectFlaeche?: (f: FlaechenWahl | null) => void;
  /** Lokale, rein visuelle Oberflächen-Variantenwahl (überschreibt die Stil-Spez). */
  oberflaechenWahl?: OberflaechenWahl | null;
  /** Flächen-Konzept des Kurators (Boden-/Wand-Material je Wand). Fehlt es
   *  (Baseline/alte Pläne) → stilabgeleiteter Fallback, exakt wie bisher. */
  flaechen?: FlaechenKonzept | null;
  /** Begehungsmodus (in App gehalten, damit die Möbel-Pfeiltasten dort ruhen). */
  modus: Begehungsmodus;
  onModus: (m: Begehungsmodus) => void;
}) {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const bbox = raumBBox(room.shell.floor.polygon);
  const raumHoehe =
    (room.shell.walls[0] as { height?: number } | undefined)?.height ?? RAUMHOEHE_FALLBACK;

  const [preset, setPreset] = useState<Ansichtspreset>("perspektive");
  const [ampel, setAmpel] = useState(true);
  const [waende, setWaende] = useState(true);
  const [deko, setDeko] = useState(true);
  // Deko rendern, sobald ein Plan (Anker + Seed) und Stammdaten vorliegen.
  const dressingAn = deko && !!plan && (dressingItems?.length ?? 0) > 0;

  const basis = leiteOberflaechen(stilprofil ?? null, room.roomType);
  const spez = wendeVariantenAn(basis, room.roomType, oberflaechenWahl);
  // Flächen-Konzept anwenden: Kurator-Material schlägt die Stil-/Varianten-Optik;
  // ohne `flaechen` bleiben bodenSpez/wandZonen exakt die stilabgeleitete Optik.
  const bodenSpez = loeseBodenSpez(spez.boden, flaechen);
  const wandZonen = loeseWandZonen(spez.wand, flaechen, room.shell.walls.length);

  // Raum-/Preset-Wechsel: Kamera-Pose neu berechnen; bboxKey erzwingt Reset.
  const bboxKey = `${bbox.cx.toFixed(2)}:${bbox.cz.toFixed(2)}:${bbox.breite.toFixed(2)}`;
  const orbitPose = presetKamera(bbox, preset, raumHoehe);
  const startPose = begehungStart(bbox);

  const flaecheKlick =
    interaktiv && onSelectFlaeche
      ? (f: FlaechenWahl, e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          onSelectFlaeche(f);
        }
      : undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%" }}>
      <Bedienleiste
        preset={preset}
        onPreset={setPreset}
        modus={modus}
        onModus={onModus}
        ampel={ampel}
        onAmpel={() => setAmpel((a) => !a)}
        waende={waende}
        onWaende={() => setWaende((w) => !w)}
        deko={deko}
        onDeko={() => setDeko((x) => !x)}
        dekoVerfuegbar={!!plan && (dressingItems?.length ?? 0) > 0}
      />
      {modus === "begehung" && (
        <p style={{ fontSize: 11, color: THEME.salbei, margin: "0 0 6px" }}>
          Ziehen = umsehen · WASD/Pfeile = gehen · Doppeltipp = vorwärts
        </p>
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        <Canvas
          // dpr gedeckelt (≤2) + ACESFilmic-Tonemapping für ein wärmeres, weniger
          // flaches Bild; leichte Exposure-Anhebung. outputColorSpace bleibt der
          // r3f-Default (sRGB). Kein Post-Processing (bewusst schlank).
          dpr={[1, 2]}
          gl={{ toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
          camera={{ position: orbitPose.position, fov: 50 }}
          onPointerMissed={() => {
            onSelect(null);
            onSelectFlaeche?.(null);
          }}
        >
          {/* Prozedurale Environment → echte Reflexe auf Chrom/Glas (offline). */}
          <Studioumgebung />
          {/* Ambient dezenter (Environment liefert jetzt das Fülllicht); ein
           *  gerichtetes Licht bleibt für scharfe Highlights/Modellierung. */}
          <ambientLight intensity={0.35} />
          <directionalLight position={[4, 6, 3]} intensity={0.9} />
          {/* Weicher Kontaktschatten unter den Objekten: EINE Depth-Pass-Textur
           *  statt teurer Shadow-Maps je Licht – stabil & günstig für viele
           *  kleine Möbel-Meshes, keine Bias-/Flacker-Probleme mit den
           *  halbtransparenten Wänden. Auf Bodenhöhe zentriert. */}
          <ContactShadows
            position={[bbox.cx, 0.01, bbox.cz]}
            scale={Math.max(bbox.breite, bbox.tiefe, 2) + 1}
            resolution={1024}
            far={raumHoehe}
            blur={2.4}
            opacity={0.38}
            color="#243D35"
          />
          <Boden
            room={room}
            boden={bodenSpez}
            gewaehlt={gewaehlteFlaeche === "boden"}
            onFlaeche={flaecheKlick}
          />
          <Waende
            room={room}
            zonen={wandZonen}
            sichtbar={waende}
            gewaehlt={gewaehlteFlaeche === "wand"}
            onFlaeche={flaecheKlick}
          />
          {placements.map((p) => {
            const item = byId.get(p.catalogItemId);
            if (!item) return null;
            return (
              <PlacementBox
                key={p.id}
                placement={p}
                item={item}
                gewaehlt={p.id === gewaehltId}
                status={statusById.get(p.id)}
                ampelAn={ampel}
                onClick={() => onSelect(p.id)}
              />
            );
          })}
          {dressingAn && plan && (
            <DressingLayer3D
              room={room}
              plan={plan}
              catalog={catalog}
              styleProfile={stilprofil ?? null}
              dressingItems={dressingItems ?? []}
              sichtbar
            />
          )}
          {modus === "orbit" ? (
            <KameraSteuerung preset={preset} bboxKey={bboxKey} pose={orbitPose} />
          ) : (
            <Begehung start={startPose} />
          )}
        </Canvas>
      </div>
    </div>
  );
}
