/** 2D-Grundriss-Ansicht v2: Plan von oben als SVG.
 *
 *  Macht Pläne normgerecht beurteilbar. Gegenüber v1 neu:
 *  - **Objektsymbole** (Architekten-Draufsicht) statt nur beschrifteter Boxen
 *    (`symbole2d`), gefärbt nach Norm-Ampel bzw. Materialfarbe.
 *  - **Wände wie im CAD-Plan** (`wandBaender`/`innenPolygon`): die Raumkontur
 *    ist die **Aussenkante**, die Wandstärke wächst nach **innen**; Ecken sind
 *    gehrungs-verbunden (geteilte Innenpunkte). Öffnungen sind **echte
 *    Aussparungen in der Wandstärke** (Segmentierung via `wandLuecken`), nicht
 *    bloss Linien auf der Wandoberfläche.
 *  - **Layer-System v2** (`layer2d`): Darstellungs-Layer (globale Toggles) +
 *    Objekt-Layer (jedes Möbel einzeln ein-/ausblendbar, CAD-artig).
 *  - **Platzbedarf-Layer**: Clearance-Zonen (`type:"clearance"`-Regeln) als
 *    Bewegungsflächen vor den Objekten – deckungsgleich mit der Ampel.
 *  - **Messwerkzeug** (zwei Klicks → Distanz, Snap auf Wand-Ecken).
 *  - **Direkte Interaktion**: gewähltes Objekt per Drag verschieben (5-cm-Raster)
 *    und über einen Rotations-Griff in 15°-Schritten drehen.
 *
 *  Footprint-Geometrie kommt aus `plan2d` (= `footprint()` von @fp/shared/rules),
 *  also exakt deckungsgleich mit Solver, Interpreter, Symbolen und 3D-Viewer.
 *  `interaktiv=false` (z.B. Schritt 3, Vorschau) rendert reine Anzeige ohne
 *  Layer-Panel und ohne Editier-Interaktion (Platzbedarf-Layer bleibt aus).
 */
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { frontDir, type Rule, type Vec2 } from "@fp/shared/rules";
import type { KatalogItem, Placement, Room } from "./api";
import {
  DARSTELLUNGS_LAYER,
  defaultLayers,
  objektSichtbar,
  toggleLayer,
  toggleObjekt,
  type LayerId,
} from "./layer2d";
import { materialFarbe } from "./moebel3d";
import {
  clearanceRect,
  computeTransform,
  distanz,
  footprintPoints,
  innenPolygon,
  innwardNormal,
  naechsteEcke,
  rasten,
  toScreen,
  toWorld,
  wandBaender,
  wandEcken,
  yawAusZeiger,
} from "./plan2d.ts";
import { symbolScreenPrims } from "./symbole2d.ts";
import { THEME } from "./theme";

const SIZE = 1000;
const PAD = 48;
const WANDDICKE_FALLBACK = 0.1; // m, falls die Wand keine thickness trägt
const SNAP_ECKE = 0.15; // m, Snapping-Radius Messwerkzeug

const FARBE_VERLETZT = "#c0392b";
const FARBE_KNAPP = "#e67e22";
const FARBE_GESPERRT = "#7a7a7a";
const FARBE_GEWAEHLT = THEME.orange;
const FARBE_NEUTRAL = "#2c2c28";
/** Reiner Planlook (Ampel-Layer aus): schwarzer Stift, weisse Schraffur. */
const FARBE_PLAN = "#1a1a1a";
// Wand-Look nach Referenzbild – unabhängig von der Ampel (Wände sind kein
// Ampel-Objekt): helle Füllung + dünne dunklere Kante.
const WAND_FUELLUNG_MASSIV = "#d3d3d3";
const WAND_FUELLUNG_LEICHT = "#e2e2e2";
const WAND_KANTE = "#9a9a9a";
const FENSTER_GLAS = "#6f8aa0";

type Status = "verletzt" | "knapp";

/** Strichfarbe eines Symbols: Materialfarbe, von der Ampel überstimmt. */
function strichfarbe(
  item: KatalogItem,
  placement: Placement,
  status: Status | undefined,
  ampelAn: boolean,
): string {
  if (ampelAn) {
    if (status === "verletzt") return FARBE_VERLETZT;
    if (status === "knapp") return FARBE_KNAPP;
    if (placement.locked) return FARBE_GESPERRT;
    return materialFarbe(item.funktionsTyp);
  }
  // Ampel-Layer aus → reiner Planlook mit schwarzem Stift (Bryan 2026-07-07).
  return FARBE_PLAN;
}

/** Türschwenk als robuste Polylinie (Viertelkreis von der Wand ins Innere). */
function schwenkPunkte(
  a: Vec2,
  breite: number,
  n: Vec2,
  u: Vec2,
  t: ReturnType<typeof computeTransform>,
): string {
  const dir = Math.sign(u[0] * n[1] - u[1] * n[0]) || 1; // Drehsinn u → n (Welt)
  const schritte = 8;
  const pts: string[] = [];
  for (let k = 0; k <= schritte; k++) {
    const w = (dir * (Math.PI / 2) * k) / schritte;
    const c = Math.cos(w);
    const s = Math.sin(w);
    const wx = a[0] + (u[0] * c - u[1] * s) * breite;
    const wz = a[1] + (u[0] * s + u[1] * c) * breite;
    const [sx, sy] = toScreen([wx, wz], t);
    pts.push(`${sx.toFixed(1)},${sy.toFixed(1)}`);
  }
  return pts.join(" ");
}

/** Eine Öffnung IN der Wandstärke (die Wandfüllung ist an dieser Stelle bereits
 *  ausgespart – hier kommt nur die Tür/Fenster-Signatur in die Lücke).
 *  - Tür: Schwelle + Türblatt-Radius + Viertelkreis-Schwenk ins Rauminnere.
 *  - Fenster: Glas über die volle Wandstärke (Rahmen innen/aussen + Mittellinie). */
function Oeffnung({
  opening,
  room,
  t,
}: {
  opening: Room["openings"][number];
  room: Room;
  t: ReturnType<typeof computeTransform>;
}) {
  const wall = room.shell.walls.find((w) => w.id === opening.hostWall);
  if (!wall) return null;
  const dx = wall.end[0] - wall.start[0];
  const dz = wall.end[1] - wall.start[1];
  const len = Math.hypot(dx, dz) || 1;
  const u: Vec2 = [dx / len, dz / len];
  const dicke = (wall as { thickness?: number }).thickness ?? WANDDICKE_FALLBACK;
  // Normale ins Rauminnere: die Wand wächst von der Aussenkante (Achse, f=0) um
  // die volle Wandstärke nach innen (f=1) – deckungsgleich mit `wandBaender`.
  const nIn = innwardNormal(
    wall.start as Vec2,
    wall.end as Vec2,
    room.shell.floor.polygon as Vec2[],
  );
  const a: Vec2 = [wall.start[0] + u[0] * opening.offset, wall.start[1] + u[1] * opening.offset];
  const b: Vec2 = [a[0] + u[0] * opening.width, a[1] + u[1] * opening.width];
  // Punkt an Laibung `p`, um Anteil `f` der Wandstärke nach innen versetzt.
  const bandPunkt = (p: Vec2, f: number): Vec2 => [
    p[0] + nIn[0] * dicke * f,
    p[1] + nIn[1] * dicke * f,
  ];
  const scr = (p: Vec2, f: number): [number, number] => toScreen(bandPunkt(p, f), t);
  const [aOx, aOy] = scr(a, 0); // Aussenkante an Laibung a
  const [aIx, aIy] = scr(a, 1); // Innenkante an Laibung a
  const [bOx, bOy] = scr(b, 0);
  const [bIx, bIy] = scr(b, 1);

  if (opening.type === "door") {
    // Türblatt-Endpunkt (90° offen, ins Rauminnere) für die Radiuslinie.
    const [lx, ly] = toScreen([a[0] + nIn[0] * opening.width, a[1] + nIn[1] * opening.width], t);
    return (
      <g>
        {/* Schwelle: dünne Linie über die Wandstärke (aussen→innen) je Laibung */}
        <line x1={aOx} y1={aOy} x2={aIx} y2={aIy} stroke={WAND_KANTE} strokeWidth={1} />
        <line x1={bOx} y1={bOy} x2={bIx} y2={bIy} stroke={WAND_KANTE} strokeWidth={1} />
        {/* Türblatt (Radius) + Viertelkreis-Schwenk, ab der Aussenkante */}
        <line x1={aOx} y1={aOy} x2={lx} y2={ly} stroke="#9aa6a0" strokeWidth={1.5} />
        <polyline
          points={schwenkPunkte(a, opening.width, nIn, u, t)}
          fill="none"
          stroke="#9aa6a0"
          strokeWidth={1.5}
        />
      </g>
    );
  }

  // Fenster: Glas IN der Wand – Rahmenlinie an Aussen- und Innenkante (0 / volle
  // Wandstärke) + Mittellinie, alle entlang der Achse; Laibungen schliessen ab.
  const [mAx, mAy] = scr(a, 0.5);
  const [mBx, mBy] = scr(b, 0.5);
  return (
    <g>
      <line x1={aOx} y1={aOy} x2={bOx} y2={bOy} stroke={FENSTER_GLAS} strokeWidth={1.6} />
      <line x1={aIx} y1={aIy} x2={bIx} y2={bIy} stroke={FENSTER_GLAS} strokeWidth={1.6} />
      <line x1={mAx} y1={mAy} x2={mBx} y2={mBy} stroke={FENSTER_GLAS} strokeWidth={1.2} />
      {/* Laibungskanten (schmale Querlinien) schliessen die Lücke sauber ab */}
      <line x1={aOx} y1={aOy} x2={aIx} y2={aIy} stroke={WAND_KANTE} strokeWidth={0.8} />
      <line x1={bOx} y1={bOy} x2={bIx} y2={bIy} stroke={WAND_KANTE} strokeWidth={0.8} />
    </g>
  );
}

/** Symbol eines Placements in Bildschirm-Koordinaten (oder null → Box-Fallback). */
function ObjektSymbol({
  prims,
  farbe,
  schraffur,
}: {
  prims: ReturnType<typeof symbolScreenPrims>;
  farbe: string;
  /** Ampel aus → geschlossene Formen mit weisser Schraffur füllen (Planlook). */
  schraffur: boolean;
}) {
  if (!prims) return null;
  return (
    <g
      fill={schraffur ? "url(#fp-schraffur)" : "none"}
      stroke={farbe}
      strokeWidth={1.6}
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      {prims.map((p, i) => {
        const dash = p.dash ? "5 4" : undefined;
        if (p.kind === "circle") {
          return <circle key={i} cx={p.cx} cy={p.cy} r={p.r} strokeDasharray={dash} />;
        }
        if (p.kind === "line") {
          return <line key={i} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} strokeDasharray={dash} />;
        }
        return <polygon key={i} points={p.points} strokeDasharray={dash} />;
      })}
    </g>
  );
}

/** Erste passende Clearance-Regel eines Funktionstyps (Bewegungsfläche vorn). */
function clearanceRegel(rules: readonly Rule[], funktionsTyp: string): Rule | undefined {
  return rules.find((r) => r.type === "clearance" && r.appliesTo === funktionsTyp);
}

/** Häufigster Wert einer Zahlenliste (für die Referenz-Wandstärke der Gehrung). */
function haeufigste(werte: number[]): number | undefined {
  if (werte.length === 0) return undefined;
  const zaehler = new Map<number, number>();
  for (const v of werte) zaehler.set(v, (zaehler.get(v) ?? 0) + 1);
  let beste = werte[0];
  let max = 0;
  for (const [v, n] of zaehler) {
    if (n > max) {
      max = n;
      beste = v;
    }
  }
  return beste;
}

export function Viewer2D({
  room,
  placements,
  catalog,
  rules = [],
  gewaehltId,
  statusById,
  onSelect,
  onMove,
  onRotate,
  interaktiv = false,
}: {
  room: Room;
  placements: Placement[];
  catalog: KatalogItem[];
  /** Norm-Regeln (für den Platzbedarf-Layer: `type:"clearance"`). Optional. */
  rules?: readonly Rule[];
  gewaehltId: string | null;
  statusById: Map<string, Status>;
  onSelect: (id: string | null) => void;
  /** Item per Drag verschieben (absolute Welt-Position). Fehlt → kein Drag. */
  onMove?: (id: string, world: [number, number]) => void;
  /** Item per Rotations-Griff drehen (absoluter Yaw in Grad). Fehlt → kein Griff. */
  onRotate?: (id: string, yawDeg: number) => void;
  /** Layer-Panel + Editier-Interaktion (Drag/Rotate/Messen). Default: aus. */
  interaktiv?: boolean;
}) {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const floor = room.shell.floor.polygon as Vec2[];
  const t = computeTransform(floor, SIZE, PAD);
  const floorPts = floor.map((p) => toScreen(p, t).join(",")).join(" ");

  // CAD-Wände: die Raumkontur ist die AUSSENKANTE, die Wandstärke wächst nach
  // innen. Für saubere (gehrungsverbundene) Ecken wird das nach innen versetzte
  // Innenpolygon einmal berechnet und je Eckpunkt der Wände nachgeschlagen. Die
  // Wandstärke ist im POC pro Raum einheitlich; als Referenz für die Gehrung
  // dient die häufigste Stärke (offene 0-Wände zählen nicht).
  const wandDicken = room.shell.walls
    .map((w) => (w as { thickness?: number }).thickness ?? WANDDICKE_FALLBACK)
    .filter((d) => d > 1e-6);
  const refDicke = haeufigste(wandDicken) ?? WANDDICKE_FALLBACK;
  const innen = innenPolygon(floor, refDicke);
  const eckKey = (p: Vec2 | readonly [number, number]) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
  const innenKarte = new Map(floor.map((p, i) => [eckKey(p), innen[i]]));

  const svgRef = useRef<SVGSVGElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [rotId, setRotId] = useState<string | null>(null);
  const bewegtRef = useRef(false);

  const [messModus, setMessModus] = useState(false);
  const [messPunkte, setMessPunkte] = useState<Vec2[]>([]);
  // Layer-System v2: globale Darstellungs-Layer + einzeln versteckte Objekte.
  const [sichtbareLayer, setSichtbareLayer] = useState<Record<LayerId, boolean>>(defaultLayers);
  const [versteckteObjekte, setVersteckteObjekte] = useState<Set<string>>(() => new Set());
  const [layerPanelOffen, setLayerPanelOffen] = useState(false);

  // Messwerkzeug/Interaktion enden bei Escape (und beim Verlassen von interaktiv).
  useEffect(() => {
    if (!interaktiv) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMessModus(false);
        setMessPunkte([]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [interaktiv]);

  // Pointer-Event (Bildschirm) → Welt (x,z): via SVG-CTM in viewBox-Einheiten,
  // dann toWorld. So stimmt das Mapping unabhängig von der gerenderten Grösse.
  const pointerWelt = (e: { clientX: number; clientY: number }): Vec2 | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const lokal = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return toWorld([lokal.x, lokal.y], t);
  };

  const ecken = wandEcken(room.shell.walls);

  const svgClick = (e: MouseEvent) => {
    if (messModus) {
      const w = pointerWelt(e);
      if (!w) return;
      const p = naechsteEcke(w, ecken, SNAP_ECKE);
      setMessPunkte((prev) => (prev.length >= 2 ? [p] : [...prev, p]));
      return;
    }
    if (bewegtRef.current) {
      bewegtRef.current = false; // Klick nach Drag/Rotate: nicht abwählen.
      return;
    }
    onSelect(null);
  };

  const pointerMove = (e: PointerEvent) => {
    if (rotId && onRotate) {
      const w = pointerWelt(e);
      const p = placements.find((pl) => pl.id === rotId);
      if (w && p) {
        bewegtRef.current = true;
        onRotate(rotId, yawAusZeiger(p.pose.pos as Vec2, w, 15));
      }
      return;
    }
    if (dragId && onMove) {
      const w = pointerWelt(e);
      if (w) {
        bewegtRef.current = true;
        onMove(dragId, [rasten(w[0]), rasten(w[1])]);
      }
    }
  };

  const pointerUp = (e: PointerEvent) => {
    if (!dragId && !rotId) return;
    svgRef.current?.releasePointerCapture(e.pointerId);
    setDragId(null);
    setRotId(null);
  };

  const ampelAn = sichtbareLayer.ampel;
  // Sichtbare Placements (Objekt-Layer): einzeln versteckte fliegen ganz raus –
  // inkl. ihres Platzbedarfs.
  const sichtbarePlacements = placements.filter((p) => objektSichtbar(versteckteObjekte, p.id));

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%" }}>
      {interaktiv && (
        <Werkzeugleiste
          layerOffen={layerPanelOffen}
          onLayer={() => setLayerPanelOffen((o) => !o)}
          messModus={messModus}
          onMessen={() => {
            setMessModus((m) => !m);
            setMessPunkte([]);
          }}
        />
      )}
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {interaktiv && layerPanelOffen && (
          <LayerPanel
            sichtbareLayer={sichtbareLayer}
            onLayer={(id) => setSichtbareLayer((s) => toggleLayer(s, id))}
            placements={placements}
            byId={byId}
            versteckteObjekte={versteckteObjekte}
            gewaehltId={gewaehltId}
            onObjekt={(id) => setVersteckteObjekte((v) => toggleObjekt(v, id))}
            onSelect={onSelect}
            onSchliessen={() => setLayerPanelOffen(false)}
          />
        )}
        <svg
          ref={svgRef}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          width="100%"
          height="100%"
          style={{
            background: THEME.offwhite,
            display: "block",
            touchAction: "none",
            cursor: messModus ? "crosshair" : "default",
          }}
          onClick={svgClick}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          role="img"
          aria-label="2D-Grundriss"
        >
          <defs>
            {/* Weisse Schraffur (Architektenplan) für die Objektfüllung, wenn
                die Ampel-Ebene aus ist – weisser Grund + feine schwarze
                Diagonalen (Bryan 2026-07-07). */}
            <pattern
              id="fp-schraffur"
              width={5}
              height={5}
              patternTransform="rotate(45)"
              patternUnits="userSpaceOnUse"
            >
              <rect width={5} height={5} fill="#ffffff" />
              <line x1={0} y1={0} x2={0} y2={5} stroke={FARBE_PLAN} strokeWidth={0.6} />
            </pattern>
          </defs>
          {/* Boden: beige normal, im Planlook (Ampel aus) reinweiss. */}
          <polygon points={floorPts} fill={ampelAn ? "#efe9dc" : "#ffffff"} stroke="none" />

          {/* Wände als gefüllte Polygone mit echter Wandstärke – pro Wand an den
              Öffnungen segmentiert (echte Aussparung in der Wandstärke). */}
          {sichtbareLayer.waende &&
            room.shell.walls.map((w) => {
              const dicke = (w as { thickness?: number }).thickness ?? WANDDICKE_FALLBACK;
              if (dicke <= 1e-6) return null; // offene Seite (Grossraum): keine Wand
              const massiv = w.kind === "massiv";
              const nIn = innwardNormal(w.start as Vec2, w.end as Vec2, floor);
              const eigene = room.openings
                .filter((o) => o.hostWall === w.id)
                .map((o) => ({ offset: o.offset, width: o.width }));
              const baender = wandBaender(
                w.start as Vec2,
                w.end as Vec2,
                nIn,
                dicke,
                eigene,
                innenKarte.get(eckKey(w.start)),
                innenKarte.get(eckKey(w.end)),
              );
              return (
                <g key={w.id}>
                  {baender.map((band, i) => (
                    <polygon
                      key={i}
                      points={band.map((p) => toScreen(p, t).join(",")).join(" ")}
                      fill={massiv ? WAND_FUELLUNG_MASSIV : WAND_FUELLUNG_LEICHT}
                      stroke={WAND_KANTE}
                      strokeWidth={0.8}
                      fillOpacity={massiv ? 1 : 0.85}
                    />
                  ))}
                </g>
              );
            })}

          {sichtbareLayer.oeffnungen &&
            room.openings.map((o) => <Oeffnung key={o.id} opening={o} room={room} t={t} />)}

          {/* Platzbedarf-Layer: Bewegungsflächen (Clearance) vor den Objekten –
              deckungsgleich mit der Ampel; nur visualisieren, nicht prüfen. */}
          {sichtbareLayer.platzbedarf &&
            sichtbarePlacements.map((p) => {
              const item = byId.get(p.catalogItemId);
              if (!item) return null;
              const regel = clearanceRegel(rules, item.funktionsTyp);
              if (!regel) return null;
              const tiefe = Number(regel.params?.depth ?? 0.6);
              const breite = Number(regel.params?.width ?? item.masse.w);
              const rect = clearanceRect(
                p.pose.pos as Vec2,
                item.masse.d,
                p.pose.yawDeg,
                tiefe,
                breite,
              )
                .map((pt) => toScreen(pt, t).join(","))
                .join(" ");
              return (
                <polygon
                  key={`cl-${p.id}`}
                  points={rect}
                  fill={THEME.orange}
                  fillOpacity={0.1}
                  stroke={THEME.orange}
                  strokeWidth={1.2}
                  strokeDasharray="6 4"
                  style={{ pointerEvents: "none" }}
                >
                  <title>{regel.hinweis ?? "Bewegungsfläche (Platzbedarf)"}</title>
                </polygon>
              );
            })}

          {/* Wandlängen-Beschriftung (Layer «Masse») */}
          {sichtbareLayer.masse &&
            room.shell.walls.map((w) => {
              const laenge = distanz(w.start as Vec2, w.end as Vec2);
              if (laenge < 0.2) return null;
              const mid: Vec2 = [(w.start[0] + w.end[0]) / 2, (w.start[1] + w.end[1]) / 2];
              const n = innwardNormal(w.start as Vec2, w.end as Vec2, floor);
              const [mx, my] = toScreen([mid[0] + n[0] * 0.14, mid[1] + n[1] * 0.14], t);
              return (
                <text
                  key={`m-${w.id}`}
                  x={mx}
                  y={my}
                  fontSize={12}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={THEME.gruen}
                  stroke={THEME.offwhite}
                  strokeWidth={3}
                  paintOrder="stroke"
                  style={{ pointerEvents: "none" }}
                >
                  {laenge.toFixed(2)} m
                </text>
              );
            })}

          {/* Placements: Statusfüllung, Symbol/Box, Rahmen, Beschriftung */}
          <g style={{ pointerEvents: messModus ? "none" : "auto" }}>
            {sichtbarePlacements.map((p) => {
              const item = byId.get(p.catalogItemId);
              if (!item) return null;
              const gewaehlt = p.id === gewaehltId;
              const wandobjekt = item.mount === "wand";
              const status = statusById.get(p.id);
              const [lx, ly] = toScreen(p.pose.pos as Vec2, t);
              const fp = footprintPoints(
                p.pose.pos as Vec2,
                item.masse.w,
                item.masse.d,
                p.pose.yawDeg,
                t,
              );
              const tint =
                ampelAn && status === "verletzt"
                  ? FARBE_VERLETZT
                  : ampelAn && status === "knapp"
                    ? FARBE_KNAPP
                    : "none";
              const zeigeRahmen = gewaehlt || sichtbareLayer.boxen;
              const prims = symbolScreenPrims(
                item.funktionsTyp,
                p.pose.pos as Vec2,
                item.masse.w,
                item.masse.d,
                p.pose.yawDeg,
                t,
              );
              return (
                <g
                  key={p.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!bewegtRef.current) onSelect(p.id);
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onSelect(p.id);
                    if (!interaktiv || p.locked || !onMove) return;
                    bewegtRef.current = false;
                    svgRef.current?.setPointerCapture(e.pointerId);
                    setDragId(p.id);
                  }}
                  style={{ cursor: interaktiv && !p.locked ? "grab" : "pointer" }}
                >
                  {/* Statusfüllung (Ampel) – auch ohne Boxen-Layer sichtbar */}
                  <polygon
                    points={fp}
                    fill={tint}
                    fillOpacity={tint === "none" ? 0 : 0.18}
                    stroke={zeigeRahmen ? (gewaehlt ? FARBE_GEWAEHLT : FARBE_NEUTRAL) : "none"}
                    strokeWidth={gewaehlt ? 3 : 1.2}
                    strokeDasharray={wandobjekt && zeigeRahmen ? "5 4" : undefined}
                  />
                  {sichtbareLayer.objekte &&
                    (prims ? (
                      <ObjektSymbol
                        prims={prims}
                        farbe={strichfarbe(item, p, status, ampelAn)}
                        schraffur={!ampelAn}
                      />
                    ) : !ampelAn ? (
                      // Fallback im Planlook: weisse Schraffur + schwarzer Rahmen.
                      <polygon
                        points={fp}
                        fill="url(#fp-schraffur)"
                        stroke={FARBE_PLAN}
                        strokeWidth={1.2}
                      />
                    ) : (
                      // Fallback: bisherige beschriftete Box
                      <polygon
                        points={fp}
                        fill={strichfarbe(item, p, status, ampelAn)}
                        fillOpacity={wandobjekt ? 0.4 : 0.75}
                        stroke="none"
                      />
                    ))}
                  {sichtbareLayer.beschriftung && (
                    <text
                      x={lx}
                      y={ly}
                      fontSize={11}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill={THEME.gruen}
                      stroke={THEME.offwhite}
                      strokeWidth={2.6}
                      paintOrder="stroke"
                      style={{ pointerEvents: "none" }}
                    >
                      {item.funktionsTyp}
                    </text>
                  )}
                </g>
              );
            })}
          </g>

          {/* Rotations-Griff am gewählten Objekt */}
          {interaktiv && onRotate && !messModus && (
            <RotationsGriff
              placements={sichtbarePlacements}
              byId={byId}
              gewaehltId={gewaehltId}
              t={t}
              onRotate={onRotate}
              onDown={(id, e) => {
                bewegtRef.current = false;
                svgRef.current?.setPointerCapture(e.pointerId);
                setRotId(id);
              }}
            />
          )}

          {/* Messwerkzeug-Overlay */}
          {messModus && <MessOverlay punkte={messPunkte} t={t} />}

          {ampelAn && <Legende />}
        </svg>
      </div>
    </div>
  );
}

/** Rotations-Griff (kleiner Kreis vor dem Objekt): Drag = 15°-Raster,
 *  Doppelklick = +90°. Nutzt `frontDir` für die Griff-Position. */
function RotationsGriff({
  placements,
  byId,
  gewaehltId,
  t,
  onRotate,
  onDown,
}: {
  placements: Placement[];
  byId: Map<string, KatalogItem>;
  gewaehltId: string | null;
  t: ReturnType<typeof computeTransform>;
  onRotate: (id: string, yawDeg: number) => void;
  onDown: (id: string, e: PointerEvent) => void;
}) {
  const p = placements.find((pl) => pl.id === gewaehltId);
  if (!p || p.locked) return null;
  const item = byId.get(p.catalogItemId);
  if (!item) return null;
  const center = p.pose.pos as Vec2;
  const fd = frontDir(p.pose.yawDeg);
  const abstand = item.masse.d / 2 + 0.2; // Meter vor die Front
  const griffWelt: Vec2 = [center[0] + fd[0] * abstand, center[1] + fd[1] * abstand];
  const [cx, cy] = toScreen(center, t);
  const [gx, gy] = toScreen(griffWelt, t);
  return (
    <g style={{ cursor: "grab" }}>
      <line x1={cx} y1={cy} x2={gx} y2={gy} stroke={FARBE_GEWAEHLT} strokeWidth={1.5} />
      <circle
        cx={gx}
        cy={gy}
        r={8}
        fill={THEME.weiss}
        stroke={FARBE_GEWAEHLT}
        strokeWidth={2.5}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => {
          e.stopPropagation();
          onDown(p.id, e);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onRotate(p.id, (p.pose.yawDeg + 90) % 360);
        }}
      >
        <title>Drehen (ziehen = 15°, Doppelklick = +90°)</title>
      </circle>
    </g>
  );
}

function MessOverlay({ punkte, t }: { punkte: Vec2[]; t: ReturnType<typeof computeTransform> }) {
  const screen = punkte.map((p) => toScreen(p, t));
  const [a, b] = punkte;
  const [sa, sb] = screen;
  return (
    <g style={{ pointerEvents: "none" }}>
      {sa && sb && a && b && (
        <>
          <line
            x1={sa[0]}
            y1={sa[1]}
            x2={sb[0]}
            y2={sb[1]}
            stroke={FARBE_GEWAEHLT}
            strokeWidth={2}
          />
          <text
            x={(sa[0] + sb[0]) / 2}
            y={(sa[1] + sb[1]) / 2 - 8}
            fontSize={14}
            fontWeight={600}
            textAnchor="middle"
            fill={THEME.gruen}
            stroke={THEME.weiss}
            strokeWidth={3.2}
            paintOrder="stroke"
          >
            {distanz(a, b).toFixed(2)} m
          </text>
        </>
      )}
      {screen.map(([x, y], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r={4}
          fill={FARBE_GEWAEHLT}
          stroke={THEME.weiss}
          strokeWidth={1.5}
        />
      ))}
    </g>
  );
}

/** Minimale Werkzeugleiste über dem Plan: Layer-Panel öffnen + Messen. */
function Werkzeugleiste({
  layerOffen,
  onLayer,
  messModus,
  onMessen,
}: {
  layerOffen: boolean;
  onLayer: () => void;
  messModus: boolean;
  onMessen: () => void;
}) {
  const knopf = (aktiv: boolean, farbe: string): CSSProperties => ({
    borderRadius: 999,
    padding: "5px 12px",
    fontSize: 12,
    cursor: "pointer",
    border: `1px solid ${aktiv ? farbe : THEME.salbei}`,
    background: aktiv ? farbe : "#fff",
    color: aktiv ? "#fff" : THEME.salbei,
  });
  return (
    <div style={{ display: "flex", gap: 6, padding: "0 0 8px", alignItems: "center" }}>
      <button
        type="button"
        onClick={onLayer}
        style={knopf(layerOffen, THEME.gruen)}
        aria-pressed={layerOffen}
      >
        ⧉ Layer
      </button>
      <button
        type="button"
        onClick={onMessen}
        style={knopf(messModus, THEME.orange)}
        aria-pressed={messModus}
      >
        📏 Messen
      </button>
    </div>
  );
}

/** CAD-artiges Layer-Panel (Overlay oben rechts über dem Plan). Zwei Gruppen:
 *  Darstellungs-Layer (globale Toggles) und Objekt-Layer (jedes Möbel einzeln
 *  ein-/ausblendbar; Klick auf die Zeile wählt das Objekt). */
function LayerPanel({
  sichtbareLayer,
  onLayer,
  placements,
  byId,
  versteckteObjekte,
  gewaehltId,
  onObjekt,
  onSelect,
  onSchliessen,
}: {
  sichtbareLayer: Record<LayerId, boolean>;
  onLayer: (id: LayerId) => void;
  placements: Placement[];
  byId: Map<string, KatalogItem>;
  versteckteObjekte: Set<string>;
  gewaehltId: string | null;
  onObjekt: (id: string) => void;
  onSelect: (id: string | null) => void;
  onSchliessen: () => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: 8,
        right: 8,
        zIndex: 2,
        width: 210,
        maxHeight: "calc(100% - 16px)",
        display: "flex",
        flexDirection: "column",
        background: "#fff",
        border: `1px solid ${THEME.salbei}`,
        borderRadius: 10,
        boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
        overflow: "hidden",
        fontSize: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 10px",
          borderBottom: `1px solid ${THEME.offwhite}`,
        }}
      >
        <strong style={{ color: THEME.gruen }}>Layer</strong>
        <button
          type="button"
          onClick={onSchliessen}
          aria-label="Layer-Panel schliessen"
          style={{
            border: "none",
            background: "none",
            cursor: "pointer",
            color: THEME.salbei,
            fontSize: 16,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      <div style={{ overflowY: "auto" }}>
        {/* Darstellungs-Layer */}
        <div style={{ padding: "8px 10px" }}>
          <p style={{ margin: "0 0 6px", color: THEME.salbei, fontSize: 11 }}>Darstellung</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {DARSTELLUNGS_LAYER.map((l) => {
              const an = sichtbareLayer[l.id];
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => onLayer(l.id)}
                  aria-pressed={an}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "5px 8px",
                    borderRadius: 6,
                    cursor: "pointer",
                    textAlign: "left",
                    border: `1px solid ${an ? THEME.gruen : THEME.salbei}`,
                    background: an ? THEME.offwhite : "#fff",
                    color: an ? THEME.gruen : THEME.salbei,
                    opacity: an ? 1 : 0.7,
                  }}
                >
                  <span aria-hidden>{l.icon}</span>
                  <span style={{ flex: 1 }}>{l.label}</span>
                  <span aria-hidden>{an ? "👁" : "🚫"}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Objekt-Layer */}
        {placements.length > 0 && (
          <div style={{ padding: "8px 10px", borderTop: `1px solid ${THEME.offwhite}` }}>
            <p style={{ margin: "0 0 6px", color: THEME.salbei, fontSize: 11 }}>
              Objekte ({placements.length})
            </p>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 3,
                maxHeight: 200,
                overflowY: "auto",
              }}
            >
              {placements.map((p) => {
                const item = byId.get(p.catalogItemId);
                const sichtbar = !versteckteObjekte.has(p.id);
                const gewaehlt = p.id === gewaehltId;
                return (
                  <div
                    key={p.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "3px 4px",
                      borderRadius: 6,
                      background: gewaehlt ? THEME.offwhite : "transparent",
                      border: `1px solid ${gewaehlt ? THEME.orange : "transparent"}`,
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 11,
                        height: 11,
                        borderRadius: 3,
                        flexShrink: 0,
                        background: item ? materialFarbe(item.funktionsTyp) : THEME.salbei,
                        border: `1px solid ${THEME.salbei}`,
                        opacity: sichtbar ? 1 : 0.35,
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => onSelect(p.id)}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        textAlign: "left",
                        border: "none",
                        background: "none",
                        cursor: "pointer",
                        color: sichtbar ? THEME.gruen : THEME.salbei,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        opacity: sichtbar ? 1 : 0.5,
                      }}
                    >
                      {item?.funktionsTyp ?? p.catalogItemId}
                    </button>
                    <button
                      type="button"
                      onClick={() => onObjekt(p.id)}
                      aria-pressed={sichtbar}
                      aria-label={sichtbar ? "Objekt ausblenden" : "Objekt einblenden"}
                      title={sichtbar ? "Ausblenden" : "Einblenden"}
                      style={{
                        border: "none",
                        background: "none",
                        cursor: "pointer",
                        fontSize: 13,
                        lineHeight: 1,
                        opacity: sichtbar ? 1 : 0.4,
                      }}
                    >
                      {sichtbar ? "👁" : "🚫"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Legende() {
  const rows: [string, string][] = [
    [THEME.gruen, "P1 / ok"],
    [FARBE_KNAPP, "knapp"],
    [FARBE_VERLETZT, "verletzt"],
    [FARBE_GESPERRT, "gesperrt"],
  ];
  return (
    <g
      transform={`translate(${PAD}, ${SIZE - PAD - rows.length * 22})`}
      style={{ pointerEvents: "none" }}
    >
      {rows.map(([farbe, text], i) => (
        <g key={text} transform={`translate(0, ${i * 22})`}>
          <rect width={16} height={16} fill={farbe} rx={3} />
          <text x={22} y={13} fontSize={13} fill="#3a3a33">
            {text}
          </text>
        </g>
      ))}
    </g>
  );
}
